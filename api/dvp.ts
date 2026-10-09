// GET /api/dvp — raw stat totals each defense allowed to each position: this season
// through the last completed week, plus all of last season (weighted client-side by
// its measured year-over-year predictiveness). Scored per league on the client.

import type { DvpSnapshot } from '../shared/market.js'
import { cached } from './_lib/cache.js'
import { buildDvp, completedWeeks, nflState } from './_lib/sleeper.js'

export const maxDuration = 60

const HOUR = 3_600_000

async function build(): Promise<DvpSnapshot> {
  const state = await nflState()
  const through = completedWeeks(state)
  const [current, prior] = await Promise.all([
    cached(`dvp-${state.season}-w${through}`, 24 * HOUR, () => buildDvp(state.season, through)),
    // A finished season never changes.
    cached(`dvp-${state.previous_season}-full`, 7 * 24 * HOUR, () => buildDvp(state.previous_season, 18)),
  ])
  return {
    updatedAt: Date.now(),
    season: state.season,
    throughWeek: through,
    current,
    prior: { season: state.previous_season, agg: prior },
  }
}

export async function GET() {
  try {
    const snap = await cached('dvp', HOUR, build)
    return Response.json(snap, { headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } })
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 })
  }
}
