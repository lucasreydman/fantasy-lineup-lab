import { describe, expect, it } from 'vitest'
import { playoffWeeks } from './season'
import { optimizeLineup, rosterLimit } from './lineup'
import { scoreStats } from './scoring'
import { emptyPlan, evaluateTeam, moveTags, type EvalContext, type TeamEnv, type TeamPlan } from './trade'
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
  const pos: Record<string, string> = {
    qb: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', wr1: 'WR', wr2: 'WR', wrX: 'WR', star: 'WR', hurt: 'RB', late: 'WR', fa1: 'RB', fa2: 'WR',
  }
  const pts: Record<string, number> = { qb: 20, rb1: 15, rb2: 12, rb3: 4, wr1: 14, wr2: 9, wrX: 2, star: 25, hurt: 0, fa1: 8, fa2: 3 }
  const points = (id: string, week: number) => {
    if (id === 'star' && week === 2) return 0 // bye
    if (id === 'late') return week >= 3 ? 16 : 0 // back from injury in week 3
    return pts[id] ?? 0
  }
  const view: EvalContext = { slots: ['QB', 'RB', 'WR', 'FLEX'], limit: 6, weeks: [1, 2], points, positionsOf: (id) => [pos[id]] }
  const team: Team = {
    rosterId: 1, name: 'T', ownerName: 'o', avatarUrl: null, ownerIds: [],
    active: ['qb', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2'], reserve: [], taxi: [],
  }
  const env = (over: Partial<TeamEnv> = {}): TeamEnv => ({
    view,
    decide: { ...view, weeks: [1, 2, 3, 4, 5] },
    irSlots: 0,
    irEligible: () => false,
    pool: [],
    posOf: (id) => pos[id],
    ...over,
  })
  const plan = (p: Partial<TeamPlan>): TeamPlan => ({ ...emptyPlan(), ...p })

  it('2-for-1: elevates a bench player and fills the open spot with the best pickup', () => {
    const ev = evaluateTeam(team, plan({ incoming: ['star'], outgoing: ['rb1', 'wr1'] }), env({ pool: ['fa1', 'fa2'] }))
    expect(ev.drops).toEqual([])
    expect(ev.autoAdds).toEqual(['fa1']) // fa1 starts over rb3; fa2 would never start
    expect(ev.rosterAfter).toHaveLength(6)
    const wk1 = ev.weeks[0]
    const tags = moveTags(wk1, ev.incoming)
    expect(tags.get('star')).toBe('acquired')
    expect(tags.get('wr2')).toBe('elevated')
  })

  it('a declined pickup is skipped for the next best', () => {
    const ev = evaluateTeam(team, plan({ incoming: ['star'], outgoing: ['rb1', 'wr1'], declined: ['fa1'] }), env({ pool: ['fa1', 'fa2'] }))
    expect(ev.autoAdds).not.toContain('fa1')
  })

  it('1-for-2: cuts the least valuable player, never the one just acquired', () => {
    const ev = evaluateTeam(team, plan({ incoming: ['star', 'wrX'], outgoing: ['wr2'] }), env())
    expect(ev.autoDrops).toEqual(['rb3'])
  })

  it('judges cuts on rest of season, not the weeks on screen', () => {
    // 'late' scores 0 in the viewed weeks but 16 from week 3 on: rb3 goes, not him.
    const roster: Team = { ...team, active: [...team.active.slice(0, 5), 'late'] }
    const ev = evaluateTeam(roster, plan({ incoming: ['star'], outgoing: [] }), env())
    expect(ev.autoDrops).toEqual(['rb3'])
  })

  it('stashes an IR-eligible player instead of cutting someone', () => {
    const roster: Team = { ...team, active: [...team.active.slice(0, 5), 'hurt'] }
    const ev = evaluateTeam(
      roster,
      plan({ incoming: ['star'], outgoing: [] }),
      env({ irSlots: 1, irEligible: (id) => id === 'hurt' }),
    )
    expect(ev.autoIr).toEqual(['hurt'])
    expect(ev.drops).toEqual([])
    expect(ev.irAfter).toEqual(['hurt'])
  })

  it('respects manual drops and keeps', () => {
    expect(evaluateTeam(team, plan({ incoming: ['star', 'wrX'], outgoing: ['wr2'], drops: ['wrX'] }), env()).autoDrops).toEqual([])
    const kept = evaluateTeam(team, plan({ incoming: ['star', 'wrX'], outgoing: ['wr2'], keeps: ['rb3'] }), env())
    expect(kept.autoDrops).not.toContain('rb3')
  })
})

describe('bench order', () => {
  it('reads QB, RB, WR, TE, K, then by projection', () => {
    const lu = optimizeLineup(['FLEX'], [p('te', 'TE', 9), p('wr', 'WR', 8), p('k', 'K', 7), p('qb', 'QB', 3), p('rb2', 'RB', 4), p('rb1', 'RB', 6), p('star', 'WR', 30)])
    expect(lu.bench).toEqual(['qb', 'rb1', 'rb2', 'wr', 'te', 'k'])
  })
})

describe('playoffWeeks', () => {
  it('reads the bracket from league settings', () => {
    expect(playoffWeeks({ playoff_week_start: 15, playoff_teams: 6 })).toEqual({ start: 15, end: 17 })
    expect(playoffWeeks({ playoff_week_start: 14, playoff_teams: 6 })).toEqual({ start: 14, end: 16 })
    expect(playoffWeeks({ playoff_week_start: 15, playoff_teams: 4 })).toEqual({ start: 15, end: 16 })
    expect(playoffWeeks({ playoff_week_start: 15, playoff_teams: 4, playoff_round_type: 1 })).toEqual({ start: 15, end: 17 })
    expect(playoffWeeks({ playoff_week_start: 14, playoff_teams: 8, playoff_round_type: 2 })).toEqual({ start: 14, end: 18 })
    expect(playoffWeeks({})).toEqual({ start: 15, end: 17 })
  })
})
