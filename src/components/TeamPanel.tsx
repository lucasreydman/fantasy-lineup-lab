import { type ReactNode } from 'react'
import type { BlendResult } from '../lib/blend'
import { moveTags, type TeamEval } from '../lib/trade'
import type { Player, PlayerProjections, Team } from '../lib/types'
import { useDropTarget } from '../lib/touchDrag'
import { opponentLabel, PlayerRow, shortName, type RowTag } from './PlayerRow'
import type { RowAction } from './RowActions'
import { Delta, fmt, SlotBadge, Spinner, TeamAvatar } from './ui'

/** Drag payload prefixes: a waiver pickup, or an IR player being activated. */
export const FA = 'fa:'
export const IR = 'ir:'

export type MoveKey = 'adds' | 'activations' | 'toIr' | 'drops' | 'keeps' | 'declined'

interface Props {
  side: 'me' | 'partner'
  label: string
  team: Team
  otherTeamName: string
  ev: TeamEval
  week: number
  players: Map<string, Player>
  projections: Map<string, PlayerProjections>
  points: (id: string, week: number) => number
  detail: (id: string, week: number) => BlendResult | null
  horizonPoints: (id: string) => number
  showHorizon: boolean
  irEligible: (id: string) => boolean
  irRoom: number
  onReceive: (data: string) => void
  onMoveAcross: (id: string) => void
  onMove: (key: MoveKey, id: string, on: boolean) => void
}

const ICON = {
  trade: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3" />
    </svg>
  ),
  drop: (
    <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  ),
  ir: <span className="text-[10px] font-bold">IR</span>,
}

