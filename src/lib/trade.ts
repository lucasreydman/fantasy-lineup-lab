import { optimizeLineup, type Lineup } from './lineup'
import type { PointsFn } from './scoring'
import type { Team } from './types'

export interface EvalContext {
  slots: string[]
  limit: number
  weeks: number[]
  points: PointsFn
  positionsOf: (id: string) => string[]
}

export interface WeekResult {
  week: number
  before: Lineup
  after: Lineup
}

export interface TeamEval {
  incoming: string[]
  outgoing: string[]
  /** Active roster after the trade and after drops. */
  rosterAfter: string[]
  /** Size of the active roster after the trade, before drops. */
  sizeAfterTrade: number
  limit: number
  /** How many players must be cut to get back under the roster limit. */
  dropsNeeded: number
  drops: string[]
  autoDrops: string[]
  weeks: WeekResult[]
  beforeTotal: number
  afterTotal: number
  delta: number
}

function lineupFor(ids: string[], week: number, ctx: EvalContext): Lineup {
  return optimizeLineup(
    ctx.slots,
    ids.map((id) => ({ id, positions: ctx.positionsOf(id), points: ctx.points(id, week) })),
  )
}

function horizonTotal(ids: string[], ctx: EvalContext): number {
  return ctx.weeks.reduce((s, w) => s + lineupFor(ids, w, ctx).total, 0)
}

function rawTotal(id: string, ctx: EvalContext): number {
  return ctx.weeks.reduce((s, w) => s + ctx.points(id, w), 0)
}

/**
 * Pick who to cut when a trade overfills the roster: repeatedly drop the player
 * whose loss hurts the optimal lineups least over the horizon, tie-breaking on
 * lowest raw projection. Players just acquired are never auto-dropped.
 */
export function chooseDrops(
  roster: string[],
  count: number,
  protectedIds: Set<string>,
  ctx: EvalContext,
): string[] {
  let current = [...roster]
  const drops: string[] = []
  for (let k = 0; k < count; k++) {
    const base = horizonTotal(current, ctx)
    let best: { id: string; loss: number; raw: number } | null = null
    for (const id of current) {
      if (protectedIds.has(id)) continue
      const loss = base - horizonTotal(current.filter((x) => x !== id), ctx)
      const raw = rawTotal(id, ctx)
      if (
        !best ||
        loss < best.loss - 1e-6 ||
        (Math.abs(loss - best.loss) <= 1e-6 && raw < best.raw)
      ) {
        best = { id, loss, raw }
      }
    }
    if (!best) break
    drops.push(best.id)
    current = current.filter((x) => x !== best.id)
  }
  return drops
}

export function evaluateTeam(
  team: Team,
  incoming: string[],
  outgoing: string[],
  manualDrops: string[],
  ctx: EvalContext,
  /** Players the user refused to auto-drop. */
  keeps: string[] = [],
): TeamEval {
  const out = new Set(outgoing)
  const afterTrade = [...team.active.filter((id) => !out.has(id)), ...incoming]
  const dropsNeeded = Math.max(0, afterTrade.length - ctx.limit)

  const manual = manualDrops.filter((id) => afterTrade.includes(id))
  const remaining = afterTrade.filter((id) => !manual.includes(id))
  const autoDrops =
    manual.length < dropsNeeded
      ? chooseDrops(remaining, dropsNeeded - manual.length, new Set([...incoming, ...keeps]), ctx)
      : []
  const drops = [...manual, ...autoDrops]
  const rosterAfter = remaining.filter((id) => !autoDrops.includes(id))

  const weeks = ctx.weeks.map((week) => ({
    week,
    before: lineupFor(team.active, week, ctx),
    after: lineupFor(rosterAfter, week, ctx),
  }))
  const round = (x: number) => Math.round(x * 100) / 100
  const beforeTotal = round(weeks.reduce((s, w) => s + w.before.total, 0))
  const afterTotal = round(weeks.reduce((s, w) => s + w.after.total, 0))

  return {
    incoming,
    outgoing,
    rosterAfter,
    sizeAfterTrade: afterTrade.length,
    limit: ctx.limit,
    dropsNeeded,
    drops,
    autoDrops,
    weeks,
    beforeTotal,
    afterTotal,
    delta: round(afterTotal - beforeTotal),
  }
}

export type MoveTag = 'acquired' | 'elevated' | 'benched' | null

/** How a player's role changed between the before/after lineups of one week. */
export function moveTags(result: WeekResult, incoming: string[]): Map<string, MoveTag> {
  const before = new Set(result.before.slots.map((s) => s.playerId).filter(Boolean))
  const after = new Set(result.after.slots.map((s) => s.playerId).filter(Boolean))
  const tags = new Map<string, MoveTag>()
  for (const id of after) {
    if (!id) continue
    if (incoming.includes(id)) tags.set(id, 'acquired')
    else if (!before.has(id)) tags.set(id, 'elevated')
  }
  for (const id of result.after.bench) {
    if (before.has(id)) tags.set(id, 'benched')
    else if (incoming.includes(id)) tags.set(id, 'acquired')
  }
  return tags
}
