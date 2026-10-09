import { optimizeLineup, SLOT_ELIGIBILITY } from './lineup'
import { scoreStats } from './scoring'
import type { EvalContext } from './trade'
import type { Player } from './types'

const OFFENSE = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

let weekPool: { key: string; rows: Promise<{ player_id: string; stats: Record<string, number> }[]> } | null = null

/** One bulk call: every projected player for a week (used only to shortlist free agents). */
function weekProjections(season: string, week: number) {
  const key = `${season}:${week}`
  if (weekPool?.key !== key) {
    const pos = OFFENSE.map((p) => `position[]=${p}`).join('&')
    weekPool = {
      key,
      rows: fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${pos}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    }
  }
  return weekPool.rows
}

/**
 * Shortlist free agents worth evaluating: the best few unrostered players at each
 * position the league can start, by this week's projection. The full horizon value is
 * computed later from per-player projections.
 */
export async function freeAgentShortlist(
  season: string,
  week: number,
  rostered: Set<string>,
  players: Map<string, Player>,
  slots: string[],
  scoring: Record<string, number>,
  perPosition = 10,
): Promise<string[]> {
  const startable = new Set(slots.flatMap((s) => SLOT_ELIGIBILITY[s] ?? []))
  const rows = await weekProjections(season, week)
  const byPos = new Map<string, { id: string; pts: number }[]>()
  for (const r of rows) {
    const p = players.get(r.player_id)
    if (!p || rostered.has(p.id) || !p.team || !startable.has(p.pos)) continue
    if (p.injury && ['Out', 'IR', 'PUP', 'Sus'].includes(p.injury)) continue
    const pts = scoreStats(r.stats ?? {}, scoring)
    if (pts <= 0) continue
    byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), { id: p.id, pts }])
  }
  return [...byPos.values()].flatMap((list) =>
    list
      .sort((a, b) => b.pts - a.pts)
      .slice(0, perPosition)
      .map((x) => x.id),
  )
}

export interface Pickup {
  id: string
  /** Points added to the optimal lineups over the horizon. */
  gain: number
  /** Weeks in the horizon where this player would start. */
  startWeeks: number[]
  /** Raw projected points over the horizon. */
  total: number
  reason: string
}

/** How many of a position a roster can usefully hold before the next one is dead weight. */
export function positionCaps(slots: string[]): Record<string, number> {
  const count = (pred: (s: string) => boolean) => slots.filter(pred).length
  const sf = count((s) => s === 'SUPER_FLEX')
  return {
    QB: count((s) => s === 'QB') + sf + 1,
    TE: count((s) => s === 'TE') + 1,
    K: count((s) => s === 'K'),
    DEF: count((s) => s === 'DEF'),
  }
}

/** Starting demand per position: fixed slots, plus an even share of each flex it fits. */
function demand(slots: string[], pos: string): number {
  let d = 0
  for (const s of slots) {
    const ok = SLOT_ELIGIBILITY[s] ?? []
    if (ok.includes(pos)) d += 1 / ok.length
  }
  return d
}

/**
 * Rank pickups for a roster by what they actually add to its optimal lineups over the
 * horizon. That's positionally aware by construction: a third QB never starts in a
 * one-QB league, so he adds nothing however many points he's projected. Ties (pure
 * depth adds) go to the position the roster is thinnest at relative to what it starts.
 */
export function rankPickups(
  roster: string[],
  candidates: string[],
  ctx: EvalContext,
  posOf: (id: string) => string,
  limit = 6,
): Pickup[] {
  const caps = positionCaps(ctx.slots)
  const counts = new Map<string, number>()
  for (const id of roster) counts.set(posOf(id), (counts.get(posOf(id)) ?? 0) + 1)

  const base = ctx.weeks.map((w) =>
    optimizeLineup(ctx.slots, roster.map((id) => ({ id, positions: ctx.positionsOf(id), points: ctx.points(id, w) }))).total,
  )

  const out: (Pickup & { need: number })[] = []
  for (const id of candidates) {
    if (roster.includes(id)) continue
    const pos = posOf(id)
    const startWeeks: number[] = []
    let gain = 0
    let total = 0
    ctx.weeks.forEach((w, i) => {
      const pts = ctx.points(id, w)
      total += pts
      if (pts <= 0) return
      const lu = optimizeLineup(
        ctx.slots,
        [...roster, id].map((x) => ({ id: x, positions: ctx.positionsOf(x), points: ctx.points(x, w) })),
      )
      const d = lu.total - base[i]
      if (d > 0.005) {
        gain += d
        startWeeks.push(w)
      }
    })
    const have = counts.get(pos) ?? 0
    const cap = caps[pos]
    const starts = gain > 0.05
    // Over the cap at QB/TE/K/DEF (a third QB, a third TE): only for a real upgrade or a
    // bye/injury fill-in, never for a fraction of a point.
    if (cap !== undefined && have >= cap && gain / ctx.weeks.length < 1.5) continue
    const dem = demand(ctx.slots, pos)
    if (dem === 0) continue
    // Depth target: the position's share of the starting lineup, scaled up to the whole
    // roster, never past the cap. Shortfall against it is what a depth add should fix.
    const target = Math.min(cap ?? Infinity, (dem * ctx.limit) / ctx.slots.length)
    const need = target - have
    if (!starts && need <= 0) continue
    const reason = starts
      ? startWeeks.length === ctx.weeks.length
        ? `Starts every week · +${gain.toFixed(1)}`
        : `Starts Wk ${startWeeks.join(', ')} · +${gain.toFixed(1)}`
      : `${pos} depth · you have ${have}`
    out.push({ id, gain: starts ? Math.round(gain * 100) / 100 : 0, startWeeks, total: Math.round(total * 10) / 10, reason, need })
  }
  // Real lineup gains first; then depth at the thinnest position; no more than two per position.
  out.sort((a, b) => b.gain - a.gain || b.need - a.need || b.total - a.total)
  const perPos = new Map<string, number>()
  const picked: Pickup[] = []
  for (const { need, ...p } of out) {
    void need
    const pos = posOf(p.id)
    if ((perPos.get(pos) ?? 0) >= 2) continue
    perPos.set(pos, (perPos.get(pos) ?? 0) + 1)
    picked.push(p)
    if (picked.length >= limit) break
  }
  return picked
}
