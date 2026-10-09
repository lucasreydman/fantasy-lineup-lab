import { describe, expect, it } from 'vitest'
import { optimizeLineup, rosterLimit } from './lineup'
import { scoreStats } from './scoring'
import { evaluateTeam, moveTags, type EvalContext } from './trade'
import type { Team } from './types'

const p = (id: string, pos: string, points: number) => ({ id, positions: [pos], points })

describe('optimizeLineup', () => {
  it('fills fixed slots then flex with the best leftover', () => {
    const lu = optimizeLineup(
      ['QB', 'RB', 'WR', 'TE', 'FLEX'],
      [p('qb', 'QB', 20), p('rb1', 'RB', 15), p('rb2', 'RB', 12), p('wr1', 'WR', 14), p('te', 'TE', 8), p('wr2', 'WR', 9)],
    )
    expect(lu.slots.map((s) => s.playerId)).toEqual(['qb', 'rb1', 'wr1', 'te', 'rb2'])
    expect(lu.bench).toEqual(['wr2'])
    expect(lu.total).toBe(69)
  })

  it('beats greedy on overlapping flexes', () => {
    // Greedy filling W/T first with the WR (18) leaves W/R to the bad RB.
    const lu = optimizeLineup(
      ['WRRB_FLEX', 'REC_FLEX'],
      [p('wr', 'WR', 18), p('te', 'TE', 10), p('rb', 'RB', 3)],
    )
    expect(lu.total).toBe(28)
  })

  it('starts a 0-point player over leaving a slot empty, and leaves it empty when nobody fits', () => {
    const lu = optimizeLineup(['TE', 'K'], [p('te', 'TE', 0)])
    expect(lu.slots[0].playerId).toBe('te')
    expect(lu.slots[1].playerId).toBeNull()
  })

  it('orders same-type slots by projection', () => {
    const lu = optimizeLineup(['RB', 'RB'], [p('a', 'RB', 5), p('b', 'RB', 11)])
    expect(lu.slots.map((s) => s.playerId)).toEqual(['b', 'a'])
  })
})

describe('scoring', () => {
  it('dots stats with scoring settings', () => {
    expect(scoreStats({ rec: 5, rec_yd: 80, rec_td: 1, unknown: 9 }, { rec: 1, rec_yd: 0.1, rec_td: 6 })).toBe(19)
  })
  it('roster limit ignores IR and taxi', () => {
    expect(rosterLimit(['QB', 'RB', 'BN', 'BN', 'IR', 'TAXI'])).toBe(4)
  })
})

describe('evaluateTeam', () => {
  const pos: Record<string, string> = { qb: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', wr1: 'WR', wr2: 'WR', wrX: 'WR', star: 'WR' }
  const pts: Record<string, number> = { qb: 20, rb1: 15, rb2: 12, rb3: 4, wr1: 14, wr2: 9, wrX: 2, star: 25 }
  const ctx: EvalContext = {
    slots: ['QB', 'RB', 'WR', 'FLEX'],
    limit: 6,
    weeks: [1, 2],
    points: (id, week) => (week === 2 && id === 'star' ? 0 : pts[id] ?? 0), // star on bye wk2
    positionsOf: (id) => [pos[id]],
  }
  const team: Team = {
    rosterId: 1, name: 'T', ownerName: 'o', avatarUrl: null, ownerIds: [],
    active: ['qb', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2'], reserve: [], taxi: [],
  }

  it('2-for-1: frees a roster spot, elevates a bench player', () => {
    const ev = evaluateTeam(team, ['star'], ['rb1', 'wr1'], [], ctx)
    expect(ev.dropsNeeded).toBe(0)
    expect(ev.rosterAfter).toHaveLength(5)
    const wk1 = ev.weeks[0]
    expect(wk1.after.slots.map((s) => s.playerId)).toEqual(['qb', 'rb2', 'star', 'wr2'])
    const tags = moveTags(wk1, ev.incoming)
    expect(tags.get('star')).toBe('acquired')
    expect(tags.get('wr2')).toBe('elevated')
  })

  it('1-for-2: forces a drop and picks the least valuable bench player', () => {
    const ev = evaluateTeam(team, ['star', 'wrX'], ['wr2'], [], ctx)
    expect(ev.dropsNeeded).toBe(1)
    // wrX was just acquired so it is protected; rb3 is the cheapest cut.
    expect(ev.autoDrops).toEqual(['rb3'])
  })

  it('respects manual drops', () => {
    const ev = evaluateTeam(team, ['star', 'wrX'], ['wr2'], ['wrX'], ctx)
    expect(ev.drops).toEqual(['wrX'])
    expect(ev.autoDrops).toEqual([])
  })
})
