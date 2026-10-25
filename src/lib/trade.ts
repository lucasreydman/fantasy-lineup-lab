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

/** An IR player coming back: activated the first week he's projected to play, cutting the cheapest player if the roster is full. */
export interface Return {
  id: string
  week: number
  drop: string | null
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
  /** IR players coming back in a later week, with who gets cut for them. */
  returns: Return[]
  /** IR returns the team would make without the trade (the baseline). */
  returnsBefore: Return[]
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

/** Lineups over the context's weeks when IR players play again from the week they're back. */
function horizonWithIr(ids: string[], ir: string[], ctx: EvalContext, back: (id: string, week: number) => boolean): number {
  return ctx.weeks.reduce((s, w) => s + lineupFor([...ids, ...ir.filter((id) => back(id, w))], w, ctx).total, 0)
}

/** Active roster in a given week once the scheduled IR returns (and their cuts) have happened. */
function rosterAt(active: string[], returns: Return[], week: number): string[] {
  let ids = active
  for (const r of returns) {
    if (r.week > week) continue
    ids = [...ids.filter((id) => id !== r.drop), r.id]
  }
  return ids
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
  /** Stashing on IR rather than cutting: the player still counts from the week he's back. */
  stash?: { ir: string[]; back: (id: string, week: number) => boolean },
): string[] {
  let current = [...roster]
  const drops: string[] = []
  const value = (ids: string[], gone: string[]) =>
    stash ? horizonWithIr(ids, [...stash.ir, ...gone], ctx, stash.back) : horizonTotal(ids, ctx)
  for (let k = 0; k < count; k++) {
    const base = value(current, drops)
    let best: { id: string; loss: number; raw: number } | null = null
    for (const id of current) {
      if (protectedIds.has(id) || !allowed(id)) continue
      const loss = base - value(current.filter((x) => x !== id), [...drops, id])
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
 * When an IR player can play again: the first week he's projected to score, never the
 * current week while he's still IR-eligible (he can't be activated yet). A player
 * sitting on IR without an IR-eligible tag is healthy and comes off this week.
 */
function backWhen(env: TeamEnv) {
  const now = env.decide.weeks[0]
  return (id: string, week: number) => (week > now || !env.irEligible(id)) && env.decide.points(id, week) > 0
}

/**
 * Schedule every IR return over the rest of the season, earliest first: activate the
 * player the first week he's back and, if the roster is full, cut whoever costs the
 * lineups least from that week on. Players the user kept on IR stay there.
 */
function scheduleReturns(
  active: string[],
  reserve: string[],
  protectedIds: Set<string>,
  limit: number,
  env: TeamEnv,
): Return[] {
  const back = backWhen(env)
  const due = reserve
    .map((id) => ({ id, week: env.decide.weeks.find((w) => back(id, w)) }))
    .filter((r): r is { id: string; week: number } => r.week !== undefined)
    .sort((a, b) => a.week - b.week)
  const out: Return[] = []
  let current = [...active]
  for (const { id, week } of due) {
    const withHim = [...current, id]
    const from = { ...env.decide, weeks: env.decide.weeks.filter((w) => w >= week) }
    const drop =
      withHim.length > limit ? chooseDrops(withHim, 1, new Set([...protectedIds, id, ...due.map((d) => d.id)]), from)[0] ?? null : null
    current = withHim.filter((x) => x !== drop)
    out.push({ id, week, drop })
  }
  return out
}

interface Settled {
  active: string[]
  reserve: string[]
  sizeAfterTrade: number
  drops: string[]
  autoDrops: string[]
  stashed: string[]
  autoIr: string[]
  autoAdds: string[]
  autoActivations: string[]
  options: Pickup[]
  open: number
  scanning: boolean
  returns: Return[]
}

/**
 * Apply a trade plus the user's moves, then make the roster legal the smart way,
 * judged over the rest of the season:
 *   over the limit  -> stash IR-eligible players first (free), then cut the cheapest
 *   healthy on IR   -> activate him now, cutting the cheapest if there's no room
 *   under the limit -> fill each open spot with the best pickup
 *   back later      -> activate each IR player the week he returns, cutting the cheapest then
 */
function settle(team: Team, plan: TeamPlan, env: TeamEnv): Settled {
  const { view, decide } = env
  const back = backWhen(env)
  const out = new Set(plan.outgoing)
  let reserve = team.reserve.filter((id) => !out.has(id) && !plan.activations.includes(id))
  // Deduped: a player can only be on the roster once, whatever the plan says.
  const traded = [...new Set([...team.active.filter((id) => !out.has(id)), ...plan.incoming, ...plan.adds, ...plan.activations])]

  const irRoom = Math.max(0, env.irSlots - reserve.length)
  const stashed = plan.toIr.filter((id) => traded.includes(id)).slice(0, irRoom)
  let active = traded.filter((id) => !stashed.includes(id))
  const sizeAfterTrade = active.length
  const limit = view.limit

  const drops = plan.drops.filter((id) => active.includes(id))
  active = active.filter((id) => !drops.includes(id))

  // Over the limit: IR first, it costs nothing to stash a player who can't play anyway,
  // and he still counts from the week he's back.
  let over = active.length - limit
  const autoIr =
    over > 0 && irRoom - stashed.length > 0
      ? chooseDrops(active, Math.min(over, irRoom - stashed.length), new Set(plan.keeps), decide, env.irEligible, {
          ir: [...reserve, ...stashed],
          back,
        })
      : []
  active = active.filter((id) => !autoIr.includes(id))
  over -= autoIr.length

  const userChose = new Set([...plan.incoming, ...plan.adds, ...plan.activations, ...plan.keeps])
  const autoDrops = over > 0 ? chooseDrops(active, over, userChose, decide) : []
  active = active.filter((id) => !autoDrops.includes(id))

  // Healthy players sitting on IR come off it now (Sleeper won't allow moves until they do).
  const autoActivations: string[] = []
  for (const id of reserve) {
    if (env.irEligible(id) || plan.declined.includes(id) || !back(id, decide.weeks[0])) continue
    autoActivations.push(id)
    active = [...active, id]
    if (active.length > limit) {
      const cut = chooseDrops(active, 1, new Set([...userChose, ...autoActivations]), decide)[0]
      if (cut) {
        autoDrops.push(cut)
        active = active.filter((x) => x !== cut)
      }
    }
  }
  reserve = reserve.filter((id) => !autoActivations.includes(id))

  // Under the limit: fill each spot with the best ROS add, re-ranking after each pick
  // so the second pickup accounts for the first (no two backup TEs).
  const autoAdds: string[] = []
  let options: Pickup[] = []
  let open = limit - active.length
  const scanning = open > 0 && env.pool === null
  if (open > 0) {
    let candidates = (env.pool ?? []).filter((id) => !plan.declined.includes(id) && !active.includes(id))
    while (open > 0 && candidates.length) {
      const ranked = rankPickups(active, candidates, decide, env.posOf, 6)
      if (!options.length) options = ranked
      const pick = ranked[0]
      if (!pick) break
      autoAdds.push(pick.id)
      active = [...active, pick.id]
      candidates = candidates.filter((id) => id !== pick.id)
      open--
    }
  }

  const ir = [...reserve, ...stashed, ...autoIr]
  const returns = scheduleReturns(
    active,
    ir.filter((id) => !plan.declined.includes(id)),
    new Set([...userChose, ...autoActivations]),
    limit,
    env,
  )
  return { active, reserve: ir, sizeAfterTrade, drops, autoDrops, stashed, autoIr, autoAdds, autoActivations, options, open, scanning, returns }
}

/**
 * Before vs after the trade, both played out the same way: IR players come back the week
 * they're projected to play, so a return you'd get anyway isn't credited to the trade,
 * and trading away a player on IR costs every week he'd have started.
 */
export function evaluateTeam(team: Team, plan: TeamPlan, env: TeamEnv): TeamEval {
  const { view } = env
  const base = settle(team, { ...emptyPlan(), keeps: plan.keeps, declined: plan.declined }, { ...env, pool: [] })
  const after = settle(team, plan, env)

  const weeks = view.weeks.map((week) => ({
    week,
    before: lineupFor(rosterAt(base.active, base.returns, week), week, view),
    after: lineupFor(rosterAt(after.active, after.returns, week), week, view),
  }))
  const round = (x: number) => Math.round(x * 100) / 100
  const beforeTotal = round(weeks.reduce((s, w) => s + w.before.total, 0))
  const afterTotal = round(weeks.reduce((s, w) => s + w.after.total, 0))

  return {
    incoming: plan.incoming,
    outgoing: plan.outgoing,
    rosterAfter: after.active,
    irAfter: after.reserve,
    sizeAfterTrade: after.sizeAfterTrade,
    limit: view.limit,
    drops: [...after.drops, ...after.autoDrops],
    autoDrops: after.autoDrops,
    stashed: after.stashed,
    autoIr: after.autoIr,
    adds: plan.adds,
    autoAdds: after.autoAdds,
    activations: plan.activations,
    autoActivations: after.autoActivations,
    returns: after.returns,
    returnsBefore: base.returns,
    options: after.options,
    openSpots: after.open,
    scanning: after.scanning,
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
