import { optimizeLineup, type Lineup } from './lineup'
import type { PointsFn } from './scoring'
import type { Team } from './types'
import { rankPickups, type Pickup } from './waivers'

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

/** Everything the user decided for one team; the automatic moves fill in the rest. */
export interface TeamPlan {
  /** Trade */
  incoming: string[]
  outgoing: string[]
  /** Waiver pickups the user chose */
  adds: string[]
  /** IR players the user activated */
  activations: string[]
  /** Players the user stashed on IR */
  toIr: string[]
  /** Players the user chose to cut */
  drops: string[]
  /** Players the user refused to let the automation cut or stash */
  keeps: string[]
  /** Pickups the user removed, so the automation doesn't re-add them */
  declined: string[]
}

export const emptyPlan = (): TeamPlan => ({
  incoming: [], outgoing: [], adds: [], activations: [], toIr: [], drops: [], keeps: [], declined: [],
})

export interface TeamEnv {
  /** The weeks on screen. */
  view: EvalContext
  /** Rest of season: what automatic drops, IR moves and pickups are judged on. */
  decide: EvalContext
  irSlots: number
  irEligible: (id: string) => boolean
  /** Free agents this team can claim; null while the wire is still loading. */
  pool: string[] | null
  posOf: (id: string) => string
}

export interface TeamEval {
  incoming: string[]
  outgoing: string[]
  /** Active roster after every move. */
  rosterAfter: string[]
  /** IR after every move. */
  irAfter: string[]
  /** Active roster size right after the trade and the user's own moves. */
  sizeAfterTrade: number
  limit: number
  drops: string[]
  autoDrops: string[]
  stashed: string[]
  autoIr: string[]
  adds: string[]
  autoAdds: string[]
  activations: string[]
  autoActivations: string[]
  /** Best pickups for the spots the trade opened, before any were filled. */
  options: Pickup[]
  /** Spots the automation couldn't fill yet (wire loading, or nobody worth adding). */
  openSpots: number
  scanning: boolean
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
 * Pick `count` players to take off the active roster: repeatedly the one whose loss
 * hurts the optimal lineups least over the context's weeks, tie-breaking on lowest
 * raw projection.
 */
export function chooseDrops(
  roster: string[],
  count: number,
  protectedIds: Set<string>,
  ctx: EvalContext,
  allowed: (id: string) => boolean = () => true,
): string[] {
  let current = [...roster]
  const drops: string[] = []
  for (let k = 0; k < count; k++) {
    const base = horizonTotal(current, ctx)
    let best: { id: string; loss: number; raw: number } | null = null
    for (const id of current) {
      if (protectedIds.has(id) || !allowed(id)) continue
      const loss = base - horizonTotal(current.filter((x) => x !== id), ctx)
      const raw = rawTotal(id, ctx)
      if (!best || loss < best.loss - 1e-6 || (Math.abs(loss - best.loss) <= 1e-6 && raw < best.raw)) {
        best = { id, loss, raw }
      }
    }
    if (!best) break
    drops.push(best.id)
    current = current.filter((x) => x !== best.id)
  }
  return drops
}

/**
 * Apply a trade plus the user's moves, then make the roster legal the smart way,
 * judged over the rest of the season:
 *   over the limit  -> stash IR-eligible players first (free), then cut the cheapest
 *   under the limit -> fill each open spot with the best pickup or IR activation
 */
export function evaluateTeam(team: Team, plan: TeamPlan, env: TeamEnv): TeamEval {
  const { view, decide } = env
  const out = new Set(plan.outgoing)
  const reserve = team.reserve.filter((id) => !out.has(id) && !plan.activations.includes(id))
  const traded = [...team.active.filter((id) => !out.has(id)), ...plan.incoming, ...plan.adds, ...plan.activations]

  const irRoom = Math.max(0, env.irSlots - reserve.length)
  const stashed = plan.toIr.filter((id) => traded.includes(id)).slice(0, irRoom)
  let active = traded.filter((id) => !stashed.includes(id))
  const sizeAfterTrade = active.length
  const limit = view.limit

  const drops = plan.drops.filter((id) => active.includes(id))
  active = active.filter((id) => !drops.includes(id))

  // Over the limit: IR first, it costs nothing to stash a player who can't play anyway.
  let over = active.length - limit
  const autoIr =
    over > 0 && irRoom - stashed.length > 0
      ? chooseDrops(active, Math.min(over, irRoom - stashed.length), new Set(plan.keeps), decide, env.irEligible)
      : []
  active = active.filter((id) => !autoIr.includes(id))
  over -= autoIr.length

  const userChose = new Set([...plan.incoming, ...plan.adds, ...plan.activations, ...plan.keeps])
  const autoDrops = over > 0 ? chooseDrops(active, over, userChose, decide) : []
  active = active.filter((id) => !autoDrops.includes(id))

  // Under the limit: fill each spot with the best ROS add, re-ranking after each pick
  // so the second pickup accounts for the first (no two backup TEs).
  const autoAdds: string[] = []
  const autoActivations: string[] = []
  let options: Pickup[] = []
  let open = limit - active.length
  const scanning = open > 0 && env.pool === null
  if (open > 0) {
    let candidates = [
      ...(env.pool ?? []),
      ...reserve.filter((id) => !env.irEligible(id) || rawTotal(id, decide) > 0),
    ].filter((id) => !plan.declined.includes(id) && !active.includes(id))
    while (open > 0 && candidates.length) {
      const ranked = rankPickups(active, candidates, decide, env.posOf, 6)
      if (!options.length) options = ranked
      const pick = ranked[0]
      if (!pick) break
      ;(reserve.includes(pick.id) ? autoActivations : autoAdds).push(pick.id)
      active = [...active, pick.id]
      candidates = candidates.filter((id) => id !== pick.id)
      open--
    }
  }

  const irAfter = [...reserve.filter((id) => !autoActivations.includes(id)), ...stashed, ...autoIr]
  const weeks = view.weeks.map((week) => ({
    week,
    before: lineupFor(team.active, week, view),
    after: lineupFor(active, week, view),
  }))
  const round = (x: number) => Math.round(x * 100) / 100
  const beforeTotal = round(weeks.reduce((s, w) => s + w.before.total, 0))
  const afterTotal = round(weeks.reduce((s, w) => s + w.after.total, 0))

  return {
    incoming: plan.incoming,
    outgoing: plan.outgoing,
    rosterAfter: active,
    irAfter,
    sizeAfterTrade,
    limit,
    drops: [...drops, ...autoDrops],
    autoDrops,
    stashed,
    autoIr,
    adds: plan.adds,
    autoAdds,
    activations: plan.activations,
    autoActivations,
    options,
    openSpots: open,
    scanning,
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
