import { useState, type ReactNode } from 'react'
import type { BlendResult } from '../lib/blend'
import { moveTags, type TeamEval } from '../lib/trade'
import type { Player, PlayerProjections, Team } from '../lib/types'
import type { Pickup } from '../lib/waivers'
import { opponentLabel, PlayerRow, shortName, type RowTag } from './PlayerRow'
import { Delta, fmt, SlotBadge, Spinner, TeamAvatar } from './ui'

/** Drag payload prefixes: a waiver pickup, or an IR player being activated. */
export const FA = 'fa:'
export const IR = 'ir:'

interface Props {
  label: string
  team: Team
  ev: TeamEval
  week: number
  players: Map<string, Player>
  projections: Map<string, PlayerProjections>
  points: (id: string, week: number) => number
  detail: (id: string, week: number) => BlendResult | null
  horizonPoints: (id: string) => number
  showHorizon: boolean
  manualDrops: string[]
  adds: string[]
  activations: string[]
  /** null while loading; undefined when not needed */
  suggestions: Pickup[] | null | undefined
  onReceive: (data: string) => void
  onMoveAcross: (id: string) => void
  onToggleDrop: (id: string) => void
  onKeep: (id: string) => void
  onAdd: (id: string) => void
  onRemoveAdd: (id: string) => void
  onActivate: (id: string) => void
  onDeactivate: (id: string) => void
}

