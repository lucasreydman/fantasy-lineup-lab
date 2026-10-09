// The Blend: a context-aware projection on top of Sleeper's.
//
// For the week the books are pricing:
//   0. consensus   Sleeper x ESPN stat lines, 50/50 where both project a stat
//   1. sportsbooks player props (Pinnacle + Underdog) anchor the stats they price
//   2. game script implied team total and spread tilt everything the books didn't price
//   3. matchup     defense vs. position (scored with the league's settings) on the rest
//   4. health      practice-report haircut on Questionable / Doubtful, zero for Out / IR
// For later weeks the books have no prices yet, so it's Sleeper's line plus the matchup tilt.
//
// The method follows the War Room app's model; the code is this app's own.

import type { DvpAgg, DvpSnapshot, ExtProj, GameLine, MarketSnapshot, PropLine, PropMarket } from '../../shared/market'
import { scoreStats } from './scoring'
import type { Player, WeekProjection } from './types'

// ── context ─────────────────────────────────────────────────────────────────

interface TeamGame {
  opp: string
  spread: number | null // team-relative: negative = this team favored
  implied: number | null
  oppImplied: number | null
}

export interface BlendCtx {
  season: string
  week: number
  gamesByTeam: Map<string, TeamGame>
  avgImplied: number
  propsById: Map<string, Partial<Record<PropMarket, PropLine>>>
  espnById: Map<string, ExtProj>
  dvp: DvpSnapshot | null
  dvpTables: WeakMap<Record<string, number>, Map<string, DvpTable>>
  stats: { props: number; propsMatched: number; espnMatched: number; games: number }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const r2 = (x: number) => Math.round(x * 100) / 100

export const normName = (s: string) =>
  s.toLowerCase().replace(/[.'’-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim()

function indexGames(games: GameLine[]) {
  const gamesByTeam = new Map<string, TeamGame>()
  const implieds: number[] = []
  for (const g of games) {
    const derive = (sign: 1 | -1) => (g.total != null && g.spread != null ? g.total / 2 + (sign * g.spread) / 2 : null)
    const home = g.homeTT ?? derive(-1)
    const away = g.awayTT ?? derive(1)
    if (home != null) implieds.push(home)
    if (away != null) implieds.push(away)
    gamesByTeam.set(g.home, { opp: g.away, spread: g.spread, implied: home, oppImplied: away })
    gamesByTeam.set(g.away, { opp: g.home, spread: g.spread != null ? -g.spread : null, implied: away, oppImplied: home })
  }
  const avgImplied = implieds.length >= 8 ? implieds.reduce((s, x) => s + x, 0) / implieds.length : 22.5
  return { gamesByTeam, avgImplied }
}

const PROP_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])
const marketPositions = (m: PropMarket): string[] =>
  ['pass_yds', 'pass_tds', 'pass_int', 'pass_att', 'pass_cmp'].includes(m)
    ? ['QB']
    : m === 'kick_pts'
      ? ['K']
      : m === 'rush_yds' || m === 'rush_att' || m === 'atd'
        ? ['QB', 'RB', 'WR', 'TE']
        : ['RB', 'WR', 'TE']

export function buildBlendCtx(market: MarketSnapshot, dvp: DvpSnapshot | null, players: Map<string, Player>): BlendCtx {
  const byName = new Map<string, Player[]>()
  const byLastInitial = new Map<string, Player[]>()
  const byEspn = new Map<number, string>()
  for (const p of players.values()) {
    if (p.espnId) byEspn.set(p.espnId, p.id)
    if (!PROP_POS.has(p.pos) || !p.team) continue
    const n = normName(`${p.first} ${p.last}`)
    byName.set(n, [...(byName.get(n) ?? []), p])
    const parts = n.split(' ')
    if (parts.length >= 2) {
      const k = `${parts[parts.length - 1]} ${parts[0][0]}`
      byLastInitial.set(k, [...(byLastInitial.get(k) ?? []), p])
    }
  }

  // Props are published by name: match on normalized name, disambiguated by the
  // game's two teams and the positions the market implies.
  const propsById = new Map<string, Partial<Record<PropMarket, PropLine>>>()
  let propsMatched = 0
  for (const pr of market.props) {
    const teams = new Set([pr.home, pr.away])
    const n = normName(pr.name)
    let cands = byName.get(n) ?? []
    if (!cands.length) {
      const parts = n.split(' ')
      if (parts.length >= 2)
        cands = (byLastInitial.get(`${parts[parts.length - 1]} ${parts[0][0]}`) ?? []).filter((p) => teams.has(p.team!))
    }
    const onTeam = cands.filter((p) => teams.has(p.team!))
    const pool = onTeam.length ? onTeam : cands.length === 1 ? cands : []
    const okPos = marketPositions(pr.market)
    const byPos = pool.filter((p) => okPos.includes(p.pos))
    const final = byPos.length ? byPos : pool
    const pick = [...final].sort((a, b) => (a.rank ?? 9e9) - (b.rank ?? 9e9))[0]
    if (!pick) continue
    propsMatched++
    propsById.set(pick.id, { ...propsById.get(pick.id), [pr.market]: pr })
  }

  // ESPN projections: exact ESPN id when Sleeper has it, else name + team + position.
  const espnById = new Map<string, ExtProj>()
  for (const pr of market.espn) {
    let id = byEspn.get(pr.espnId)
    if (!id) {
      const cands = byName.get(normName(pr.name)) ?? []
      const pool = cands.filter((c) => (!pr.team || c.team === pr.team) && (!pr.pos || c.pos === pr.pos))
      const final = pool.length ? pool : cands.length === 1 ? cands : []
      id = final.length === 1 ? final[0].id : undefined
    }
    if (id && !espnById.has(id)) espnById.set(id, pr)
  }

  const { gamesByTeam, avgImplied } = indexGames(market.games)
  return {
    season: market.season,
    week: market.week,
    gamesByTeam,
    avgImplied,
    propsById,
    espnById,
    dvp,
    dvpTables: new WeakMap(),
    stats: { props: market.props.length, propsMatched, espnMatched: espnById.size, games: market.games.length },
  }
}

// ── defense vs. position ────────────────────────────────────────────────────

// Measured on Sleeper actuals (2024 -> 2025): last season's points-allowed ratio barely
// persists, so it's regressed by its year-over-year r (WR: ignored) and counted as K
// games of evidence against this season's sample.
const DVP_YOY_R: Record<string, number> = { QB: 0.24, RB: 0.2, WR: -0.09, TE: 0.25, K: 0.12 }
const DVP_PRIOR_GAMES: Record<string, number> = { QB: 14, RB: 14, WR: 10, TE: 14, K: 14 }
const DVP_CAP = 0.1

interface DvpTable {
  mult: Map<string, number>
}

function perGame(agg: DvpAgg, pos: string, scoring: Record<string, number>) {
  const m = new Map<string, { pg: number; n: number }>()
  for (const [def, cells] of Object.entries(agg)) {
    const c = cells[pos]
    if (c && c.games > 0) m.set(def, { pg: scoreStats(c.stats, scoring) / c.games, n: c.games })
  }
  const avg = m.size ? [...m.values()].reduce((s, v) => s + v.pg, 0) / m.size : 0
  return { m, avg }
}

function dvpTable(ctx: BlendCtx, pos: string, scoring: Record<string, number>): DvpTable | null {
  if (!ctx.dvp) return null
  let byPos = ctx.dvpTables.get(scoring)
  if (!byPos) ctx.dvpTables.set(scoring, (byPos = new Map()))
  const hit = byPos.get(pos)
  if (hit) return hit
  const yoy = Math.max(0, DVP_YOY_R[pos] ?? 0)
  const K = DVP_PRIOR_GAMES[pos] ?? 14
  const cur = perGame(ctx.dvp.current, pos, scoring)
  const pri = ctx.dvp.prior ? perGame(ctx.dvp.prior.agg, pos, scoring) : null
  const haveCur = cur.m.size >= 16 && cur.avg > 0
  const mult = new Map<string, number>()
  for (const def of new Set([...cur.m.keys(), ...(pri?.m.keys() ?? [])])) {
    const c = haveCur ? cur.m.get(def) : undefined
    const p = pri?.m.get(def)
    const n = c?.n ?? 0
    const rc = c ? c.pg / cur.avg : 1
    const rp = p && pri && pri.avg > 0 ? 1 + (p.pg / pri.avg - 1) * yoy : 1
    mult.set(def, clamp((n * rc + K * rp) / (n + K), 1 - DVP_CAP, 1 + DVP_CAP))
  }
  const table = { mult }
  byPos.set(pos, table)
  return table
}

// ── the model ───────────────────────────────────────────────────────────────

export type BlendPart = 'consensus' | 'vegas' | 'game' | 'matchup' | 'health'
export const BLEND_LABEL: Record<BlendPart, string> = {
  consensus: 'ESPN consensus', vegas: 'Sportsbooks', game: 'Game script', matchup: 'Matchup', health: 'Health',
}

export interface BlendResult {
  points: number
  sleeper: number
  contrib: Partial<Record<BlendPart, number>>
}

const MARKET_STAT: Partial<Record<PropMarket, string>> = {
  pass_yds: 'pass_yd', pass_tds: 'pass_td', pass_int: 'pass_int', pass_att: 'pass_att', pass_cmp: 'pass_cmp',
  rush_yds: 'rush_yd', rush_att: 'rush_att', rec: 'rec', rec_yds: 'rec_yd', rec_tgt: 'rec_tgt',
}
// Stdev of the stat as a fraction of the line: turns over/under juice into a mean shift.
const SD_FRAC: Record<PropMarket, number> = {
  pass_yds: 0.18, pass_tds: 0.5, pass_int: 0.6, pass_att: 0.15, pass_cmp: 0.18,
  rush_yds: 0.45, rush_att: 0.3, rec: 0.4, rec_yds: 0.5, rec_tgt: 0.35, atd: 0, kick_pts: 0.4,
}
// Yardage/TD markets first so their correlated-volume scaling doesn't fight the
// attempt/target markets, which then set those stats directly.
const MARKET_ORDER: PropMarket[] = [
  'pass_yds', 'pass_tds', 'pass_int', 'rush_yds', 'rec', 'rec_yds', 'atd', 'kick_pts', 'pass_att', 'pass_cmp', 'rush_att', 'rec_tgt',
]
const TD_KEYS = new Set(['pass_td', 'rush_td', 'rec_td'])
const PASS_KEYS = new Set(['pass_yd', 'pass_att', 'pass_cmp', 'pass_td', 'bonus_pass_yd_300', 'bonus_pass_yd_400', 'bonus_pass_cmp_25'])
const RUSH_KEYS = new Set(['rush_yd', 'rush_att', 'rush_td', 'bonus_rush_yd_100', 'bonus_rush_yd_200', 'bonus_rush_att_20'])
const REC_KEYS = new Set(['rec', 'rec_yd', 'rec_td', 'rec_tgt', 'bonus_rec_yd_100', 'bonus_rec_yd_200', 'bonus_rec_te', 'bonus_rec_rb', 'bonus_rec_wr'])
const VOLUME_KEYS = new Set([...PASS_KEYS, ...RUSH_KEYS, ...REC_KEYS])
const KICK_RE = /^(fgm|xpm|fga|xpa)/
const DEF_PLAY_KEYS = new Set(['sack', 'int', 'ff', 'fum_rec', 'def_td', 'safe', 'blk_kick', 'def_st_td', 'def_st_ff', 'def_st_fum_rec', 'tkl_loss', 'qb_hit'])
// Stats ESPN projects; a Sleeper-only key outside this set is left alone by the consensus.
const ESPN_KEYS = new Set([
  'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_2pt', 'pass_int', 'rush_att', 'rush_yd', 'rush_td', 'rush_2pt',
  'rec_yd', 'rec_td', 'rec_2pt', 'rec', 'rec_tgt', 'fum_lost', 'fgm_50p', 'fgm_40_49', 'fgm', 'fgmiss', 'xpm', 'xpmiss',
])
const HARD_OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'COV', 'NA', 'DNR'])

