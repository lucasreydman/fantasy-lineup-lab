// Wire format of /api/market and /api/dvp, shared by the Vercel functions (api/) and
// the client (src/). Every upstream is free and keyless: Pinnacle's guest API,
// Underdog's pick'em feed, ESPN's scoreboard + fantasy projections, Sleeper actuals.

export type PropMarket =
  | 'pass_yds'
  | 'pass_tds'
  | 'pass_int'
  | 'pass_att'
  | 'pass_cmp'
  | 'rush_yds'
  | 'rush_att'
  | 'rec'
  | 'rec_yds'
  | 'rec_tgt'
  | 'atd' // anytime touchdown (rush + rec), priced as a probability
  | 'kick_pts'

export interface GameLine {
  home: string // Sleeper team abbr
  away: string
  kickoff: number
  /** Home-relative: negative = home favored. */
  spread: number | null
  total: number | null
  /** Book's own team totals when offered (Pinnacle); better than deriving from spread/total. */
  homeTT: number | null
  awayTT: number | null
  source: 'pinnacle' | 'espn'
}

export interface PropLine {
  name: string
  home: string
  away: string
  market: PropMarket
  /** Consensus (median) line; null for the anytime-TD market. */
  line: number | null
  /** De-vigged probability of the Over (or of "scores a TD" for atd). */
  overProb: number | null
  books: number
  sources: string[]
}

/** ESPN's weekly projection translated to Sleeper stat keys. */
export interface ExtProj {
  espnId: number
  name: string
  team: string | null
  pos: string | null
  stats: Record<string, number>
}

export interface SourceState {
  ok: boolean
  count: number
  error?: string
}

export interface MarketSnapshot {
  updatedAt: number
  season: string
  /** The one week the books are pricing; the Blend only exists for this week. */
  week: number
  games: GameLine[]
  props: PropLine[]
  espn: ExtProj[]
  sources: Record<'pinnacle' | 'underdog' | 'espnLines' | 'espnProj', SourceState>
}

/** Raw stat totals a defense allowed to a position, and in how many games. */
export interface DvpCell {
  games: number
  stats: Record<string, number>
}
/** defense abbr -> position -> cell */
export type DvpAgg = Record<string, Record<string, DvpCell>>

export interface DvpSnapshot {
  updatedAt: number
  season: string
  /** Last completed regular-season week included (0 before Week 1 is over). */
  throughWeek: number
  current: DvpAgg
  prior: { season: string; agg: DvpAgg } | null
}

export const DVP_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'] as const
