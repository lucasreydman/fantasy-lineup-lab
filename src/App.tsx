import { useCallback, useEffect, useState } from 'react'
import { Lab, type LabState } from './components/Lab'
import { Setup } from './components/Setup'
import { Spinner, TeamAvatar } from './components/ui'
import { buildDemo, DEMO_ID } from './lib/demo'
import { buildTeams, getLeague, getLeagueUsers, getPlayers, getRosters, getState, leagueAvatar, scoringLabel } from './lib/sleeper'
import type { ProjectionMode } from './lib/scoring'
import type { League, NflState, Player, Team } from './lib/types'

interface Loaded {
  league: League
  teams: Team[]
  players: Map<string, Player>
  currentWeek: number
  initial: LabState
}

function readParams() {
  const q = new URLSearchParams(location.search)
  const list = (k: string) => (q.get(k) ?? '').split(',').filter(Boolean)
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined)
  return {
    league: q.get('league'),
    me: num('me'),
    vs: num('vs'),
    send: list('send'),
    recv: list('recv'),
    from: num('from'),
    to: num('to'),
    mode: (q.get('proj') === 'blend' ? 'blend' : q.get('proj') === 'sleeper' ? 'sleeper' : null) as ProjectionMode | null,
  }
}

function weekFor(state: NflState, season: string) {
  if (season !== state.season) return 1
  if (state.season_type === 'pre') return 1
  if (state.season_type === 'post') return 18
  return Math.min(18, Math.max(1, state.week || 1))
}

export default function App() {
  const [state, setState] = useState<NflState | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leagueParam, setLeagueParam] = useState(() => readParams().league)

  useEffect(() => {
    getState().then(setState, (e) => setError(e.message))
  }, [])

  const open = useCallback(
    async (leagueId: string, userId: string | null) => {
      if (!state) return
      setLoading('Loading league…')
      setError(null)
      try {
        const params = readParams()
        const knownUser = userId ?? safeGet('sleeper:userId')
        const [{ league, users, rosters, meId }, players] = await Promise.all([
          leagueId === DEMO_ID
            ? buildDemo(state.season, weekFor(state, state.season))
            : Promise.all([getLeague(leagueId), getRosters(leagueId), getLeagueUsers(leagueId)]).then(
                ([league, rosters, users]) => ({ league, rosters, users, meId: knownUser }),
              ),
          getPlayers(),
        ])
        const teams = buildTeams(rosters, users)
        if (teams.length < 2) throw new Error('This league needs at least two rosters.')
        const sameLeague = params.league === leagueId
        const me =
          (sameLeague && teams.find((t) => t.rosterId === params.me)) ||
          teams.find((t) => meId && t.ownerIds.includes(meId)) ||
          teams[0]
        const partner =
          (sameLeague && teams.find((t) => t.rosterId === params.vs && t.rosterId !== me.rosterId)) ||
          teams.find((t) => t.rosterId !== me.rosterId)!
        const currentWeek = weekFor(state, league.season)
        const from = sameLeague && params.from ? params.from : currentWeek
        const to = sameLeague && params.to ? Math.max(from, params.to) : from
        setLoaded({
          league,
          teams,
          players,
          currentWeek,
          initial: {
            me: me.rosterId,
            partner: partner.rosterId,
            send: sameLeague ? params.send : [],
            receive: sameLeague ? params.recv : [],
            horizon: { start: from, end: to },
            mode: params.mode ?? (safeGet('projMode') === 'blend' ? 'blend' : 'sleeper'),
          },
        })
        setLeagueParam(leagueId)
      } catch (e) {
        setError((e as Error).message)
        setLeagueParam(null)
        history.replaceState(null, '', location.pathname)
      } finally {
        setLoading(null)
      }
    },
    [state],
  )

  useEffect(() => {
    const id = readParams().league
    if (state && id && !loaded) open(id, null)
  }, [state, open, loaded])

  const syncUrl = useCallback(
    (s: LabState) => {
      if (!loaded) return
      const q = new URLSearchParams({ league: loaded.league.league_id, me: String(s.me), vs: String(s.partner) })
      if (s.send.length) q.set('send', s.send.join(','))
      if (s.receive.length) q.set('recv', s.receive.join(','))
      q.set('from', String(s.horizon.start))
      q.set('to', String(s.horizon.end))
      q.set('proj', s.mode)
      try {
        localStorage.setItem('projMode', s.mode)
      } catch {
        /* non-essential */
      }
      history.replaceState(null, '', `${location.pathname}?${q}`)
    },
    [loaded],
  )

  const leave = () => {
    setLoaded(null)
    setLeagueParam(null)
    history.replaceState(null, '', location.pathname)
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <button type="button" onClick={leave} className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">Trade Lineup Lab</span>
          </button>
          {loaded && (
            <div className="ml-auto flex min-w-0 items-center gap-2.5">
              <TeamAvatar url={leagueAvatar(loaded.league.avatar)} name={loaded.league.name} size={28} />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[13px] font-semibold">{loaded.league.name}</div>
                <div className="truncate text-[11px] text-muted">
                  {loaded.teams.length} teams · {scoringLabel(loaded.league.scoring_settings)} · Week {loaded.currentWeek}
                </div>
              </div>
              <button
                type="button"
                onClick={leave}
                className="ml-1 shrink-0 rounded-full bg-panel-3 px-3 py-1.5 text-[12px] font-medium text-muted hover:text-ink"
              >
                Switch
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 pb-16">
        {error && (
          <div className="mb-4 rounded-xl bg-down/10 px-4 py-3 text-[13px] text-down ring-1 ring-down/30">{error}</div>
        )}
        {loading || !state || (leagueParam && !loaded && !error) ? (
          <div className="flex justify-center pt-24">
            <Spinner label={loading ?? 'Connecting to Sleeper…'} />
          </div>
        ) : loaded ? (
          <Lab key={loaded.league.league_id} {...loaded} onStateChange={syncUrl} />
        ) : (
          <Setup season={state.season} onPick={open} />
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-[11px] leading-relaxed text-faint">
        Projections from Sleeper, or the Blend (sportsbook props, game lines, ESPN, matchup, health), scored with your league's exact scoring settings. Lineups are the optimal
        projected lineup for each week; full-week projections include games already played. Not affiliated with Sleeper.
      </footer>
    </div>
  )
}

function safeGet(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--color-teal)" />
      <path d="M9 12h11l-3-3M23 20H12l3 3" fill="none" stroke="var(--color-bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
