import { useEffect, useState, type FormEvent } from 'react'
import { LogoMark } from './LogoMark'
import { getLeagues, getUser, leagueAvatar, scoringLabel } from '../lib/sleeper'
import type { League } from '../lib/types'
import { Spinner, TeamAvatar } from './ui'

interface Props {
  season: string
  onPick: (leagueId: string, userId: string | null) => void
  /** Shown when not already running as the installed app */
  onInstall?: () => void
}

const USER_KEY = 'sleeper:username'

export function Setup({ season, onPick, onInstall }: Props) {
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem(USER_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [leagues, setLeagues] = useState<League[] | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState('')

  const lookup = async (name: string) => {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const u = await getUser(name)
      const ls = await getLeagues(u.user_id, season)
      setUserId(u.user_id)
      setLeagues(ls)
      try {
        localStorage.setItem(USER_KEY, name.trim())
        localStorage.setItem('sleeper:userId', u.user_id)
      } catch {
        /* non-essential */
      }
    } catch (e) {
      setError((e as Error).message)
      setLeagues(null)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (username) lookup(username)
    // Only auto-run for the remembered username on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    lookup(username)
  }

  return (
    <div className="mx-auto max-w-xl pt-6 sm:pt-14">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        See the trade <span className="text-teal">in your lineup.</span>
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Build a trade with anyone in your Sleeper league and watch both starting lineups re-optimize: who gets elevated
        off the bench, who has to be dropped, and how projected points change this week or over any stretch of weeks.
      </p>

      <form onSubmit={submit} className="mt-8 flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Sleeper username"
          autoComplete="username"
          className="min-w-0 flex-1 rounded-xl bg-panel px-4 py-3 text-[15px] outline-none ring-1 ring-line placeholder:text-faint focus:ring-teal"
        />
        <button
          type="submit"
          disabled={busy || !username.trim()}
          className="rounded-xl bg-teal px-5 py-3 text-[15px] font-semibold text-bg transition hover:brightness-110 disabled:opacity-40"
        >
          Find leagues
        </button>
      </form>

      {error && <p className="mt-3 text-[13px] text-down">{error}</p>}
      {busy && (
        <div className="mt-6">
          <Spinner label="Looking up leagues…" />
        </div>
      )}

      {leagues && !busy && (
        <div className="mt-6 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{season} leagues</div>
          {leagues.length === 0 && (
            <p className="rounded-xl bg-panel px-4 py-4 text-[13px] text-muted ring-1 ring-line">
              No NFL leagues for {season} on this account.
            </p>
          )}
          {leagues.map((l) => (
            <button
              key={l.league_id}
              type="button"
              onClick={() => onPick(l.league_id, userId)}
              className="pop-in flex w-full items-center gap-3 rounded-xl bg-panel px-4 py-3 text-left ring-1 ring-line transition hover:bg-panel-2 hover:ring-teal"
            >
              <TeamAvatar url={leagueAvatar(l.avatar)} name={l.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{l.name}</div>
                <div className="text-[12px] text-muted">
                  {l.total_rosters} teams · {scoringLabel(l.scoring_settings)}
                  {l.roster_positions.includes('SUPER_FLEX') && ' · Superflex'}
                </div>
              </div>
              <span className="text-muted">›</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (leagueId.trim()) onPick(leagueId.trim(), userId)
          }}
          className="flex gap-2 rounded-xl bg-panel p-2 ring-1 ring-line"
        >
          <input
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            placeholder="or paste a league ID"
            inputMode="numeric"
            className="min-w-0 flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-faint"
          />
          <button type="submit" className="rounded-lg bg-panel-3 px-3 py-2 text-[13px] font-semibold hover:bg-line">
            Open
          </button>
        </form>
        <button
          type="button"
          onClick={() => onPick('demo', null)}
          className="rounded-xl bg-panel px-4 py-3 text-[13px] font-semibold text-teal ring-1 ring-line transition hover:bg-panel-2"
        >
          Try a demo league →
        </button>
      </div>

      {onInstall && (
        <button
          type="button"
          onClick={onInstall}
          className="mt-3 flex w-full items-center gap-3 rounded-xl bg-panel px-4 py-3 text-left ring-1 ring-line transition hover:bg-panel-2 active:scale-[0.99]"
        >
          <LogoMark size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Add Lineup Lab to your home screen</div>
            <div className="text-[12px] text-muted">Free, no app store. Opens full-screen like an app.</div>
          </div>
          <span className="text-muted">›</span>
        </button>
      )}
    </div>
  )
}
