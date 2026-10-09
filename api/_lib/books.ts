// Sportsbook feeds: Pinnacle's guest API (sharpest book: game lines, team totals,
// player props) and Underdog's pick'em lines (second quote + anytime-TD props).

import type { GameLine, PropLine, PropMarket } from '../../shared/market.js'
import { getJson, implied, UA } from './cache.js'
import { teamAbbr } from './teams.js'

// ── Pinnacle ────────────────────────────────────────────────────────────────

const PIN = 'https://guest.api.arcadia.pinnacle.com/0.1/leagues/889'
// The public guest key Pinnacle's own web app ships with.
const PIN_HEADERS = {
  'x-api-key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R',
  referer: 'https://www.pinnacle.com/',
  accept: 'application/json',
  'user-agent': UA,
}

const PIN_UNITS: Record<string, PropMarket> = {
  'Passing Yards': 'pass_yds', 'Touchdown Passes': 'pass_tds', Interceptions: 'pass_int',
  'Pass Attempts': 'pass_att', 'Pass Completions': 'pass_cmp', 'Rushing Yards': 'rush_yds',
  'Rush Attempts': 'rush_att', Receptions: 'rec', 'Receiving Yards': 'rec_yds', Targets: 'rec_tgt',
  'Kicking Points': 'kick_pts',
}

interface Participant { id?: number; name: string; alignment: 'home' | 'away' | 'neutral' }
interface Matchup {
  id: number
  type: 'matchup' | 'special'
  startTime: string
  units?: string
  participants: Participant[]
  parent?: { participants: Participant[] } | null
  special?: { category: string; description: string }
}
interface Price { designation?: string; participantId?: number; points?: number; price: number }
interface Market { matchupId: number; type: string; period: number; isAlternate?: boolean; side?: string; prices: Price[] }

const sides = (ps: Participant[]) => ({
  home: teamAbbr(ps.find((p) => p.alignment === 'home')?.name),
  away: teamAbbr(ps.find((p) => p.alignment === 'away')?.name),
})

export async function fetchPinnacle(): Promise<{ games: GameLine[]; props: PropLine[] }> {
  const [matchups, markets] = await Promise.all([
    getJson<Matchup[]>(`${PIN}/matchups`, { headers: PIN_HEADERS }),
    getJson<Market[]>(`${PIN}/markets/straight`, { headers: PIN_HEADERS }),
  ])
  const byMatchup = new Map<number, Market[]>()
  for (const m of markets) byMatchup.set(m.matchupId, [...(byMatchup.get(m.matchupId) ?? []), m])

  const games: GameLine[] = []
  const props: PropLine[] = []
  for (const mu of matchups) {
    const ms = (byMatchup.get(mu.id) ?? []).filter((m) => m.period === 0 && !m.isAlternate)
    if (mu.type === 'matchup') {
      const { home, away } = sides(mu.participants)
      if (!home || !away) continue
      const pts = (type: string, desig: string, side?: string) =>
        ms.find((m) => m.type === type && (!side || m.side === side))?.prices.find((p) => p.designation === desig)?.points ?? null
      games.push({
        home, away, kickoff: Date.parse(mu.startTime),
        spread: pts('spread', 'home'), total: pts('total', 'over'),
        homeTT: pts('team_total', 'over', 'home'), awayTT: pts('team_total', 'over', 'away'),
        source: 'pinnacle',
      })
      continue
    }
    if (mu.special?.category !== 'Player Props' || !mu.units || !mu.parent) continue
    const market = PIN_UNITS[mu.units]
    const { home, away } = sides(mu.parent.participants)
    if (!market || !home || !away) continue
    // "Jayden Daniels Total Passing Yards" -> "Jayden Daniels"
    const name = mu.special.description.replace(new RegExp(`\\s+Total\\s+${mu.units}.*$`, 'i'), '').trim()
    const over = mu.participants.find((p) => p.name === 'Over')
    const under = mu.participants.find((p) => p.name === 'Under')
    const mk = ms.find((m) => m.type === 'total')
    if (!mk || !over || !under) continue
    const po = mk.prices.find((p) => p.participantId === over.id)
    const pu = mk.prices.find((p) => p.participantId === under.id)
    const line = po?.points ?? pu?.points
    if (line == null) continue
    const overProb = po && pu ? implied(po.price) / (implied(po.price) + implied(pu.price)) : null
    props.push({ name, home, away, market, line, overProb, books: 1, sources: ['pinnacle'] })
  }
  return { games, props }
}

// ── Underdog ────────────────────────────────────────────────────────────────

const UD_HEADERS = {
  'user-agent': UA, accept: 'application/json', 'accept-language': 'en-US,en;q=0.9',
  origin: 'https://underdogfantasy.com', referer: 'https://underdogfantasy.com/',
}
// Underdog sometimes gates its beta path behind a client version (HTTP 426); v1 has the same shape.
const UD_LINES = [
  'https://api.underdogfantasy.com/beta/v6/over_under_lines?sport_id=NFL',
  'https://api.underdogfantasy.com/v1/over_under_lines?sport_id=NFL',
]
const UD_TEAMS = 'https://api.underdogfantasy.com/v2/pickem_search/search_results?sport_id=NFL'