export function TeamPanel(props: Props) {
  const { label, team, ev, week, players, projections, points, detail, horizonPoints, showHorizon, onMove } = props
  const { over, bind } = useDropTarget(
    props.side,
    { move: `Drop to move to ${team.name}`, add: `Drop to add to ${team.name}` },
    props.onReceive,
  )
  const wr = ev.weeks.find((w) => w.week === week) ?? ev.weeks[0]
  const tags = wr ? moveTags(wr, ev.incoming) : new Map()

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
    ev.adds.includes(id)
      ? 'added'
      : ev.autoAdds.includes(id)
        ? 'autoadd'
        : ev.activations.includes(id)
          ? 'activated'
          : ev.autoActivations.includes(id)
            ? 'autoactivated'
            : ((tags.get(id) as RowTag) ?? null)

  const trade = (id: string): RowAction => ({
    key: 'trade',
    label: ev.outgoing.includes(id) || ev.incoming.includes(id) ? 'Undo this trade piece' : `Trade to ${props.otherTeamName}`,
    icon: ICON.trade,
    tone: 'teal',
    onClick: () => props.onMoveAcross(id),
  })

  /** What a rostered player can do: undo anything this team added, otherwise trade / IR / drop. */
  const actionsFor = (id: string, onBench: boolean): RowAction[] => {
    if (ev.adds.includes(id)) return [{ key: 'undo', label: 'Undo pickup', onClick: () => onMove('adds', id, false) }]
    if (ev.autoAdds.includes(id))
      return [{ key: 'decline', label: 'Remove pickup', onClick: () => onMove('declined', id, true) }]
    if (ev.activations.includes(id))
      return [{ key: 'undo', label: 'Back to IR', onClick: () => onMove('activations', id, false) }]
    if (ev.autoActivations.includes(id))
      return [{ key: 'decline', label: 'Keep on IR', onClick: () => onMove('declined', id, true) }]
    const out: RowAction[] = []
    if (onBench && props.irRoom > 0 && props.irEligible(id))
      out.push({ key: 'ir', label: 'Move to IR (frees a spot)', icon: ICON.ir, onClick: () => onMove('toIr', id, true) })
    if (onBench) out.push({ key: 'drop', label: 'Drop', icon: ICON.drop, tone: 'down', onClick: () => onMove('drops', id, true) })
    out.push(trade(id))
    return out
  }

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
      draggable={!ev.adds.includes(id) && !ev.autoAdds.includes(id)}
      actions={actionsFor(id, false)}
      {...extra}
    />
  )

  const summary = [
    ev.autoAdds.length + ev.adds.length && `${ev.autoAdds.length + ev.adds.length} added`,
    ev.autoActivations.length + ev.activations.length && `${ev.autoActivations.length + ev.activations.length} off IR`,
    ev.autoIr.length + ev.stashed.length && `${ev.autoIr.length + ev.stashed.length} to IR`,
    ev.drops.length && `${ev.drops.length} dropped`,
  ].filter(Boolean)
  const waiverOptions = ev.options.filter((o) => !ev.rosterAfter.includes(o.id))

  return (
    <section {...bind} className={`min-w-0 rounded-2xl bg-panel transition-shadow ${over ? 'drop-glow drop-over' : 'ring-1 ring-line'}`}>
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
        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-2 text-[12px] ${
          ev.openSpots > 0 ? 'bg-wr/10 text-wr' : summary.length ? 'bg-panel-2 text-ink' : 'bg-panel-2 text-muted'
        }`}
      >
        <span>
          Roster{' '}
          <span className="tabular font-semibold">
            {ev.rosterAfter.length}/{ev.limit}
          </span>
          {ev.openSpots > 0 && <span className="ml-1">· {ev.openSpots} open</span>}
        </span>
        {summary.length > 0 && <span className="text-muted">{summary.join(' · ')} · rest-of-season moves</span>}
      </div>

      {wr && (
        <>
          <Section title="Starters">
            {wr.after.slots.map((s, i) => {
              if (!s.playerId)
                return (
                  <div key={`empty-${i}`} className="flex items-center gap-3 border-b border-line/60 bg-down/5 py-2 pr-3 pl-6">
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
            {wr.after.bench.map((id) => row(id, 'BN', tagFor(id), { actions: actionsFor(id, true) }))}
          </Section>
        </>
      )}

      {(waiverOptions.length > 0 || ev.scanning) && (
        <Section title="Waiver wire · best fits" tone="wr">
          <div className="px-4 pt-2 pb-1 text-[11px] text-faint">
            Ranked on rest of season by what each adds to your best lineups. Open spots fill automatically; drag one in or tap
            Add to choose yourself.
          </div>
          {ev.scanning && (
            <div className="px-4 py-3">
              <Spinner label="Scanning the waiver wire…" />
            </div>
          )}
          {waiverOptions.slice(0, 4).map((s) =>
            row(s.id, 'FA', null, {
              dragData: `${FA}${s.id}`,
              draggable: true,
              note: s.reason,
              horizonPoints: undefined,
              actions: [{ key: 'add', label: 'Add', tone: 'wr', primary: true, onClick: () => props.onReceive(FA + s.id) }],
            }),
          )}
        </Section>
      )}

      {ev.drops.length > 0 && (
        <Section title="Dropped" tone="down">
          {ev.drops.map((id) =>
            row(id, 'BN', ev.autoDrops.includes(id) ? 'autodrop' : 'drop', {
              dimmed: true,
              draggable: false,
              actions: [
                {
                  key: 'keep',
                  label: 'Keep',
                  primary: true,
                  onClick: () => (ev.autoDrops.includes(id) ? onMove('keeps', id, true) : onMove('drops', id, false)),
                },
              ],
            }),
          )}
          {ev.autoDrops.length > 0 && (
            <div className="px-4 py-2 text-[11px] text-faint">
              Auto-picked as the cheapest cut over the rest of the season. Drop someone else from the bench to override.
            </div>
          )}
        </Section>
      )}

      {ev.outgoing.length > 0 && (
        <Section title="Traded away">
          {ev.outgoing.map((id) =>
            row(id, 'OUT', 'traded', {
              dimmed: true,
              actions: [{ key: 'undo', label: 'Undo', primary: true, onClick: () => props.onMoveAcross(id) }],
            }),
          )}
        </Section>
      )}

      {(ev.irAfter.length > 0 || team.taxi.length > 0) && (
        <Section title="IR / Taxi">
          {ev.irAfter.map((id) => {
            if (ev.stashed.includes(id))
              return row(id, 'IR', 'stashed', {
                draggable: false,
                actions: [{ key: 'undo', label: 'Undo', primary: true, onClick: () => onMove('toIr', id, false) }],
              })
            if (ev.autoIr.includes(id))
              return row(id, 'IR', 'autoir', {
                draggable: false,
                actions: [{ key: 'keep', label: 'Keep active', primary: true, onClick: () => onMove('keeps', id, true) }],
              })
            return row(id, 'IR', null, {
              dragData: `${IR}${id}`,
              actions: [{ key: 'activate', label: 'Activate', onClick: () => onMove('activations', id, true) }, trade(id)],
            })
          })}
          {team.taxi.filter((id) => !ev.outgoing.includes(id)).map((id) => row(id, 'TAXI', null, { actions: [trade(id)] }))}
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
