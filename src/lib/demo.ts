import type { League, LeagueUser, Roster } from './types'

export const DEMO_ID = 'demo'

const PPR: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2,
  fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, xpm: 1, xpmiss: -1,
  sack: 1, int: 2, fum_rec: 2, def_td: 6, safe: 2, blk_kick: 2, st_td: 6, ff: 1,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
  pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
}

const NAMES = [
  'You (Demo)', 'Gridiron Gurus', 'Waiver Wire Wizards', 'Fourth & Long', 'Bye Week Blues',
  'Hail Marys', 'Red Zone Rascals', 'Pick Six Pack', 'Sunday Scaries', 'The Taxi Squad',
]

/**
 * A 10-team PPR league snake-drafted by current ADP, so the tool can be tried
 * without a Sleeper account. Built from one weekly projections call.
 */
export async function buildDemo(season: string, week: number) {
  const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `position[]=${p}`).join('&')
  const res = await fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${pos}`)
  if (!res.ok) throw new Error('Could not load demo projections')
  const rows: { player_id: string; stats: Record<string, number>; player?: { position?: string } }[] =
    await res.json()

  const teams = NAMES.length
  const skill = rows
    .filter((r) => (r.stats.adp_dd_ppr ?? 999) < 999 && r.player?.position && !['K', 'DEF'].includes(r.player.position))
    .sort((a, b) => a.stats.adp_dd_ppr - b.stats.adp_dd_ppr)
  const byPts = (p: string) =>
    rows.filter((r) => r.player?.position === p).sort((a, b) => (b.stats.pts_ppr ?? 0) - (a.stats.pts_ppr ?? 0))

  const picks: string[][] = NAMES.map(() => [])
  const counts = NAMES.map(() => ({ QB: 0, TE: 0 }) as Record<string, number>)
  const taken = new Set<string>()
  for (let round = 0; round < 14; round++) {
    for (let k = 0; k < teams; k++) {
      const t = round % 2 === 0 ? k : teams - 1 - k
      const pick = skill.find((r) => {
        const p = r.player!.position!
        return !taken.has(r.player_id) && !((p === 'QB' || p === 'TE') && counts[t][p] >= 2)
      })
      if (!pick) continue
      taken.add(pick.player_id)
      picks[t].push(pick.player_id)
      const p = pick.player!.position!
      counts[t][p] = (counts[t][p] ?? 0) + 1
    }
  }
  const ks = byPts('K')
  const defs = byPts('DEF')
  picks.forEach((ids, t) => {
    if (ks[t]) ids.push(ks[t].player_id)
    if (defs[t]) ids.push(defs[t].player_id)
  })

  const league: League = {
    league_id: DEMO_ID,
    name: 'Demo League (10-team PPR)',
    season,
    avatar: null,
    total_rosters: teams,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    scoring_settings: PPR,
    settings: { playoff_week_start: 15, reserve_slots: 0, taxi_slots: 0 },
  }
  const users: LeagueUser[] = NAMES.map((n, i) => ({
    user_id: `demo-${i}`,
    display_name: n,
    avatar: null,
    metadata: { team_name: n },
  }))
  const rosters: Roster[] = picks.map((ids, i) => ({
    roster_id: i + 1,
    owner_id: `demo-${i}`,
    players: ids,
    starters: [],
    reserve: [],
    taxi: [],
  }))
  return { league, users, rosters, meId: 'demo-0' }
}