export function TeamPanel(props: Props) {
  const { label, team, ev, week, players, projections, points, detail, horizonPoints, showHorizon, manualDrops, adds, activations } = props
  const [over, setOver] = useState(false)
  const wr = ev.weeks.find((w) => w.week === week) ?? ev.weeks[0]
  const tags = wr ? moveTags(wr, ev.incoming) : new Map()
  const canDrop = ev.dropsNeeded > 0 || manualDrops.length > 0
  const openSpots = ev.limit - ev.rosterAfter.length
  const onIr = team.reserve.filter((id) => !ev.outgoing.includes(id) && !activations.includes(id))
  const irReady = onIr.filter((id) => horizonPoints(id) > 0)

  // Pair each new starter with a starter who lost their spot, preferring the same slot.
  // Pure reshuffles between flex and fixed slots aren't replacements, so they get no hint.
  const replacements = new Map<string, string>()
  if (wr) {
    const beforeIds = wr.before.slots.map((s) => s.playerId)
    const afterIds = new Set(wr.after.slots.map((s) => s.playerId))
    const lost = beforeIds.filter((id): id is string => !!id && !afterIds.has(id))
    wr.after.slots.forEach((s, i) => {
      if (!s.playerId || beforeIds.includes(s.playerId) || !lost.length) return
      const prev = beforeIds[i]
      const k = prev && lost.includes(prev) ? lost.indexOf(prev) : 0
      replacements.set(s.playerId, lost.splice(k, 1)[0])
    })
  }

  const tagFor = (id: string): RowTag | null =>
    adds.includes(id) ? 'added' : activations.includes(id) ? 'activated' : ((tags.get(id) as RowTag) ?? null)

  /** Players this team picked up or activated are undone, not traded. */
  const ownAction = (id: string) =>
    adds.includes(id) ? (
      <SmallButton onClick={() => props.onRemoveAdd(id)} tone="muted">
        Undo add
      </SmallButton>
    ) : activations.includes(id) ? (
      <SmallButton onClick={() => props.onDeactivate(id)} tone="muted">
        Back to IR
      </SmallButton>
    ) : (
      <MoveButton onClick={() => props.onMoveAcross(id)} title="Move to other team" />
    )

  const row = (id: string, slot: string, tag: RowTag | null, extra: Partial<Parameters<typeof PlayerRow>[0]> = {}) => (
    <PlayerRow
      key={`${slot}-${id}`}
      id={id}
      player={players.get(id)}
      slot={slot}
      points={points(id, week)}
      horizonPoints={showHorizon ? horizonPoints(id) : undefined}
      opponent={opponentLabel(projections.get(id), week)}
      blend={detail(id, week)}
      tag={tag}
      draggable={!adds.includes(id) && !activations.includes(id)}
      actions={ownAction(id)}
      {...extra}
    />
  )

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const data = e.dataTransfer.getData('text/plain')
        if (data) props.onReceive(data)
      }}
      className={`min-w-0 overflow-hidden rounded-2xl bg-panel transition-shadow ${over ? 'drop-glow' : 'ring-1 ring-line'}`}
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <TeamAvatar url={team.avatarUrl} name={team.name} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
          <div className="truncate text-[15px] font-semibold">{team.name}</div>
        </div>
        {wr && (
          <div className="text-right">
            <div className="text-[11px] text-muted">Week {week} proj</div>
            <div className="tabular text-[15px] font-semibold">
              <span className="text-faint">{fmt(wr.before.total)}</span>
              <span className="mx-1 text-faint">→</span>
              {fmt(wr.after.total)}
            </div>
            <Delta value={wr.after.total - wr.before.total} className="text-[12px]" />
          </div>
        )}
      </header>

      <div
        className={`flex items-center justify-between px-4 py-2 text-[12px] ${
          ev.dropsNeeded > 0 ? 'bg-down/10 text-down' : openSpots > 0 ? 'bg-wr/10 text-wr' : 'bg-panel-2 text-muted'
        }`}
      >
        <span>
          Roster{' '}
          <span className="tabular font-semibold">
            {ev.sizeAfterTrade}/{ev.limit}
          </span>
          {openSpots > 0 && <span className="ml-1">· {openSpots} open spot{openSpots === 1 ? '' : 's'}</span>}
        </span>
        {ev.dropsNeeded > 0 && (
          <span className="font-semibold">
            Must drop {ev.dropsNeeded} player{ev.dropsNeeded > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {wr && (
        <>
          <Section title="Starters">
            {wr.after.slots.map((s, i) => {
              if (!s.playerId)
                return (
                  <div key={`empty-${i}`} className="flex items-center gap-3 border-b border-line/60 bg-down/5 px-3 py-2">
                    <SlotBadge slot={s.slot} />
                    <div className="flex h-9 items-center text-[13px] font-medium text-down">Empty — no eligible player</div>
                  </div>
                )
              const replaced = replacements.get(s.playerId) ?? null
              return row(s.playerId, s.slot, tagFor(s.playerId), {
                replaces: replaced ? { name: shortName(players.get(replaced), replaced), points: points(replaced, week) } : null,
              })
            })}
          </Section>

          <Section title="Bench">
            {wr.after.bench.length === 0 && <Empty>No bench players</Empty>}
            {wr.after.bench.map((id) =>
              row(id, 'BN', tagFor(id), {
                actions: (
                  <>
                    {canDrop && !adds.includes(id) && !activations.includes(id) && (
                      <SmallButton onClick={() => props.onToggleDrop(id)} tone="down">
                        Drop
                      </SmallButton>
                    )}
                    {ownAction(id)}
                  </>
                ),
              }),
            )}
          </Section>
        </>
      )}

      {openSpots > 0 && (
        <Section title={`Fill ${openSpots} open spot${openSpots === 1 ? '' : 's'}`} tone="wr">
          <div className="px-4 pt-2 pb-1 text-[11px] text-faint">
            Ranked by what each adds to your best lineups over these weeks. Drag one onto the roster or hit Add.
          </div>
          {irReady.map((id) =>
            row(id, 'IR', null, {
              dragData: `${IR}${id}`,
              draggable: true,
              note: 'activate from IR',
              actions: (
                <SmallButton onClick={() => props.onActivate(id)} tone="wr">
                  Activate
                </SmallButton>
              ),
            }),
          )}
          {props.suggestions === null && (
            <div className="px-4 py-3">
              <Spinner label="Scanning the waiver wire…" />
            </div>
          )}
          {props.suggestions?.length === 0 && irReady.length === 0 && <Empty>No free agent would help this roster.</Empty>}
          {props.suggestions?.map((s) =>
            row(s.id, 'FA', null, {
              dragData: `${FA}${s.id}`,
              draggable: true,
              note: s.reason,
              actions: (
                <SmallButton onClick={() => props.onAdd(s.id)} tone="wr">
                  Add
                </SmallButton>
              ),
            }),
          )}
        </Section>
      )}

      {ev.drops.length > 0 && (
        <Section title="Dropped to make room" tone="down">
          {ev.drops.map((id) =>
            row(id, 'BN', ev.autoDrops.includes(id) ? 'autodrop' : 'drop', {
              dimmed: true,
              draggable: false,
              actions: (
                <SmallButton onClick={() => props.onKeep(id)} tone="muted">
                  Keep
                </SmallButton>
              ),
            }),
          )}
          {ev.autoDrops.length > 0 && (
            <div className="px-4 py-2 text-[11px] text-faint">
              Auto-picked as the cheapest cut for your lineup. Hit Drop on a bench player to choose instead.
            </div>
          )}
        </Section>
      )}

      {ev.outgoing.length > 0 && (
        <Section title="Traded away">{ev.outgoing.map((id) => row(id, 'OUT', 'traded', { dimmed: true, draggable: true }))}</Section>
      )}

      {(onIr.length > 0 || team.taxi.length > 0) && (
        <Section title="IR / Taxi">
          {onIr.map((id) =>
            row(id, 'IR', null, {
              dragData: `${IR}${id}`,
              draggable: true,
              actions: (
                <>
                  <SmallButton onClick={() => props.onActivate(id)} tone="muted">
                    Activate
                  </SmallButton>
                  <MoveButton onClick={() => props.onMoveAcross(id)} title="Move to other team" />
                </>
              ),
            }),
          )}
          {team.taxi.filter((id) => !ev.outgoing.includes(id)).map((id) => row(id, 'TAXI', null, { draggable: true }))}
        </Section>
      )}
    </section>
  )
}

function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: 'down' | 'wr' }) {
  return (
    <div>
      <div
        className={`border-b border-line/60 px-4 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider ${
          tone === 'down' ? 'text-down' : tone === 'wr' ? 'text-wr' : 'text-muted'
        }`}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3 text-[12px] text-faint">{children}</div>
}

function MoveButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-teal/15 hover:text-teal sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3" />
      </svg>
    </button>
  )
}

function SmallButton({ children, onClick, tone }: { children: ReactNode; onClick: () => void; tone: 'down' | 'muted' | 'wr' }) {
  const cls =
    tone === 'down'
      ? 'bg-down/10 text-down hover:bg-down/20'
      : tone === 'wr'
        ? 'bg-wr/15 text-wr hover:bg-wr/25'
        : 'bg-panel-3 text-ink hover:bg-line'
  return (
    <button type="button" onClick={onClick} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${cls}`}>
      {children}
    </button>
  )
}
