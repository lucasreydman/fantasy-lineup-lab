import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BLEND_LABEL, type BlendPart, type BlendResult } from '../lib/blend'
import type { Player, PlayerProjections } from '../lib/types'
import { useDraggable } from '../lib/touchDrag'
import { ActionSheet, inlineOnPhone, RowActionsInline, type RowAction } from './RowActions'
import { fmt, InjuryTag, PlayerAvatar, PosText, signed, SlotBadge, tierColor, TIER_HINT } from './ui'

export type RowTag =
  | 'acquired' | 'elevated' | 'benched' | 'drop' | 'autodrop' | 'traded'
  | 'added' | 'autoadd' | 'activated' | 'autoactivated' | 'stashed' | 'autoir'

const TAG: Record<RowTag, { label: string; className: string }> = {
  acquired: { label: 'NEW', className: 'bg-teal/15 text-teal' },
  elevated: { label: '▲ START', className: 'bg-up/15 text-up' },
  benched: { label: '▼ BENCH', className: 'bg-panel-3 text-muted' },
  drop: { label: 'DROP', className: 'bg-down/15 text-down' },
  autodrop: { label: 'AUTO-DROP', className: 'bg-down/15 text-down' },
  traded: { label: 'TRADED', className: 'bg-panel-3 text-muted' },
  added: { label: 'WAIVER ADD', className: 'bg-wr/15 text-wr' },
  autoadd: { label: 'AUTO-ADD', className: 'bg-wr/15 text-wr' },
  activated: { label: 'OFF IR', className: 'bg-wr/15 text-wr' },
  autoactivated: { label: 'AUTO OFF IR', className: 'bg-wr/15 text-wr' },
  stashed: { label: 'TO IR', className: 'bg-warn/15 text-warn' },
  autoir: { label: 'AUTO-IR', className: 'bg-warn/15 text-warn' },
}

export function opponentLabel(proj: PlayerProjections | undefined, week: number) {
  if (!proj) return '—'
  const wk = proj[week]
  if (wk === null) return 'BYE'
  if (!wk) return '—'
  return wk.opponent ? `${wk.away ? '@' : 'vs'} ${wk.opponent}` : '—'
}

export function shortName(p: Player | undefined, id: string) {
  if (!p) return id
  if (p.pos === 'DEF') return `${p.first} ${p.last}`.trim() || id
  return `${p.first.slice(0, 1)}. ${p.last}`
}

/**
 * The points column. With Lineup Lab projections on, it's a button: tap (or click)
 * for the breakdown from Sleeper's number through each adjustment.
 */
function PointsCell({ blend, children }: { blend: BlendResult | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  if (!blend)
    return (
      <div className="w-14 shrink-0 text-right sm:w-16" title={TIER_HINT}>
        {children}
      </div>
    )
  const parts = Object.entries(blend.contrib) as [BlendPart, number][]
  return (
    <div ref={ref} className="relative w-14 shrink-0 sm:w-16">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Projection breakdown"
        className="-my-1 -mr-1.5 w-[calc(100%+6px)] rounded-lg px-1.5 py-1 text-right transition hover:bg-panel-3 active:scale-95"
      >
        {children}
      </button>
      {open && (
        <div className="pop-in absolute top-full right-0 z-30 mt-1 w-56 rounded-xl bg-panel-3 p-3 text-[12px] shadow-2xl ring-1 ring-line">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">How we got here</div>
          <Line label="Sleeper" value={fmt(blend.sleeper)} />
          {parts.map(([k, v]) => (
            <Line key={k} label={BLEND_LABEL[k]} value={signed(v)} tone={v > 0 ? 'up' : 'down'} />
          ))}
          {!parts.length && <div className="py-0.5 text-faint">No adjustments this week</div>}
          <div className="mt-1.5 border-t border-line pt-1.5">
            <Line label="Lineup Lab" value={fmt(blend.points)} strong />
          </div>
        </div>
      )}
    </div>
  )
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: 'up' | 'down'; strong?: boolean }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
  return (
    <div className="flex justify-between py-0.5">
      <span className={strong ? 'font-semibold' : 'text-muted'}>{label}</span>
      <span className={`tabular ${strong ? 'font-semibold' : ''} ${color}`}>{value}</span>
    </div>
  )
}

