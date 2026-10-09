// ESPN: the public scoreboard (DraftKings game lines, backs up Pinnacle) and the
// fantasy weekly projections (an independent second opinion to Sleeper's).

import type { ExtProj, GameLine } from '../../shared/market.js'
import { getJson, UA } from './cache.js'
import { teamAbbr } from './teams.js'

interface Scoreboard {
  events?: {
    date: string
    competitions: {
      competitors: { homeAway: 'home' | 'away'; team: { abbreviation: string } }[]
      odds?: { spread?: number | null; overUnder?: number | null }[]
    }[]
  }[]
}

/** ESPN must be asked for a week by number, or it serves the finished week into Tuesday. */
export async function fetchEspnLines(season: string, week: number): Promise<GameLine[]> {
  const data = await getJson<Scoreboard>(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`,
  )
  const out: GameLine[] = []
  for (const ev of data.events ?? []) {
    const c = ev.competitions?.[0]
    const home = teamAbbr(c?.competitors.find((x) => x.homeAway === 'home')?.team.abbreviation)
    const away = teamAbbr(c?.competitors.find((x) => x.homeAway === 'away')?.team.abbreviation)
    if (!c || !home || !away) continue
    const o = c.odds?.[0]
    out.push({
      home, away, kickoff: Date.parse(ev.date),
      spread: typeof o?.spread === 'number' ? o.spread : null, // already home-relative
      total: typeof o?.overUnder === 'number' ? o.overUnder : null,
      homeTT: null, awayTT: null, source: 'espn',
    })
  }
  return out
}

const PRO_TEAM: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND',
  12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI',
  23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
}
const POS: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' }
// ESPN stat id -> Sleeper stat key
const STAT: Record<string, string> = {
  '0': 'pass_att', '1': 'pass_cmp', '3': 'pass_yd', '4': 'pass_td', '19': 'pass_2pt', '20': 'pass_int',
  '23': 'rush_att', '24': 'rush_yd', '25': 'rush_td', '26': 'rush_2pt',
  '42': 'rec_yd', '43': 'rec_td', '44': 'rec_2pt', '53': 'rec', '58': 'rec_tgt', '72': 'fum_lost',
  '74': 'fgm_50p', '77': 'fgm_40_49', '83': 'fgm', '85': 'fgmiss', '86': 'xpm', '88': 'xpmiss',
}

interface KonaResp {
  players?: {
    player: {
      id: number
      fullName: string
      proTeamId: number
      defaultPositionId: number
      stats?: { statSourceId: number; scoringPeriodId: number; seasonId: number; stats: Record<string, number> }[]
    }
  }[]
}

export async function fetchEspnProjections(season: string, week: number): Promise<ExtProj[]> {
  const filter = {
    players: {
      filterSlotIds: { value: [0, 2, 4, 6, 17, 16] },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${season}`, `10${season}`, `11${season}${week}`, `02${season}`] },
      limit: 1000,
      offset: 0,
      sortPercOwned: { sortAsc: false, sortPriority: 1 },
    },
  }
  const data = await getJson<KonaResp>(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`,
    { headers: { 'user-agent': UA, accept: 'application/json', 'x-fantasy-filter': JSON.stringify(filter) } },
  )
  const out: ExtProj[] = []
  for (const { player } of data.players ?? []) {
    // statSourceId 1 = projection
    const wk = player.stats?.find((s) => s.statSourceId === 1 && s.scoringPeriodId === week && String(s.seasonId) === season)
    if (!wk) continue
    const stats: Record<string, number> = {}
    for (const [id, v] of Object.entries(wk.stats)) {
      const key = STAT[id]
      if (key && typeof v === 'number' && v) stats[key] = Math.round(v * 100) / 100
    }
    if (!Object.keys(stats).length) continue
    out.push({ espnId: player.id, name: player.fullName, team: PRO_TEAM[player.proTeamId] ?? null, pos: POS[player.defaultPositionId] ?? null, stats })
  }
  return out
}
