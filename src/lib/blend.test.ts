import { describe, expect, it } from 'vitest'
import type { MarketSnapshot } from '../../shared/market'
import { blendPlayer, buildBlendCtx, healthFactor, marketMean } from './blend'
import type { EvalContext } from './trade'
import type { Player } from './types'
import { rankPickups } from './waivers'

const player = (id: string, first: string, last: string, pos: string, team: string, extra: Partial<Player> = {}): Player => ({
  id, first, last, pos, positions: [pos], team, injury: null, status: 'Active', practice: null, espnId: null, rank: 1,
  bodyPart: null, injuryNotes: null, injuryStart: null, practiceNote: null, newsUpdated: null, ...extra,
})

const PPR = { rec: 1, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, pass_yd: 0.04, pass_td: 4 }

describe('marketMean', () => {
  it('is the line at even juice and shifts toward the favored side', () => {
    expect(marketMean('rec_yds', 60.5, 0.5)).toBeCloseTo(60.5, 5)
    expect(marketMean('rec_yds', 60.5, 0.6)).toBeGreaterThan(60.5)
    expect(marketMean('rec_yds', 60.5, 0.4)).toBeLessThan(60.5)
  })
  it('caps the shift at 15% of the line', () => {
    expect(marketMean('rec_yds', 50, 0.999)).toBeCloseTo(57.5, 5)
  })
})

describe('healthFactor', () => {
  it('reads practice reports on Questionable tags', () => {
    expect(healthFactor(player('1', 'A', 'B', 'WR', 'DAL', { injury: 'Questionable', practice: 'Did Not Participate' }))).toBe(0.6)
    expect(healthFactor(player('1', 'A', 'B', 'WR', 'DAL', { injury: 'Questionable', practice: 'Limited' }))).toBe(0.85)
    expect(healthFactor(player('1', 'A', 'B', 'WR', 'DAL', { injury: 'Out' }))).toBe(0)
    expect(healthFactor(player('1', 'A', 'B', 'WR', null as unknown as string))).toBe(0)
  })
})

describe('blendPlayer', () => {
  const wr = player('100', 'Ceedee', 'Lamb', 'WR', 'DAL')
  const market: MarketSnapshot = {
    updatedAt: 0, season: '2026', week: 5,
    games: [{ home: 'DAL', away: 'TB', kickoff: 0, spread: -3, total: 50, homeTT: 26.5, awayTT: 23.5, source: 'pinnacle' }],
    props: [{ name: 'CeeDee Lamb', home: 'DAL', away: 'TB', market: 'rec_yds', line: 90.5, overProb: 0.5, books: 2, sources: ['pinnacle', 'underdog'] }],
    espn: [],
    sources: {} as MarketSnapshot['sources'],
  }
  const ctx = buildBlendCtx(market, null, new Map([[wr.id, wr]]))
  const wk = { stats: { rec: 6, rec_yd: 70, rec_td: 0.5 }, opponent: 'TB', away: false }

  it('matches props by normalized name and anchors the priced stat to the book', () => {
    expect(ctx.stats.propsMatched).toBe(1)
    const r = blendPlayer(ctx, wr.id, wr, 5, wk, PPR)
    expect(r.sleeper).toBe(16)
    // rec_yd: 0.85 * 90.5 + 0.15 * 70 = 87.43; receptions dragged up with it
    expect(r.contrib.vegas).toBeGreaterThan(1.7)
    expect(r.points).toBeGreaterThan(r.sleeper)
  })

  it('leaves weeks the books are not pricing at Sleeper (no DvP loaded)', () => {
    expect(blendPlayer(ctx, wr.id, wr, 6, wk, PPR).points).toBe(16)
  })

  it('zeros a bye week', () => {
    expect(blendPlayer(ctx, wr.id, wr, 5, null, PPR).points).toBe(0)
  })
})

describe('rankPickups', () => {
  const pos: Record<string, string> = { qb1: 'QB', qb2: 'QB', rb1: 'RB', wr1: 'WR', wr2: 'WR', wr3: 'WR', faQB: 'QB', faRB: 'RB', faWR: 'WR' }
  const pts: Record<string, number> = { qb1: 20, qb2: 15, rb1: 12, wr1: 14, wr2: 11, wr3: 9, faQB: 30, faRB: 6, faWR: 5 }
  const ctx: EvalContext = {
    slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX'],
    limit: 9,
    weeks: [5],
    points: (id) => pts[id] ?? 0,
    positionsOf: (id) => [pos[id]],
  }
  const roster = ['qb1', 'qb2', 'rb1', 'wr1', 'wr2', 'wr3']

  it('never suggests a third QB, even one who would outscore the starter', () => {
    // faQB (30) would beat qb1 (20), but two QBs is the cap in a one-QB league
    const out = rankPickups(roster, ['faQB', 'faRB', 'faWR'], ctx, (id) => pos[id])
    expect(out.map((p) => [p.id, p.gain])).toEqual([['faRB', 6], ['faWR', 0]])
  })

  it('does suggest a backup QB when there is only one', () => {
    const out = rankPickups(['qb1', 'rb1', 'wr1', 'wr2', 'wr3'], ['faQB'], ctx, (id) => pos[id])
    expect(out.map((p) => p.id)).toEqual(['faQB'])
  })
})