interface Props {
  id: string
  player: Player | undefined
  slot: string
  points: number
  horizonPoints?: number
  opponent: string
  tag?: RowTag | null
  replaces?: { name: string; points: number } | null
  /** What a drag carries; defaults to the player id. */
  dragData?: string
  draggable?: boolean
  dimmed?: boolean
  blend?: BlendResult | null
  note?: ReactNode
  actions?: RowAction[]
}

export function PlayerRow({
  id, player, slot, points, horizonPoints, opponent, tag, replaces, dragData, draggable = true, dimmed, blend, note, actions,
}: Props) {
  const pos = player?.pos ?? '?'
  const name = player ? `${player.first} ${player.last}`.trim() : `Player ${id}`
  const bye = opponent === 'BYE'
  const diff = blend ? blend.points - blend.sleeper : 0
  const drag = useDraggable(dragData ?? id, player ? shortName(player, id) : id, draggable)
  const [sheet, setSheet] = useState(false)
  const acts = actions ?? []
  // On phones the whole row is the tap target for its actions (buttons inside keep their own taps).
  const onRowTap = (e: React.MouseEvent) => {
    if (!acts.length || inlineOnPhone(acts) || !window.matchMedia('(max-width: 639px)').matches) return
    if ((e.target as HTMLElement).closest('button')) return
    setSheet(true)
  }
  return (
    <div
      {...drag}
      onClick={onRowTap}
      className={`group pop-in drag-row flex items-center gap-2 border-b border-line/60 py-2 pr-3 pl-1.5 transition-colors last:border-b-0 sm:gap-3 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dimmed ? 'opacity-45' : ''} ${acts.length && !inlineOnPhone(acts) ? 'max-sm:active:bg-panel-2' : ''}`}
    >
      <Grip visible={draggable} />
      <SlotBadge slot={slot} />
      <PlayerAvatar id={id} pos={pos} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-[14px] font-medium ${tag === 'traded' ? 'line-through decoration-muted' : ''}`}>
            {name}
          </span>
          <InjuryTag status={player?.injury ?? null} />
          {tag && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider ${TAG[tag].className}`}>
              {TAG[tag].label}
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px] text-muted">
          <PosText pos={pos} /> <span>{player?.team ?? 'FA'}</span>
          <span className={`ml-1.5 ${bye ? 'font-semibold text-warn' : ''}`}>{opponent}</span>
          {note && <span className="ml-2 text-faint">{note}</span>}
          {!note && replaces && (
            <span className="ml-2 text-faint">
              replaces {replaces.name} ({fmt(replaces.points)})
            </span>
          )}
        </div>
      </div>
      <RowActionsInline actions={acts} onMore={() => setSheet(true)} />
      <PointsCell blend={blend ?? null}>
        <div className="tabular text-[14.5px] font-semibold" style={{ color: tierColor(pos, points, bye) }}>
          {fmt(points)}
        </div>
        {blend && Math.abs(diff) >= 0.05 ? (
          <div className="tabular whitespace-nowrap text-[10px] text-faint sm:text-[10.5px]">
            <span className="max-sm:hidden">SLP </span>
            {fmt(blend.sleeper)}
            <span className={`ml-0.5 ${diff > 0 ? 'text-up' : 'text-down'}`}>{diff > 0 ? '▲' : '▼'}</span>
          </div>
        ) : (
          horizonPoints !== undefined && (
            <div className="tabular text-[10.5px] text-faint" title="Total over the selected weeks">
              {horizonPoints.toFixed(1)}
            </div>
          )
        )}
      </PointsCell>
      {sheet && (
        <ActionSheet
          title={name}
          subtitle={
            <>
              {pos} · {player?.team ?? 'FA'} · {opponent} · {fmt(points)} pts
            </>
          }
          actions={acts}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  )
}

/** Six-dot handle: says "you can pick this up" (press and hold on touch). */
function Grip({ visible }: { visible: boolean }) {
  return (
    <span className={`grip flex w-3 shrink-0 justify-center text-faint transition-colors ${visible ? '' : 'invisible'}`} aria-hidden>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
        <circle cx="2" cy="2" r="1.3" /><circle cx="6" cy="2" r="1.3" />
        <circle cx="2" cy="7" r="1.3" /><circle cx="6" cy="7" r="1.3" />
        <circle cx="2" cy="12" r="1.3" /><circle cx="6" cy="12" r="1.3" />
      </svg>
    </span>
  )
}
