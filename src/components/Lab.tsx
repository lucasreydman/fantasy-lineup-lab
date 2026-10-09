import { useEffect, useMemo, useState } from 'react'
import { buildBlendCtx, type BlendCtx } from '../lib/blend'
import { rosterLimit, starterSlots } from '../lib/lineup'
import { loadBlendFeeds } from '../lib/market'
import { makeScorer, type ProjectionMode } from '../lib/scoring'
import { getProjectionsFor } from '../lib/sleeper'
import { evaluateTeam, type EvalContext } from '../lib/trade'
import type { League, Player, PlayerProjections, Team } from '../lib/types'
import { freeAgentShortlist, rankPickups } from '../lib/waivers'
import { HorizonPicker, Impact, type Horizon } from './Impact'
import { FA, IR, TeamPanel } from './TeamPanel'
import { TradeBar } from './TradeBar'
import { Spinner, TeamAvatar } from './ui'

export interface LabState {
  me: number
  partner: number
  send: string[]
  receive: string[]
  horizon: Horizon
  mode: ProjectionMode
}

interface Props {
  league: League
  teams: Team[]
  players: Map<string, Player>
  currentWeek: number
  initial: LabState
  onStateChange: (s: LabState) => void
}

type PerTeam = Record<number, string[]>

const LAST_WEEK = 18
const owns = (t: Team, id: string) => t.active.includes(id) || t.reserve.includes(id) || t.taxi.includes(id)
const allPlayers = (t: Team) => [...t.active, ...t.reserve, ...t.taxi]
const toggle = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id)
const setIn = (m: PerTeam, team: number, id: string, on: boolean): PerTeam => ({ ...m, [team]: toggle(m[team] ?? [], id, on) })

