import type { ReactNode } from 'react'
import { BLEND_LABEL, type BlendPart, type BlendResult } from '../lib/blend'
import type { Player, PlayerProjections } from '../lib/types'
import { fmt, InjuryTag, PlayerAvatar, PosText, signed, SlotBadge } from './ui'

export type RowTag = 'acquired' | 'elevated' | 'benched' | 'drop' | 'autodrop' | 'traded' | 'added' | 'activated' | 'waiver'

const TAG: Record<RowTag, { label: string; className: string }> = {
  acquired: { label: 'NEW', className: 'bg-teal/15 text-teal' },
  elevated: { label: '▲ START', className: 'bg-up/15 text-up' },
  benched: { label: '▼ BENCH', className: 'bg-panel-3 text-muted' },
  drop: { label: 'DROP', className: 'bg-down/15 text-down' },
  autodrop: { label: 'AUTO-DROP', className: 'bg-down/15 text-down' },
  traded: { label: 'TRADED', className: 'bg-panel-3 text-muted' },
  added: { label: 'WAIVER ADD', className: 'bg-wr/15 text-wr' },
  activated: { label: 'OFF IR', className: 'bg-wr/15 text-wr' },
  waiver: { label: 'FA', className: 'bg-panel-3 text-muted' },
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

function blendTitle(b: BlendResult) {
  const parts = (Object.entries(b.contrib) as [BlendPart, number][]).map(([k, v]) => `${BLEND_LABEL[k]} ${signed(v)}`)
  return [`Sleeper ${fmt(b.sleeper)}`, ...parts, `= Blend ${fmt(b.points)}`].join('\n')
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
  actions?: ReactNode
}

export function PlayerRow({
  id, player, slot, points, horizonPoints, opponent, tag, replaces, dragData, draggable = true, dimmed, blend, note, actions,
}: Props) {
  const pos = player?.pos ?? '?'
  const name = player ? `${player.first} ${player.last}`.trim() : `Player ${id}`
  const bye = opponent === 'BYE'
  const diff = blend ? blend.points - blend.sleeper : 0
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', dragData ?? id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`group pop-in flex items-center gap-3 border-b border-line/60 px-3 py-2 last:border-b-0 ${
        draggable ? 'cursor-grab active:cursor-grabbing hover:bg-panel-2' : ''
      } ${dimmed ? 'opacity-45' : ''}`}
    >
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
      {actions}
      <div className="w-16 shrink-0 text-right" title={blend ? blendTitle(blend) : undefined}>
        <div className={`tabular text-[14px] font-semibold ${points === 0 ? 'text-faint' : ''}`}>{fmt(points)}</div>
        {blend && Math.abs(diff) >= 0.05 ? (
          <div className="tabular text-[10.5px] text-faint">
            SLP {fmt(blend.sleeper)}{' '}
            <span className={diff > 0 ? 'text-up' : 'text-down'}>{diff > 0 ? '▲' : '▼'}</span>
          </div>
        ) : (
          horizonPoints !== undefined && (
            <div className="tabular text-[10.5px] text-faint" title="Total over the selected weeks">
              {horizonPoints.toFixed(1)}
            </div>
          )
        )}
      </div>
    </div>
  )
}