/** Inverse standard normal CDF (Acklam's approximation). */
function probit(p: number): number {
  p = clamp(p, 1e-4, 1 - 1e-4)
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)))
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)))
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** The market's expected value of a stat, from its line and the de-vigged over probability. */
export function marketMean(market: PropMarket, line: number, overProb: number | null): number {
  if (overProb == null) return line
  const scale = Math.max(line, 1)
  return line + clamp(probit(overProb) * SD_FRAC[market] * scale, -0.15 * scale, 0.15 * scale)
}

const bookWeight = (books: number) => (books >= 2 ? 0.85 : 0.7)
const ESPN_WEIGHT = 0.5

/** Availability for the priced week: practice reports are the best free tell on a Q tag. */
export function healthFactor(p: Player | undefined): number {
  if (!p) return 1
  if (!p.team && p.pos !== 'DEF') return 0
  if (p.injury && HARD_OUT.has(p.injury)) return 0
  if (p.status && p.pos !== 'DEF' && (p.status === 'Injured Reserve' || p.status === 'PUP')) return 0
  if (p.injury === 'Doubtful') return 0.2
  if (p.injury === 'Questionable') {
    const prac = (p.practice ?? '').toLowerCase()
    if (/did not|dnp|^out/.test(prac)) return 0.6
    if (/limited/.test(prac)) return 0.85
  }
  return 1
}