export function Lab({ league, teams, players, currentWeek, initial, onStateChange }: Props) {
  const [meId, setMeId] = useState(initial.me)
  const [partnerId, setPartnerId] = useState(initial.partner)
  const [send, setSend] = useState(initial.send)
  const [receive, setReceive] = useState(initial.receive)
  const [horizon, setHorizon] = useState(initial.horizon)
  const [mode, setMode] = useState<ProjectionMode>(initial.mode)
  const [viewWeek, setViewWeek] = useState(initial.horizon.start)
  const [drops, setDrops] = useState<PerTeam>({})
  const [keeps, setKeeps] = useState<PerTeam>({})
  const [adds, setAdds] = useState<PerTeam>({})
  const [activations, setActivations] = useState<PerTeam>({})
  const [projections, setProjections] = useState<Map<string, PlayerProjections>>(new Map())
  const [loading, setLoading] = useState(true)
  const [blend, setBlend] = useState<{ ctx: BlendCtx | null; error: string | null }>({ ctx: null, error: null })
  const [freeAgents, setFreeAgents] = useState<string[] | null>(null)

  const me = teams.find((t) => t.rosterId === meId) ?? teams[0]
  const partner = teams.find((t) => t.rosterId === partnerId) ?? teams.find((t) => t.rosterId !== me.rosterId)!

  useEffect(() => {
    onStateChange({ me: me.rosterId, partner: partner.rosterId, send, receive, horizon, mode })
  }, [me.rosterId, partner.rosterId, send, receive, horizon, mode, onStateChange])

  const fetchProjections = (ids: string[]) => {
    const missing = ids.filter((id) => !projections.has(id))
    if (!missing.length) return Promise.resolve()
    return getProjectionsFor(missing, league.season).then((got) => setProjections((prev) => new Map([...prev, ...got])))
  }

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchProjections([...allPlayers(me), ...allPlayers(partner)]).then(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, partner, league.season])

  useEffect(() => {
    if (mode !== 'blend' || blend.ctx) return
    let live = true
    loadBlendFeeds().then(
      ([market, dvp]) => live && setBlend({ ctx: buildBlendCtx(market, dvp, players), error: null }),
      (e: Error) => live && setBlend({ ctx: null, error: e.message }),
    )
    return () => {
      live = false
    }
  }, [mode, blend.ctx, players])

  useEffect(() => {
    if (viewWeek < horizon.start || viewWeek > horizon.end) setViewWeek(horizon.start)
  }, [horizon, viewWeek])

  const scorer = useMemo(
    () => makeScorer(projections, league.scoring_settings, mode === 'blend' && blend.ctx ? { ctx: blend.ctx, players } : null),
    [projections, league.scoring_settings, mode, blend.ctx, players],
  )

  const ctx: EvalContext = useMemo(
    () => ({
      slots: starterSlots(league.roster_positions),
      limit: rosterLimit(league.roster_positions),
      weeks: Array.from({ length: horizon.end - horizon.start + 1 }, (_, i) => horizon.start + i),
      points: scorer.points,
      positionsOf: (id) => players.get(id)?.positions ?? [],
    }),
    [league.roster_positions, horizon, scorer, players],
  )

  const evalFor = (team: Team, incoming: string[], outgoing: string[]) =>
    evaluateTeam(
      team,
      [...incoming, ...(adds[team.rosterId] ?? []), ...(activations[team.rosterId] ?? [])],
      outgoing,
      drops[team.rosterId] ?? [],
      ctx,
      keeps[team.rosterId] ?? [],
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const meEval = useMemo(() => evalFor(me, receive, send), [me, receive, send, drops, keeps, adds, activations, ctx])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const partnerEval = useMemo(() => evalFor(partner, send, receive), [partner, receive, send, drops, keeps, adds, activations, ctx])

  const meOpen = meEval.limit - meEval.rosterAfter.length
  const partnerOpen = partnerEval.limit - partnerEval.rosterAfter.length
  const needWaivers = meOpen > 0 || partnerOpen > 0

  // The waiver wire is only scanned once a roster actually has room.
  useEffect(() => {
    if (!needWaivers || freeAgents) return
    let live = true
    const rostered = new Set(teams.flatMap(allPlayers))
    freeAgentShortlist(league.season, horizon.start, rostered, players, ctx.slots, league.scoring_settings)
      .then(async (ids) => {
        await fetchProjections(ids)
        if (live) setFreeAgents(ids)
      })
      .catch(() => live && setFreeAgents([]))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needWaivers, freeAgents, teams, league.season, players])

  const posOf = (id: string) => players.get(id)?.pos ?? '?'
  const claimed = new Set(Object.values(adds).flat())
  const pool = freeAgents?.filter((id) => !claimed.has(id)) ?? null
  const meSuggest = useMemo(
    () => (meOpen > 0 ? (pool ? rankPickups(meEval.rosterAfter, pool, ctx, posOf) : null) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meOpen, pool?.join(), meEval, ctx],
  )
  const partnerSuggest = useMemo(
    () => (partnerOpen > 0 ? (pool ? rankPickups(partnerEval.rosterAfter, pool, ctx, posOf) : null) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [partnerOpen, pool?.join(), partnerEval, ctx],
  )

  const horizonPoints = (id: string) => ctx.weeks.reduce((s, w) => s + scorer.points(id, w), 0)

  const resetTrade = () => {
    setSend([])
    setReceive([])
    setDrops({})
    setKeeps({})
    setAdds({})
    setActivations({})
  }

  /** Something was dropped on `side`'s panel: a rostered player, a waiver pickup, or an IR player. */
  const placeOn = (side: 'me' | 'partner', data: string) => {
    const target = side === 'me' ? me : partner
    const other = side === 'me' ? partner : me
    if (data.startsWith(FA)) {
      const id = data.slice(FA.length)
      setAdds((a) => setIn(setIn(a, other.rosterId, id, false), target.rosterId, id, true))
      return
    }
    const id = data.startsWith(IR) ? data.slice(IR.length) : data
    if (data.startsWith(IR) && owns(target, id)) {
      setActivations((a) => setIn(a, target.rosterId, id, true))
      return
    }
    if (owns(me, id)) setSend((s) => toggle(s, id, side === 'partner'))
    else if (owns(partner, id)) setReceive((r) => toggle(r, id, side === 'me'))
  }
  const moveAcross = (id: string) => {
    if (owns(me, id)) setSend((s) => toggle(s, id, !s.includes(id)))
    else if (owns(partner, id)) setReceive((r) => toggle(r, id, !r.includes(id)))
  }
  const toggleDrop = (rosterId: number, id: string) => {
    setDrops((d) => setIn(d, rosterId, id, !(d[rosterId] ?? []).includes(id)))
    setKeeps((k) => setIn(k, rosterId, id, false))
  }
  const keep = (rosterId: number, id: string) => {
    if ((drops[rosterId] ?? []).includes(id)) toggleDrop(rosterId, id)
    else setKeeps((k) => setIn(k, rosterId, id, true))
  }

  const hasTrade = send.length + receive.length > 0
  const weekIdx = ctx.weeks.indexOf(viewWeek)

  const panelFor = (team: Team, side: 'me' | 'partner') => ({
    week: viewWeek,
    players,
    projections,
    points: scorer.points,
    detail: scorer.detail,
    horizonPoints,
    showHorizon: ctx.weeks.length > 1,
    manualDrops: drops[team.rosterId] ?? [],
    adds: adds[team.rosterId] ?? [],
    activations: activations[team.rosterId] ?? [],
    onReceive: (data: string) => placeOn(side, data),
    onMoveAcross: moveAcross,
    onToggleDrop: (id: string) => toggleDrop(team.rosterId, id),
    onKeep: (id: string) => keep(team.rosterId, id),
    onAdd: (id: string) => placeOn(side, FA + id),
    onRemoveAdd: (id: string) => setAdds((a) => setIn(a, team.rosterId, id, false)),
    onActivate: (id: string) => setActivations((a) => setIn(a, team.rosterId, id, true)),
    onDeactivate: (id: string) => setActivations((a) => setIn(a, team.rosterId, id, false)),
  })

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <TeamSelect
          label="Your team"
          teams={teams}
          value={me.rosterId}
          exclude={partner.rosterId}
          onChange={(id) => {
            setMeId(id)
            resetTrade()
          }}
        />
        <div className="hidden text-center text-[12px] font-semibold tracking-widest text-faint md:block">VS</div>
        <TeamSelect
          label="Trade partner"
          teams={teams}
          value={partner.rosterId}
          exclude={me.rosterId}
          onChange={(id) => {
            setPartnerId(id)
            resetTrade()
          }}
        />
      </div>

      <TradeBar
        myName={me.name}
        partnerName={partner.name}
        myPool={allPlayers(me)}
        partnerPool={allPlayers(partner)}
        send={send}
        receive={receive}
        players={players}
        onSend={(id, add) => setSend((s) => toggle(s, id, add))}
        onReceive={(id, add) => setReceive((r) => toggle(r, id, add))}
        onClear={resetTrade}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <HorizonPicker
          current={currentWeek}
          lastWeek={LAST_WEEK}
          regSeasonEnd={(league.settings.playoff_week_start ?? 15) - 1}
          value={horizon}
          onChange={setHorizon}
        />
        <ProjectionToggle mode={mode} onChange={setMode} />
      </div>
      {mode === 'blend' && <BlendStatus ctx={blend.ctx} error={blend.error} weeks={ctx.weeks} />}

      {loading && projections.size === 0 ? (
        <div className="flex justify-center rounded-2xl bg-panel py-16 ring-1 ring-line">
          <Spinner label="Loading projections…" />
        </div>
      ) : (
        <>
          <Impact
            me={{ name: me.name, avatarUrl: me.avatarUrl, ev: meEval }}
            partner={{ name: partner.name, avatarUrl: partner.avatarUrl, ev: partnerEval }}
            week={viewWeek}
            onWeek={setViewWeek}
            hasTrade={hasTrade}
          />

          <div className="flex items-center justify-between pt-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">
              Lineups after trade · Week {viewWeek}
              {loading && <span className="ml-3 normal-case tracking-normal text-faint">updating…</span>}
            </h2>
            {ctx.weeks.length > 1 && (
              <div className="flex items-center gap-1">
                <WeekArrow dir={-1} disabled={weekIdx <= 0} onClick={() => setViewWeek(ctx.weeks[weekIdx - 1])} />
                <WeekArrow dir={1} disabled={weekIdx >= ctx.weeks.length - 1} onClick={() => setViewWeek(ctx.weeks[weekIdx + 1])} />
              </div>
            )}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <TeamPanel {...panelFor(me, 'me')} label="You" team={me} ev={meEval} suggestions={meSuggest} />
            <TeamPanel {...panelFor(partner, 'partner')} label="Trade partner" team={partner} ev={partnerEval} suggestions={partnerSuggest} />
          </div>
        </>
      )}
    </div>
  )
}

