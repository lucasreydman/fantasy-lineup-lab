import { useEffect, useMemo, useState } from 'react'
import { buildBlendCtx, type BlendCtx } from '../lib/blend'
import { irEligible, rosterLimit, starterSlots } from '../lib/lineup'
import { loadBlendFeeds } from '../lib/market'
import { makeScorer, type ProjectionMode } from '../lib/scoring'
import { LAST_NFL_WEEK, playoffWeeks } from '../lib/season'
import { getProjectionsFor } from '../lib/sleeper'
import { emptyPlan, evaluateTeam, type EvalContext, type TeamEnv, type TeamPlan } from '../lib/trade'
import type { League, Player, PlayerProjections, Team } from '../lib/types'
import { freeAgentShortlist } from '../lib/waivers'
import { HorizonPicker, Impact, type Horizon } from './Impact'
import { LabProjectionsIntro, shouldShowIntro } from './LabProjectionsIntro'
import { DropDock } from './DropDock'
import { FA, IR, TeamPanel, type MoveKey } from './TeamPanel'
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

type Moves = Omit<TeamPlan, 'incoming' | 'outgoing'>

const owns = (t: Team, id: string) => t.active.includes(id) || t.reserve.includes(id) || t.taxi.includes(id)
const allPlayers = (t: Team) => [...t.active, ...t.reserve, ...t.taxi]
const toggle = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id)
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)