export function blendPlayer(
  ctx: BlendCtx,
  id: string,
  player: Player | undefined,
  week: number,
  wk: WeekProjection | null | undefined,
  scoring: Record<string, number>,
): BlendResult {
  const sleeper = wk ? scoreStats(wk.stats, scoring) : 0
  if (wk === null) return { points: 0, sleeper: 0, contrib: {} } // bye
  const pos = player?.pos ?? null
  const team = player?.team ?? null
  const priced = week === ctx.week
  const contrib: Partial<Record<BlendPart, number>> = {}
  let stats: Record<string, number> = { ...(wk?.stats ?? {}) }
  let last = sleeper
  const step = (part: BlendPart) => {
    syncBonus()
    const now = scoreStats(stats, scoring)
    if (Math.abs(now - last) >= 0.005) contrib[part] = r2(now - last)
    last = now
  }
  // Per-position reception bonuses (TE premium etc.) are copies of the reception count.
  const syncBonus = () => {
    if (stats.rec == null) return
    if (pos === 'TE' && 'bonus_rec_te' in stats) stats.bonus_rec_te = stats.rec
    if (pos === 'RB' && 'bonus_rec_rb' in stats) stats.bonus_rec_rb = stats.rec
    if (pos === 'WR' && 'bonus_rec_wr' in stats) stats.bonus_rec_wr = stats.rec
  }
  const propped = new Set<string>()

  if (priced) {
    // 0. consensus with ESPN
    const ext = ctx.espnById.get(id)
    if (ext) {
      if (wk) {
        const keys = new Set([...Object.keys(ext.stats), ...Object.keys(stats).filter((k) => ESPN_KEYS.has(k))])
        for (const k of keys) stats[k] = ESPN_WEIGHT * (ext.stats[k] ?? 0) + (1 - ESPN_WEIGHT) * (stats[k] ?? 0)
      } else {
        stats = { ...ext.stats }
      }
      step('consensus')
    }

    // 1. sportsbook props anchor what they price
    const props = ctx.propsById.get(id)
    if (props) {
      const scale = (keys: string[], ratio: number) => {
        for (const k of keys)
          if (stats[k] && !propped.has(k)) {
            stats[k] *= ratio
            propped.add(k)
          }
      }
      for (const mk of MARKET_ORDER) {
        const pr = props[mk]
        if (!pr) continue
        const w = bookWeight(pr.books)
        if (mk === 'atd') {
          if (pr.overProb == null) continue
          // P(at least one TD) -> expected TDs, assuming Poisson scoring
          const lambda = -Math.log(1 - clamp(pr.overProb, 0.01, 0.95))
          const rush = stats.rush_td ?? 0
          const rec = stats.rec_td ?? 0
          const tot = rush + rec
          const rushShare = tot > 0 ? rush / tot : pos === 'QB' ? 1 : pos === 'RB' ? 0.75 : 0.05
          const blended = w * lambda + (1 - w) * tot
          stats.rush_td = blended * rushShare
          stats.rec_td = blended * (1 - rushShare)
          propped.add('rush_td').add('rec_td')
          continue
        }
        if (pr.line == null) continue
        const mean = marketMean(mk, pr.line, pr.overProb)
        if (mk === 'kick_pts') {
          const cur = 3 * (stats.fgm ?? 0) + (stats.xpm ?? 0)
          if (cur > 0) {
            const ratio = (w * mean + (1 - w) * cur) / cur
            for (const k of Object.keys(stats))
              if (KICK_RE.test(k)) {
                stats[k] *= ratio
                propped.add(k)
              }
          }
          continue
        }
        const key = MARKET_STAT[mk]!
        const cur = stats[key] ?? 0
        const next = w * mean + (1 - w) * cur
        stats[key] = next
        propped.add(key)
        // drag correlated volume along, clamped so a small line move can't swing it wildly
        if (cur > 0) {
          const ratio = clamp(next / cur, 0.8, 1.25)
          if (key === 'pass_yd') scale(['pass_att', 'pass_cmp', 'bonus_pass_yd_300', 'bonus_pass_yd_400'], ratio)
          if (key === 'rush_yd') scale(['rush_att', 'bonus_rush_yd_100', 'bonus_rush_yd_200'], ratio)
          if (key === 'rec') scale(['rec_tgt', 'bonus_rec_te', 'bonus_rec_rb', 'bonus_rec_wr'], ratio)
          if (key === 'rec_yd') scale(['bonus_rec_yd_100', 'bonus_rec_yd_200'], ratio)
        }
      }
      step('vegas')
    }

    // 2. game environment for everything the books didn't price
    const tg = team ? ctx.gamesByTeam.get(team) : undefined
    if (tg && tg.implied != null && ctx.avgImplied > 0) {
      const ratio = clamp(tg.implied / ctx.avgImplied, 0.8, 1.25)
      const tdF = 1 + 0.6 * (ratio - 1)
      const volF = 1 + 0.3 * (ratio - 1)
      const s = tg.spread ?? 0
      const favF = s <= -6.5 ? 1.04 : s >= 6.5 ? 0.96 : 1 // favorites run, big dogs throw
      for (const k of Object.keys(stats)) {
        if (propped.has(k)) continue
        if (pos === 'DEF') {
          if (DEF_PLAY_KEYS.has(k) && tg.oppImplied != null)
            stats[k] *= 1 + 0.5 * (1 - clamp(tg.oppImplied / ctx.avgImplied, 0.8, 1.25))
          continue
        }
        if (TD_KEYS.has(k)) stats[k] *= tdF
        else if (VOLUME_KEYS.has(k)) stats[k] *= volF
        else if (KICK_RE.test(k)) stats[k] *= 1 + 0.5 * (ratio - 1)
        if (RUSH_KEYS.has(k)) stats[k] *= favF
        else if (PASS_KEYS.has(k)) stats[k] *= 2 - favF
      }
      step('game')
    }
  }

  // 3. matchup: defense vs. position on whatever the books didn't price (every week)
  const opp = wk?.opponent ?? (priced && team ? ctx.gamesByTeam.get(team)?.opp : null)
  if (opp && pos && pos !== 'DEF') {
    const m = dvpTable(ctx, pos, scoring)?.mult.get(opp)
    if (m) {
      for (const k of Object.keys(stats)) if (!propped.has(k) && (VOLUME_KEYS.has(k) || KICK_RE.test(k))) stats[k] *= m
      step('matchup')
    }
  }

  let points = r2(scoreStats(stats, scoring))
  // 4. health, priced week only (later weeks: Sleeper's own line already reflects long absences)
  if (priced) {
    const f = healthFactor(player)
    if (f < 1) {
      contrib.health = r2(points * f - points)
      points = r2(points * f)
    }
  }
  return { points, sleeper, contrib }
}
