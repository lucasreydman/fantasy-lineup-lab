// Sleeper on the server: which week the books are pricing, and defense-vs-position
// tables built from weekly actuals.

import { DVP_POSITIONS, type DvpAgg } from '../../shared/market.js'
import { getJson } from './cache.js'

interface NflState { week: number; leg: number; season: string; season_type: string; previous_season: string }
interface SchedGame { week: number; status: string; home: string; away: string }

export const nflState = () => getJson<NflState>('https://api.sleeper.app/v1/state/nfl')

export interface WeekCtx {
  season: string
  week: number
  /** `home|away` for every game of that week */
  pairs: Set<string>
}

/**
 * Sleeper's `week` lags the real slate on Tuesdays; the schedule settles it: the
 * first week whose games are not all complete is the one being priced.
 */
export async function weekCtx(): Promise<WeekCtx> {
  const state = await nflState()
  const schedule = await getJson<SchedGame[] | null>(`https://api.sleeper.app/schedule/nfl/regular/${state.season}`)
    .then((s) => s ?? [])
    .catch(() => [] as SchedGame[])
  let week = 1
  if (state.season_type === 'regular' || state.season_type === 'post') {
    let done = 0
    for (let w = 1; w <= 18; w++) {
      const games = schedule.filter((g) => g.week === w)
      if (!games.length || !games.every((g) => g.status === 'complete' || g.status === 'canceled')) break
      done = w
    }
    week = Math.min(18, Math.max(state.week || 1, done + 1))
  }
  const pairs = new Set(schedule.filter((g) => g.week === week).map((g) => `${g.home}|${g.away}`))
  return { season: state.season, week, pairs }
}

export function completedWeeks(state: NflState): number {
  if (state.season_type === 'regular') return Math.max(0, Math.min(state.week, state.leg) - 1)
  if (state.season_type === 'post') return 18
  return 0
}

interface StatEntry {
  week: number
  opponent: string | null
  stats: Record<string, number> | null
  player?: { position?: string }
}

// Derived / non-scoring keys that only bloat the payload.
const SKIP = /^(pts_|pos_rank_|tm_|rank)|(_lng|_ypa|_ypr|_ypt|_ypc|_snp)$|^(gp|gms_active|gs)$/

/** Sum every position's actual stat lines against each defense, weeks 1..through. */
export async function buildDvp(season: string, through: number): Promise<DvpAgg> {
  const agg: DvpAgg = {}
  const games = new Map<string, Set<number>>()
  const pos = DVP_POSITIONS.map((p) => `position[]=${p}`).join('&')
  const weeks = Array.from({ length: Math.max(0, through) }, (_, i) => i + 1)
  for (let i = 0; i < weeks.length; i += 4) {
    const chunk = await Promise.all(
      weeks.slice(i, i + 4).map((w) =>
        getJson<StatEntry[] | null>(`https://api.sleeper.com/stats/nfl/${season}/${w}?season_type=regular&${pos}`).then((d) => d ?? []),
      ),
    )
    for (const entries of chunk) {
      for (const e of entries) {
        const p = e.player?.position
        if (!p || !e.opponent || !e.stats || !(DVP_POSITIONS as readonly string[]).includes(p)) continue
        // Players who never took the field shouldn't count as a game against this defense.
        if (!Object.keys(e.stats).some((k) => !SKIP.test(k) && e.stats![k])) continue
        const cell = ((agg[e.opponent] ??= {})[p] ??= { games: 0, stats: {} })
        for (const [k, v] of Object.entries(e.stats)) {
          if (typeof v === 'number' && v && !SKIP.test(k)) cell.stats[k] = (cell.stats[k] ?? 0) + v
        }
        const gk = `${e.opponent}|${p}`
        games.set(gk, (games.get(gk) ?? new Set()).add(e.week))
      }
    }
  }
  for (const [gk, set] of games) {
    const [def, p] = gk.split('|')
    agg[def][p].games = set.size
  }
  for (const def of Object.values(agg))
    for (const cell of Object.values(def))
      for (const k of Object.keys(cell.stats)) cell.stats[k] = Math.round(cell.stats[k] * 100) / 100
  return agg
}
