// GET /api/market — everything the Blend needs for the week being priced, in one
// call: game lines (Pinnacle, ESPN backup), consensus player props (Pinnacle +
// Underdog) and ESPN's projections. Sources are independent; one failing never
// blanks the others.

import type { GameLine, MarketSnapshot, PropLine, SourceState } from '../shared/market.js'
import { fetchPinnacle, fetchUnderdog, consensus } from './_lib/books.js'
import { cached } from './_lib/cache.js'
import { fetchEspnLines, fetchEspnProjections } from './_lib/espn.js'
import { weekCtx } from './_lib/sleeper.js'

export const maxDuration = 60

const MIN = 60_000

async function build(): Promise<MarketSnapshot> {
  const wk = await weekCtx()
  const [pin, ud, espnLines, espnProj] = await Promise.allSettled([
    cached('pinnacle', 10 * MIN, fetchPinnacle),
    cached('underdog', 10 * MIN, fetchUnderdog),
    cached(`espn-lines-${wk.season}-${wk.week}`, 10 * MIN, () => fetchEspnLines(wk.season, wk.week)),
    cached(`espn-proj-${wk.season}-${wk.week}`, 180 * MIN, () => fetchEspnProjections(wk.season, wk.week)),
  ])
  const state = (r: PromiseSettledResult<unknown>, count: number): SourceState =>
    r.status === 'fulfilled' ? { ok: true, count } : { ok: false, count: 0, error: String(r.reason?.message ?? r.reason).slice(0, 160) }

  // Books price next week's slate days early: keep only this week's pairings.
  const inWeek = <T extends { home: string; away: string }>(xs: T[]) => {
    if (!wk.pairs.size) return xs
    const kept = xs.filter((g) => wk.pairs.has(`${g.home}|${g.away}`) || wk.pairs.has(`${g.away}|${g.home}`))
    return kept.length ? kept : xs
  }

  // Lines: Pinnacle (sharp, has team totals); ESPN fills any game Pinnacle lacks.
  const pinGames = inWeek(pin.status === 'fulfilled' ? pin.value.games : [])
  const games: GameLine[] = [...pinGames]
  const seen = new Set(pinGames.map((g) => `${g.home}|${g.away}`))
  for (const g of inWeek(espnLines.status === 'fulfilled' ? espnLines.value : []))
    if (!seen.has(`${g.home}|${g.away}`)) games.push(g)

  const rawProps: PropLine[] = inWeek([
    ...(pin.status === 'fulfilled' ? pin.value.props : []),
    ...(ud.status === 'fulfilled' ? ud.value : []),
  ])
  const espn = espnProj.status === 'fulfilled' ? espnProj.value : []

  return {
    updatedAt: Date.now(),
    season: wk.season,
    week: wk.week,
    games,
    props: consensus(rawProps),
    espn,
    sources: {
      pinnacle: state(pin, pin.status === 'fulfilled' ? pin.value.props.length : 0),
      underdog: state(ud, ud.status === 'fulfilled' ? ud.value.length : 0),
      espnLines: state(espnLines, espnLines.status === 'fulfilled' ? espnLines.value.length : 0),
      espnProj: state(espnProj, espn.length),
    },
  }
}

export async function GET() {
  try {
    const snap = await cached('market', 5 * MIN, build)
    return Response.json(snap, { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=1800' } })
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 })
  }
}