function ProjectionToggle({ mode, onChange }: { mode: ProjectionMode; onChange: (m: ProjectionMode) => void }) {
  const opts: { m: ProjectionMode; label: string; hint: string }[] = [
    { m: 'sleeper', label: 'Sleeper', hint: "Sleeper's own projections" },
    { m: 'blend', label: 'Blend', hint: 'Vegas props + game lines + ESPN + matchup + health' },
  ]
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Projections</span>
      <div className="flex rounded-full bg-panel-2 p-1 ring-1 ring-line">
        {opts.map((o) => (
          <button
            key={o.m}
            type="button"
            title={o.hint}
            onClick={() => onChange(o.m)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
              mode === o.m ? (o.m === 'blend' ? 'bg-wr text-bg' : 'bg-teal text-bg') : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function BlendStatus({ ctx, error, weeks }: { ctx: BlendCtx | null; error: string | null; weeks: number[] }) {
  if (error)
    return (
      <div className="rounded-xl bg-down/10 px-4 py-2.5 text-[12px] text-down ring-1 ring-down/30">
        Couldn't load market data ({error}). Showing Sleeper projections.
      </div>
    )
  if (!ctx)
    return (
      <div className="rounded-xl bg-panel px-4 py-2.5 ring-1 ring-line">
        <Spinner label="Pulling sportsbook props, game lines and ESPN projections…" />
      </div>
    )
  const later = weeks.some((w) => w !== ctx.week)
  return (
    <div className="rounded-xl bg-wr/8 px-4 py-2.5 text-[12px] leading-relaxed text-muted ring-1 ring-wr/25">
      <span className="font-semibold text-wr">Blend · Week {ctx.week}:</span> {ctx.stats.propsMatched} player props
      (Pinnacle + Underdog) · {ctx.stats.games} game lines · {ctx.stats.espnMatched} ESPN projections · defense vs.
      position{ctx.dvp ? ` through Week ${ctx.dvp.throughWeek}` : ' unavailable'} · practice-report health.
      {later && <> Books only price this week, so later weeks are Sleeper's projection adjusted for matchup.</>} Hover a
      player's points for the breakdown.
    </div>
  )
}

function TeamSelect({
  label, teams, value, exclude, onChange,
}: { label: string; teams: Team[]; value: number; exclude: number; onChange: (id: number) => void }) {
  const t = teams.find((x) => x.rosterId === value)!
  return (
    <label className="relative flex cursor-pointer items-center gap-3 rounded-2xl bg-panel px-4 py-3 ring-1 ring-line transition hover:ring-faint">
      <TeamAvatar url={t.avatarUrl} name={t.name} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
        <div className="truncate text-[15px] font-semibold">{t.name}</div>
        {t.ownerName !== t.name && <div className="truncate text-[11.5px] text-faint">@{t.ownerName}</div>}
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" className="text-muted" fill="currentColor">
        <path d="M2 4l4 4 4-4z" />
      </svg>
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      >
        {teams
          .filter((x) => x.rosterId !== exclude)
          .map((x) => (
            <option key={x.rosterId} value={x.rosterId}>
              {x.name} (@{x.ownerName})
            </option>
          ))}
      </select>
    </label>
  )
}

function WeekArrow({ dir, disabled, onClick }: { dir: 1 | -1; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={dir < 0 ? 'Previous week' : 'Next week'}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-muted ring-1 ring-line transition hover:text-ink disabled:opacity-30"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d={dir < 0 ? 'M7.5 2.5L4 6l3.5 3.5' : 'M4.5 2.5L8 6l-3.5 3.5'} />
      </svg>
    </button>
  )
}