const UD_STATS: Record<string, PropMarket> = {
  passing_yds: 'pass_yds', passing_tds: 'pass_tds', passing_ints: 'pass_int', passing_att: 'pass_att',
  passing_comps: 'pass_cmp', rushing_yds: 'rush_yds', rushing_att: 'rush_att', receiving_rec: 'rec',
  receiving_yds: 'rec_yds', receiving_tgts: 'rec_tgt', rush_rec_tds: 'atd', kicking_points: 'kick_pts',
}

interface UdFeed {
  appearances: { id: string; match_id: number | null; match_type: string; player_id: string }[]
  games: { id: number; home_team_id: string; away_team_id: string; scheduled_at: string }[]
  players: { id: string; first_name: string; last_name: string; sport_id: string }[]
  over_under_lines: {
    stat_value: string
    status: string
    live_event?: boolean
    options: { choice: 'higher' | 'lower'; american_price: string; status?: string }[]
    over_under: { appearance_stat: { appearance_id: string; stat: string } }
  }[]
  teams?: { id: string; abbr: string; name: string }[]
}

export async function fetchUnderdog(): Promise<PropLine[]> {
  const teamFeed = await getJson<UdFeed>(UD_TEAMS, { headers: UD_HEADERS })
  const teams = new Map<string, string>()
  for (const t of teamFeed.teams ?? []) {
    const abbr = teamAbbr(t.abbr) ?? teamAbbr(t.name)
    if (abbr) teams.set(t.id, abbr)
  }
  let feed: UdFeed | null = null
  let lastErr: unknown = null
  for (const url of UD_LINES) {
    try {
      feed = await getJson<UdFeed>(url, { headers: UD_HEADERS })
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (!feed) throw lastErr ?? new Error('Underdog lines unavailable')

  const apps = new Map(feed.appearances.map((a) => [a.id, a]))
  const players = new Map(feed.players.map((p) => [p.id, p]))
  const games = new Map(feed.games.map((g) => [g.id, g]))
  const now = Date.now()
  const out: PropLine[] = []
  for (const l of feed.over_under_lines) {
    if (l.status !== 'active' || l.live_event) continue
    const market = UD_STATS[l.over_under.appearance_stat.stat]
    const app = apps.get(l.over_under.appearance_stat.appearance_id)
    if (!market || !app || app.match_type !== 'Game' || app.match_id == null) continue
    const pl = players.get(app.player_id)
    const g = games.get(app.match_id)
    if (!pl || !g || pl.sport_id !== 'NFL' || Date.parse(g.scheduled_at) < now) continue
    const home = teams.get(g.home_team_id)
    const away = teams.get(g.away_team_id)
    const value = Number(l.stat_value)
    if (!home || !away || !Number.isFinite(value)) continue
    const price = (c: 'higher' | 'lower') => {
      const o = l.options.find((x) => x.choice === c && (x.status ?? 'active') === 'active')
      return o ? implied(Number(o.american_price)) : null
    }
    const hi = price('higher')
    const lo = price('lower')
    // One-sided quote: shave a typical hold off the price.
    const overProb = hi != null && lo != null ? hi / (hi + lo) : hi != null ? hi * 0.955 : null
    const name = `${pl.first_name} ${pl.last_name}`
    if (market === 'atd') {
      // Only the 0.5 line reads as "scores at least one TD".
      if (value === 0.5 && overProb != null)
        out.push({ name, home, away, market, line: null, overProb, books: 1, sources: ['underdog'] })
      continue
    }
    out.push({ name, home, away, market, line: value, overProb, books: 1, sources: ['underdog'] })
  }
  return out
}

// ── consensus ───────────────────────────────────────────────────────────────

export const normName = (s: string) =>
  s.toLowerCase().replace(/[.'’-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim()

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** Merge quotes on the same player + market: median line, over-prob averaged at that line. */
export function consensus(lines: PropLine[]): PropLine[] {
  const groups = new Map<string, PropLine[]>()
  for (const l of lines) {
    const k = `${normName(l.name)}|${l.market}|${[l.home, l.away].sort().join('-')}`
    groups.set(k, [...(groups.get(k) ?? []), l])
  }
  const out: PropLine[] = []
  for (const g of groups.values()) {
    const base = g.find((x) => x.sources[0] === 'pinnacle') ?? g[0]
    const sources = [...new Set(g.flatMap((x) => x.sources))]
    const probs = (xs: PropLine[]) => xs.map((x) => x.overProb).filter((p): p is number => p != null)
    if (base.market === 'atd') {
      const ps = probs(g)
      out.push({ ...base, overProb: ps.length ? avg(ps) : null, books: g.length, sources })
      continue
    }
    const ls = g.map((x) => x.line).filter((x): x is number => x != null)
    if (!ls.length) continue
    const line = median(ls)
    const atLine = probs(g.filter((x) => x.line === line))
    const any = probs(g)
    out.push({ ...base, line, overProb: atLine.length ? avg(atLine) : any.length ? avg(any) : null, books: g.length, sources })
  }
  return out
}
