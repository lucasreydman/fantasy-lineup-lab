import { describe, expect, it } from 'vitest'
import { newsVsTag, playerFlags } from './flags'
import type { Player, PlayerProjections } from './types'

const base: Player = {
  id: 'p', first: 'A', last: 'B', pos: 'WR', positions: ['WR'], team: 'DAL', injury: null, status: 'Active', practice: null,
  espnId: null, rank: 1, bodyPart: null, injuryNotes: null, injuryStart: null, practiceNote: null, newsUpdated: null,
}
const wk = { stats: { rec: 5 }, opponent: 'NYG', away: false }
const proj: PlayerProjections = { 5: wk, 6: wk, 7: null, 8: wk }
const opts = (over: Partial<Parameters<typeof playerFlags>[1]> = {}) => ({
  currentWeek: 5, rosWeeks: [5, 6, 7, 8], points: () => 10, proj, now: 1_000_000_000_000, ...over,
})

describe('playerFlags', () => {
  it('a healthy player only gets the upcoming bye', () => {
    expect(playerFlags(base, opts()).map((f) => f.label)).toEqual(['Bye in Week 7'])
  })

  it('injury designation with body part and notes, worst first', () => {
    const f = playerFlags({ ...base, injury: 'Questionable', bodyPart: 'Hamstring', practice: 'Did Not Participate' }, opts())
    expect(f[0]).toMatchObject({ level: 'warn', label: 'Questionable', detail: 'Hamstring' })
    expect(f.map((x) => x.label)).toContain('Did not practice')
  })

  it('IR is a hard stop, and explains a zero projection without a second flag', () => {
    const f = playerFlags({ ...base, injury: 'IR', bodyPart: 'Knee', injuryNotes: 'ACL' }, opts({ points: () => 0 }))
    expect(f[0]).toMatchObject({ level: 'danger', label: 'On injured reserve', detail: 'Knee · ACL' })
    expect(f.some((x) => x.label.startsWith('Projected for 0'))).toBe(false)
  })

  it('a zero season with no injury tag is flagged', () => {
    const f = playerFlags(base, opts({ points: () => 0 }))
    expect(f[0]).toMatchObject({ level: 'danger', label: 'Projected for 0 points the rest of the season' })
  })

  it('released players and fresh news', () => {
    const f = playerFlags({ ...base, team: null, newsUpdated: 1_000_000_000_000 - 3600_000 }, opts())
    expect(f[0].label).toBe('Not on an NFL team')
    expect(f.map((x) => x.label)).toContain('News in the last 3 days')
  })

  it('on bye this week', () => {
    expect(playerFlags(base, opts({ currentWeek: 7 })).map((f) => f.label)).toContain('On bye in Week 7')
  })
})

describe('newsVsTag', () => {
  const q = { ...base, injury: 'Questionable' }
  it('spots a tagged player the news has cleared', () => {
    expect(newsVsTag(q, { title: 'Chris Olave - Good to go Sunday', description: null })).toBe('cleared')
    expect(newsVsTag(q, { title: 'Olave (foot) off injury report Sunday', description: null })).toBe('cleared')
  })
  it('spots a player the news has ruled out before the tag did', () => {
    expect(newsVsTag(base, { title: 'Lamb ruled out for Week 6', description: null })).toBe('out')
    expect(newsVsTag({ ...base, injury: 'Out' }, { title: 'Lamb ruled out for Week 6', description: null })).toBeNull()
  })
  it('stays quiet on ordinary news', () => {
    expect(newsVsTag(q, { title: 'Olave practices Friday', description: 'Limited participant.' })).toBeNull()
  })
})
