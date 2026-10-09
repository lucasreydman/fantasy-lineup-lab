import type {
  League,
  LeagueUser,
  NflState,
  Player,
  PlayerProjections,
  Roster,
  Team,
} from './types'

const API = 'https://api.sleeper.app/v1'
const PROJ_API = 'https://api.sleeper.com/projections/nfl'
const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'])

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sleeper request failed (${res.status})`)
  return res.json() as Promise<T>
}

function cacheRead<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { t, v } = JSON.parse(raw)
    return Date.now() - t < maxAgeMs ? (v as T) : null
  } catch {
    return null
  }
}

function cacheWrite(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }))
  } catch {
    // Quota or privacy mode: just refetch next time.
  }
}

export const getState = () => get<NflState>(`${API}/state/nfl`)

export async function getUser(username: string) {
  const u = await get<{ user_id: string; display_name: string; avatar: string | null } | null>(
    `${API}/user/${encodeURIComponent(username.trim())}`,
  )
  if (!u) throw new Error(`No Sleeper user named "${username}"`)
  return u
}

export const getLeagues = (userId: string, season: string) =>
  get<League[]>(`${API}/user/${userId}/leagues/nfl/${season}`)

export async function getLeague(id: string) {
  const l = await get<League | null>(`${API}/league/${id}`)
  if (!l) throw new Error(`League ${id} not found`)
  return l
}

export const getRosters = (id: string) => get<Roster[]>(`${API}/league/${id}/rosters`)
export const getLeagueUsers = (id: string) => get<LeagueUser[]>(`${API}/league/${id}/users`)

type PlayerRow = [
  id: string, first: string, last: string, pos: string, positions: string,
  team: string | null, injury: string | null, status: string | null, practice: string | null,
  espnId: number | null, rank: number | null,
]

/** The full player DB is ~15MB; keep a trimmed copy for a day, as Sleeper asks. */
export async function getPlayers(): Promise<Map<string, Player>> {
  const key = 'sleeper:players:v2'
  let rows = cacheRead<PlayerRow[]>(key, 24 * 3600 * 1000)
  if (!rows) {
    const all = await get<Record<string, Record<string, unknown>>>(`${API}/players/nfl`)
    rows = []
    for (const [id, p] of Object.entries(all)) {
      const positions = ((p.fantasy_positions as string[] | null) ?? [p.position as string]).filter(
        (x) => FANTASY_POS.has(x),
      )
      if (!positions.length) continue
      rows.push([
        id,
        (p.first_name as string) ?? '',
        (p.last_name as string) ?? '',
        (p.position as string) ?? positions[0],
        positions.join(','),
        (p.team as string | null) ?? null,
        (p.injury_status as string | null) ?? null,
        (p.status as string | null) ?? null,
        (p.practice_participation as string | null) ?? null,
        (p.espn_id as number | null) ?? null,
        (p.search_rank as number | null) ?? null,
      ])
    }
    cacheWrite(key, rows)
  }
  return new Map(
    rows.map(([id, first, last, pos, positions, team, injury, status, practice, espnId, rank]) => [
      id,
      { id, first, last, pos, positions: positions.split(','), team, injury, status, practice, espnId: espnId ? Number(espnId) : null, rank },
    ]),
  )
}

const projCache = new Map<string, Promise<PlayerProjections>>()

type RawProjections = Record<string, { stats: Record<string, number>; opponent: string | null; is_away_team?: boolean } | null>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function getPlayerProjections(id: string, season: string): Promise<PlayerProjections> {
  const key = `${season}:${id}`
  let p = projCache.get(key)
  if (!p) {
    const url = `${PROJ_API}/player/${id}?season=${season}&season_type=regular&grouping=week`
    p = (async () => {
      // Sleeper rate-limits bursts (a roster pair plus the waiver scan is ~80 calls), so
      // retry with backoff. A failure must never be cached as "no projections": that
      // would score a healthy player 0 for the whole session.
      for (let attempt = 0; ; attempt++) {
        try {
          const raw = await get<RawProjections>(url)
          const out: PlayerProjections = {}
          for (const [wk, v] of Object.entries(raw ?? {})) {
            out[Number(wk)] = v ? { stats: v.stats ?? {}, opponent: v.opponent ?? null, away: !!v.is_away_team } : null
          }
          return out
        } catch (e) {
          if (attempt >= 3) {
            projCache.delete(key)
            throw e
          }
          await sleep(400 * 2 ** attempt + Math.random() * 200)
        }
      }
    })()
    projCache.set(key, p)
  }
  return p
}

/** Fetch projections for many players with bounded concurrency. */
export async function getProjectionsFor(
  ids: string[],
  season: string,
): Promise<Map<string, PlayerProjections>> {
  const out = new Map<string, PlayerProjections>()
  const queue = [...new Set(ids)]
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        out.set(id, await getPlayerProjections(id, season))
      } catch {
        // Left out of the result on purpose, so the next load asks for it again.
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return out
}

export function buildTeams(rosters: Roster[], users: LeagueUser[]): Team[] {
  const byId = new Map(users.map((u) => [u.user_id, u]))
  return rosters
    .map((r) => {
      const u = r.owner_id ? byId.get(r.owner_id) : undefined
      const reserve = r.reserve ?? []
      const taxi = r.taxi ?? []
      const sidelined = new Set([...reserve, ...taxi])
      return {
        rosterId: r.roster_id,
        name: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
        ownerName: u?.display_name ?? 'Orphan',
        avatarUrl:
          u?.metadata?.avatar ?? (u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null),
        ownerIds: [r.owner_id, ...(r.co_owners ?? [])].filter(Boolean) as string[],
        active: (r.players ?? []).filter((id) => !sidelined.has(id)),
        reserve,
        taxi,
      }
    })
    .sort((a, b) => a.rosterId - b.rosterId)
}

export const playerThumb = (id: string, pos?: string) =>
  pos === 'DEF' || /^[A-Z]{2,3}$/.test(id)
    ? `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`

export const leagueAvatar = (avatar: string | null) =>
  avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null

export function scoringLabel(scoring: Record<string, number>): string {
  const rec = scoring.rec ?? 0
  const base = rec >= 1 ? 'PPR' : rec >= 0.5 ? 'Half PPR' : rec > 0 ? `${rec} PPR` : 'Standard'
  const tep = scoring.bonus_rec_te ? ` · TEP ${scoring.bonus_rec_te}` : ''
  return base + tep
}
