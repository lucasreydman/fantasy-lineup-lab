import { useState } from 'react'
import { SLOT_ELIGIBILITY, SLOT_LABEL } from '../lib/lineup'
import { playerThumb } from '../lib/sleeper'

const POS_COLOR: Record<string, string> = {
  QB: 'var(--color-qb)',
  RB: 'var(--color-rb)',
  WR: 'var(--color-wr)',
  TE: 'var(--color-te)',
  K: 'var(--color-k)',
  DEF: 'var(--color-def)',
}

export const posColor = (pos: string) => POS_COLOR[pos] ?? 'var(--color-idp)'

export const fmt = (n: number) => n.toFixed(2)

// Weekly projection tiers per position (strong / solid / thin), roughly PPR. Color says
// at a glance which starters are carrying the week and which are a risk.
const TIERS: Record<string, [strong: number, solid: number, thin: number]> = {
  QB: [22, 16, 12],
  RB: [16, 10.5, 7],
  WR: [16, 10.5, 7],
  TE: [12.5, 8, 5.5],
  K: [10, 8, 6],
  DEF: [10, 7, 5],
}
export const TIER_HINT = 'Colored by tier for the position: green strong, white solid, orange thin, gray empty'

export function tierColor(pos: string, pts: number, bye = false): string {
  if (bye || pts <= 0.05) return 'var(--color-faint)'
  const t = TIERS[pos]
  if (!t) return 'var(--color-ink)'
  if (pts >= t[0]) return 'var(--color-up)'
  if (pts >= t[1]) return 'var(--color-ink)'
  if (pts >= t[2]) return 'color-mix(in srgb, var(--color-ink) 72%, var(--color-bg))'
  return 'var(--color-te)'
}
export const fmt1 = (n: number) => n.toFixed(1)
export const signed = (n: number, digits = 2) =>
  `${n > 0.004 ? '+' : n < -0.004 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`

const BENCHISH = new Set(['BN', 'IR', 'TAXI', 'DROP', 'OUT', 'FA'])

/** Sleeper-style slot pill: solid tint for single positions, split tint for flexes. */
export function SlotBadge({ slot }: { slot: string }) {
  const positions = (SLOT_ELIGIBILITY[slot] ?? [slot]).filter((p) => POS_COLOR[p])
  const label = SLOT_LABEL[slot] ?? slot
  const bg =
    BENCHISH.has(slot)
      ? 'var(--color-panel-3)'
      : positions.length > 1
        ? `linear-gradient(135deg, ${positions
            .map((p, i) => `color-mix(in srgb, ${posColor(p)} 32%, transparent) ${(i / positions.length) * 100}% ${((i + 1) / positions.length) * 100}%`)
            .join(', ')})`
        : `color-mix(in srgb, ${posColor(positions[0] ?? slot)} 20%, transparent)`
  const color =
    BENCHISH.has(slot) ? 'var(--color-muted)' : positions.length > 1 ? 'var(--color-ink)' : posColor(positions[0] ?? slot)
  return (
    <span
      className="inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold tracking-wide sm:w-11 sm:text-[11px]"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  )
}

export function PosText({ pos }: { pos: string }) {
  return (
    <span className="font-semibold" style={{ color: posColor(pos) }}>
      {pos}
    </span>
  )
}

export function PlayerAvatar({ id, pos, size = 36 }: { id: string; pos: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const isDef = pos === 'DEF'
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full bg-panel-3"
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${posColor(pos)} 55%, transparent)` }}
    >
      {!failed && (
        <img
          src={playerThumb(id, pos)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className={isDef ? 'h-full w-full object-contain p-1' : 'h-full w-full object-cover object-top'}
        />
      )}
    </div>
  )
}

export function TeamAvatar({ url, name, size = 40 }: { url: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  return url && !failed ? (
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-panel-3 text-sm font-semibold text-muted"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export function InjuryTag({ status }: { status: string | null }) {
  if (!status) return null
  const short: Record<string, string> = {
    Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS', NA: 'NA', DNR: 'DNR',
  }
  const s = short[status] ?? status.slice(0, 3).toUpperCase()
  const color = s === 'Q' ? 'var(--color-warn)' : 'var(--color-down)'
  return (
    <span className="ml-1.5 align-middle text-[10px] font-bold" style={{ color }} title={status}>
      {s}
    </span>
  )
}

export function Delta({ value, className = '', digits = 2 }: { value: number; className?: string; digits?: number }) {
  const color = value > 0.004 ? 'text-up' : value < -0.004 ? 'text-down' : 'text-muted'
  return <span className={`tabular font-semibold ${color} ${className}`}>{signed(value, digits)}</span>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-teal" />
      {label}
    </div>
  )
}
