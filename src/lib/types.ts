export interface Player {
  id: string
  first: string
  last: string
  pos: string
  /** Positions this player is eligible at (Sleeper `fantasy_positions`). */
  positions: string[]
  team: string | null
  injury: string | null
  /** Sleeper roster status: Active, Injured Reserve, PUP, ... */
  status: string | null
  /** Practice participation this week, e.g. "Limited" */
  practice: string | null
  espnId: number | null
  /** Sleeper search rank: lower = more relevant; used to break name ties */
  rank: number | null
}

export interface League {
  league_id: string
  name: string
  season: string
  avatar: string | null
  total_rosters: number
  roster_positions: string[]
  scoring_settings: Record<string, number>
  settings: {
    playoff_week_start?: number
    start_week?: number
    reserve_slots?: number
    taxi_slots?: number
    [k: string]: unknown
  }
}

export interface Roster {
  roster_id: number
  owner_id: string | null
  co_owners?: string[] | null
  players: string[] | null
  starters: string[] | null
  reserve: string[] | null
  taxi: string[] | null
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number }
}

export interface LeagueUser {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string; avatar?: string } | null
}

export interface NflState {
  week: number
  display_week: number
  season: string
  season_type: string
}

/** One week of raw projected stats for a player; null = bye / no projection. */
export interface WeekProjection {
  stats: Record<string, number>
  opponent: string | null
  away: boolean
}

/** Raw projections per week, index = week number (1..18). */
export type PlayerProjections = Record<number, WeekProjection | null>

export interface Team {
  rosterId: number
  name: string
  ownerName: string
  avatarUrl: string | null
  ownerIds: string[]
  /** Players counting against the active roster limit. */
  active: string[]
  reserve: string[]
  taxi: string[]
}
