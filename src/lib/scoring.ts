import { blendPlayer, type BlendCtx, type BlendResult } from './blend'
import type { Player, PlayerProjections } from './types'

/**
 * Score a stat line with a league's scoring settings. Sleeper projection stat
 * keys share names with scoring_settings keys (rec, rec_yd, pts_allow_14_20, ...),
 * so a league's points are the dot product of the two.
 */
export function scoreStats(
  stats: Record<string, number>,
  scoring: Record<string, number>,
): number {
  let pts = 0
  for (const key in scoring) {
    const v = stats[key]
    if (v) pts += v * scoring[key]
  }
  return Math.round(pts * 100) / 100
}

export type PointsFn = (playerId: string, week: number) => number

export type ProjectionMode = 'sleeper' | 'blend'

export interface Scorer {
  points: PointsFn
  /** Blend breakdown for one player-week; null in Sleeper mode. */
  detail: (playerId: string, week: number) => BlendResult | null
}

export function makeScorer(
  projections: Map<string, PlayerProjections>,
  scoring: Record<string, number>,
  blend?: { ctx: BlendCtx; players: Map<string, Player> } | null,
): Scorer {
  const cache = new Map<string, BlendResult>()
  const detail = (id: string, week: number): BlendResult => {
    const key = `${id}:${week}`
    let r = cache.get(key)
    if (!r) {
      const wk = projections.get(id)?.[week]
      r = blend
        ? blendPlayer(blend.ctx, id, blend.players.get(id), week, wk, scoring)
        : { points: wk ? scoreStats(wk.stats, scoring) : 0, sleeper: wk ? scoreStats(wk.stats, scoring) : 0, contrib: {} }
      cache.set(key, r)
    }
    return r
  }
  return {
    points: (id, week) => detail(id, week).points,
    detail: (id, week) => (blend ? detail(id, week) : null),
  }
}