export function Lab({ league, teams, players, currentWeek, initial, onStateChange }: Props) {
  const [meId, setMeId] = useState(initial.me)
  const [partnerId, setPartnerId] = useState(initial.partner)
  const [send, setSend] = useState(initial.send)
  const [receive, setReceive] = useState(initial.receive)
  const [horizon, setHorizon] = useState(initial.horizon)
  const [mode, setMode] = useState<ProjectionMode>(initial.mode)
  const [viewWeek, setViewWeek] = useState(initial.horizon.start)
  const [moves, setMoves] = useState<Record<number, Moves>>({})
  const [projections, setProjections] = useState<Map<string, PlayerProjections>>(new Map())
  const [loading, setLoading] = useState(true)
  const [blend, setBlend] = useState<{ ctx: BlendCtx | null; error: string | null }>({ ctx: null, error: null })
  const [freeAgents, setFreeAgents] = useState<string[] | null>(null)
  // A shared link can open straight into Lineup Lab projections; explain them then too.
  const [blendAttempt, setBlendAttempt] = useState(0)
  const [intro, setIntro] = useState(() => initial.mode === 'lab' && shouldShowIntro())

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

  // Market feeds: one quiet retry on failure, then a visible error with a Retry button.
  useEffect(() => {
    if (mode !== 'lab' || blend.ctx || blend.error) return
    let live = true
    let timer = 0
    loadBlendFeeds()
      .then(([market, dvp]) => buildBlendCtx(market, dvp, players))
      .then(
        (ctx) => live && setBlend({ ctx, error: null }),
        (e: Error) => {
          if (!live) return
          if (blendAttempt === 0) timer = window.setTimeout(() => setBlendAttempt(1), 3000)
          else setBlend({ ctx: null, error: e.message || 'unknown error' })
        },
      )
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [mode, blend.ctx, blend.error, blendAttempt, players])

  const retryBlend = () => {
    setBlend({ ctx: null, error: null })
    setBlendAttempt((a) => a + 1)
  }

  useEffect(() => {
    if (viewWeek < horizon.start || viewWeek > horizon.end) setViewWeek(horizon.start)
  }, [horizon, viewWeek])

  const switchMode = (m: ProjectionMode) => {
    setMode(m)
    if (m === 'lab' && shouldShowIntro()) setIntro(true)
  }

  const scorer = useMemo(
    () => makeScorer(projections, league.scoring_settings, mode === 'lab' && blend.ctx ? { ctx: blend.ctx, players } : null),
    [projections, league.scoring_settings, mode, blend.ctx, players],
  )

  const view: EvalContext = useMemo(
    () => ({
      slots: starterSlots(league.roster_positions),
      limit: rosterLimit(league.roster_positions),
      weeks: range(horizon.start, horizon.end),
      points: scorer.points,
      positionsOf: (id) => players.get(id)?.positions ?? [],
    }),
    [league.roster_positions, horizon, scorer, players],
  )
  // Rest of season = through the league's last playoff week (from its settings).
  const playoffs = useMemo(() => playoffWeeks(league.settings), [league.settings])
  // Automatic drops, IR moves and pickups are judged on the rest of the season,
  // whatever window is on screen.
  const decide: EvalContext = useMemo(
    () => ({ ...view, weeks: range(currentWeek, Math.max(currentWeek, playoffs.end)) }),
    [view, currentWeek, playoffs.end],
  )

  const irSlots = Number(league.settings.reserve_slots ?? 0)
  const isIrEligible = useMemo(
    () => (id: string) => irEligible(players.get(id)?.injury, league.settings),
    [players, league.settings],
  )
  const movesOf = (rosterId: number): Moves => ({ ...emptyPlan(), ...moves[rosterId] })
  const posOf = (id: string) => players.get(id)?.pos ?? '?'

  const env = (pool: string[] | null): TeamEnv => ({ view, decide, irSlots, irEligible: isIrEligible, pool, posOf })

  // You first, then your partner from whatever free agents you didn't take.
  const meEval = useMemo(
    () =>
      evaluateTeam(
        me,
        { ...movesOf(me.rosterId), incoming: receive, outgoing: send },
        env(freeAgents?.filter((id) => !movesOf(partner.rosterId).adds.includes(id)) ?? null),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me, partner.rosterId, receive, send, moves, view, decide, freeAgents, isIrEligible],
  )
  const partnerEval = useMemo(() => {
    const taken = new Set([...meEval.adds, ...meEval.autoAdds])
    return evaluateTeam(
      partner,
      { ...movesOf(partner.rosterId), incoming: send, outgoing: receive },
      env(freeAgents?.filter((id) => !taken.has(id)) ?? null),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner, receive, send, moves, view, decide, freeAgents, meEval, isIrEligible])

  // The waiver wire is only scanned once a roster actually has room.
  const needWire = meEval.scanning || partnerEval.scanning
  useEffect(() => {
    if (!needWire || freeAgents) return
    let live = true
    const rostered = new Set(teams.flatMap(allPlayers))
    freeAgentShortlist(league.season, currentWeek, rostered, players, view.slots, league.scoring_settings, 8)
      .then(async (ids) => {
        await fetchProjections(ids)
        if (live) setFreeAgents(ids)
      })
      .catch(() => live && setFreeAgents([]))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needWire, freeAgents, teams, league.season, players])

  const horizonPoints = (id: string) => view.weeks.reduce((s, w) => s + scorer.points(id, w), 0)

  const setMove = (rosterId: number, key: MoveKey, id: string, on: boolean) =>
    setMoves((m) => {
      const cur = { ...emptyPlan(), ...m[rosterId] }
      const next: Moves = { ...cur, [key]: toggle(cur[key], id, on) }
      // Keeping or declining something overrides an earlier opposite choice.
      if (key === 'keeps' && on) next.drops = toggle(next.drops, id, false)
      if (key === 'drops' && on) next.keeps = toggle(next.keeps, id, false)
      return { ...m, [rosterId]: next }
    })

  const resetTrade = () => {
    setSend([])
    setReceive([])
    setMoves({})
  }

  /** Something was dropped on `side`'s panel: a rostered player, a waiver pickup, or an IR player. */
  const placeOn = (side: 'me' | 'partner', data: string) => {
    const target = side === 'me' ? me : partner
    const other = side === 'me' ? partner : me
    if (data.startsWith(FA)) {
      const id = data.slice(FA.length)
      setMove(other.rosterId, 'adds', id, false)
      setMove(target.rosterId, 'adds', id, true)
      setMove(target.rosterId, 'declined', id, false)
      return
    }
    const id = data.startsWith(IR) ? data.slice(IR.length) : data
    if (data.startsWith(IR) && owns(target, id)) {
      setMove(target.rosterId, 'activations', id, true)
      return
    }
    if (owns(me, id)) setSend((s) => toggle(s, id, side === 'partner'))
    else if (owns(partner, id)) setReceive((r) => toggle(r, id, side === 'me'))
  }
  const moveAcross = (id: string) => {
    if (owns(me, id)) setSend((s) => toggle(s, id, !s.includes(id)))
    else if (owns(partner, id)) setReceive((r) => toggle(r, id, !r.includes(id)))
  }

  const hasTrade = send.length + receive.length > 0
  const weekIdx = view.weeks.indexOf(viewWeek)

  const panelFor = (team: Team, side: 'me' | 'partner') => ({
    side,
    week: viewWeek,
    players,
    projections,
    points: scorer.points,
    detail: scorer.detail,
    horizonPoints,
    showHorizon: view.weeks.length > 1,
    irEligible: isIrEligible,
    irRoom: Math.max(0, irSlots - (side === 'me' ? meEval : partnerEval).irAfter.length),
    onReceive: (data: string) => placeOn(side, data),
    onMoveAcross: moveAcross,
    onMove: (key: MoveKey, id: string, on: boolean) => setMove(team.rosterId, key, id, on),
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
          lastWeek={LAST_NFL_WEEK}
          playoffs={playoffs}
          value={horizon}
          onChange={setHorizon}
        />
        <ProjectionToggle
          mode={mode}
          onChange={switchMode}
          onInfo={() => setIntro(true)}
          onRetry={retryBlend}
          ctx={blend.ctx}
          error={blend.error}
        />
      </div>

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
            {view.weeks.length > 1 && (
              <div className="flex items-center gap-1">
                <WeekArrow dir={-1} disabled={weekIdx <= 0} onClick={() => setViewWeek(view.weeks[weekIdx - 1])} />
                <WeekArrow dir={1} disabled={weekIdx >= view.weeks.length - 1} onClick={() => setViewWeek(view.weeks[weekIdx + 1])} />
              </div>
            )}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <TeamPanel {...panelFor(me, 'me')} label="You" team={me} otherTeamName={partner.name} ev={meEval} />
            <TeamPanel {...panelFor(partner, 'partner')} label="Trade partner" team={partner} otherTeamName={me.name} ev={partnerEval} />
          </div>
        </>
      )}

      <DropDock me={me} partner={partner} />
      {intro && <LabProjectionsIntro ctx={blend.ctx} onClose={() => setIntro(false)} />}
    </div>
  )
}

function ProjectionToggle({
  mode, onChange, onInfo, onRetry, ctx, error,
}: {
  mode: ProjectionMode
  onChange: (m: ProjectionMode) => void
  onInfo: () => void
  onRetry: () => void
  ctx: BlendCtx | null
  error: string | null
}) {
  const opts: { m: ProjectionMode; label: string }[] = [
    { m: 'sleeper', label: 'Sleeper' },
    { m: 'lab', label: 'Lineup Lab' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Projections</span>
      <div className="flex rounded-full bg-panel-2 p-1 ring-1 ring-line">
        {opts.map((o) => (
          <button
            key={o.m}
            type="button"
            onClick={() => onChange(o.m)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
              mode === o.m ? (o.m === 'lab' ? 'bg-wr text-bg' : 'bg-teal text-bg') : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onInfo}
        aria-label="What are Lineup Lab projections?"
        className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold text-muted ring-1 ring-line hover:text-ink"
      >
        ?
      </button>
      {mode === 'lab' && !ctx && !error && <Spinner />}
      {mode === 'lab' && error && (
        <span className="flex items-center gap-2 text-[11.5px] text-down" title={`Couldn't load /api/market: ${error}`}>
          Couldn't reach market data, showing Sleeper's numbers
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-down/15 px-2.5 py-1 font-semibold transition hover:bg-down/25 active:scale-95"
          >
            Retry
          </button>
        </span>
      )}
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
        className="absolute inset-0 cursor-pointer bg-panel-2 text-ink opacity-0"
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
