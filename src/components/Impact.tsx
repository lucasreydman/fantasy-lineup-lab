import { useEffect, useRef, useState } from 'react'
import type { TeamEval } from '../lib/trade'
import { Delta, fmt1, signed, TeamAvatar } from './ui'

export interface Horizon {
  start: number
  end: number
}

interface PickerProps {
  current: number
  lastWeek: number
  /** The league's playoff weeks (from its settings). */
  playoffs: { start: number; end: number }
  value: Horizon
  onChange: (h: Horizon) => void
}

export function HorizonPicker({ current, lastWeek, playoffs, value, onChange }: PickerProps) {
  const seasonEnd = Math.max(current, playoffs.end)
  const presets: { label: string; h: Horizon }[] = [
    { label: 'This week', h: { start: current, end: current } },
    { label: 'Next 3 weeks', h: { start: current, end: Math.min(seasonEnd, current + 2) } },
    // Once the playoffs start there's no regular season left to show.
    ...(current < playoffs.start
      ? [{ label: 'Rest of reg. season', h: { start: current, end: playoffs.start - 1 } }]
      : []),
    { label: 'Rest of season', h: { start: current, end: seasonEnd } },
    ...(current <= playoffs.end
      ? [{ label: 'Playoffs', h: { start: Math.max(current, playoffs.start), end: playoffs.end } }]
      : []),
  ].filter((p, i, all) => all.findIndex((q) => q.h.start === p.h.start && q.h.end === p.h.end) === i)
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1)
  const select = 'rounded-lg bg-panel-3 px-2 py-1.5 text-[12px] font-medium outline-none ring-1 ring-line focus:ring-teal'
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
      <div className="flex max-w-full min-w-0 flex-wrap rounded-2xl bg-panel-2 p-1 ring-1 ring-line sm:flex-nowrap sm:rounded-full sm:whitespace-nowrap">
        {presets.map((p) => {
          const active = p.h.start === value.start && p.h.end === value.end
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.h)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                active ? 'bg-teal text-bg' : 'text-muted hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        Wk
        <select
          className={select}
          value={value.start}
          onChange={(e) => {
            const start = Number(e.target.value)
            onChange({ start, end: Math.max(start, value.end) })
          }}
        >
          {weeks.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        to
        <select
          className={select}
          value={value.end}
          onChange={(e) => {
            const end = Number(e.target.value)
            onChange({ start: Math.min(value.start, end), end })
          }}
        >
          {weeks.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

interface ImpactProps {
  me: { name: string; avatarUrl: string | null; ev: TeamEval }
  partner: { name: string; avatarUrl: string | null; ev: TeamEval }
  week: number
  onWeek: (w: number) => void
  hasTrade: boolean
}

export function Impact({ me, partner, week, onWeek, hasTrade }: ImpactProps) {
  const n = me.ev.weeks.length
  const range = n === 1 ? `Week ${me.ev.weeks[0].week}` : `Weeks ${me.ev.weeks[0].week}–${me.ev.weeks[n - 1].week}`
  return (
    <div className="rounded-2xl bg-panel p-4 ring-1 ring-line">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Projected impact · {range}</h2>
        {hasTrade && <Verdict me={me.ev.delta} partner={partner.ev.delta} />}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ImpactCard {...me} label="You" n={n} />
        <ImpactCard {...partner} label="Trade partner" n={n} />
      </div>
      {n > 1 && <WeekBars me={me.ev} partner={partner.ev} partnerName={partner.name} week={week} onWeek={onWeek} />}
    </div>
  )
}

function Verdict({ me, partner }: { me: number; partner: number }) {
  const text =
    me > 0.05 && partner > 0.05
      ? 'Win-win on projections'
      : me > 0.05
        ? 'Helps you, hurts them'
        : partner > 0.05
          ? 'Helps them more than you'
          : me < -0.05 && partner < -0.05
            ? 'Hurts both lineups'
            : 'Roughly neutral'
  const tone = me > 0.05 ? 'bg-up/15 text-up' : me < -0.05 ? 'bg-down/15 text-down' : 'bg-panel-3 text-muted'
  return <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}>{text}</span>
}

function ImpactCard({
  label, name, avatarUrl, ev, n,
}: { label: string; name: string; avatarUrl: string | null; ev: TeamEval; n: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-panel-2 px-4 py-3">
      <TeamAvatar url={avatarUrl} name={name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
        <div className="truncate text-[14px] font-medium">{name}</div>
      </div>
      <div className="text-right">
        <div className="tabular text-[12px] text-muted">
          {fmt1(ev.beforeTotal)} → <span className="text-ink">{fmt1(ev.afterTotal)}</span>
        </div>
        <Delta value={ev.delta} className="text-[22px] leading-tight" digits={1} />
        {n > 1 && <div className="tabular text-[11px] text-faint">{signed(ev.delta / n, 1)} / wk</div>}
      </div>
    </div>
  )
}

// Series colors: identity, not good/bad (a bar's side of the zero line says that).
// Validated as a pair on the panel surface: lightness band, chroma, CVD ΔE 13.4.
const YOU = '#14a896'
const THEM = '#d95926'

/** A round step that splits `span` into about four gridlines. */
function niceStep(span: number) {
  const raw = span / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
}

/** A bar from the zero line to `v`, rounded only at its data end. */
function barPath(x: number, w: number, y0: number, y1: number) {
  const h = Math.abs(y1 - y0)
  const r = Math.min(3, w / 2, h)
  if (h < 0.5) return ''
  if (y1 < y0)
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`
}

function WeekBars({
  me, partner, partnerName, week, onWeek,
}: { me: TeamEval; partner: TeamEval; partnerName: string; week: number; onWeek: (w: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = me.weeks.map((w, i) => ({
    week: w.week,
    you: w.after.total - w.before.total,
    them: partner.weeks[i].after.total - partner.weeks[i].before.total,
  }))
  const values = rows.flatMap((r) => [r.you, r.them])
  const lo0 = Math.min(0, ...values)
  const hi0 = Math.max(0, ...values)
  const step = niceStep(Math.max(hi0 - lo0, 2))
  const lo = Math.floor(lo0 / step) * step
  const hi = Math.ceil(hi0 / step) * step || step
  const ticks: number[] = []
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100)

  // Geometry: a left gutter for the scale, room under the plot for week labels.
  const GUTTER = 34
  const TOP = 8
  const PLOT_H = 150
  const LABELS = 22
  const H = TOP + PLOT_H + LABELS
  const colW = (width - GUTTER) / rows.length
  const barW = Math.max(3, Math.min(16, (colW - 10) / 2))
  const y = (v: number) => TOP + ((hi - v) / (hi - lo)) * PLOT_H
  const zero = y(0)
  const labelEvery = colW >= 30 ? 1 : colW >= 16 ? 2 : 3

  const focus = rows.find((r) => r.week === hover) ?? rows[0]
  const tipLeft = GUTTER + rows.indexOf(focus) * colW + colW / 2

  return (
    <div className="mt-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
        <span className="text-muted max-sm:w-full">Change in projected starting lineup, by week</span>
        <span className="flex items-center gap-1.5 text-ink sm:ml-auto">
          <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: YOU }} /> You
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-ink">
          <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: THEM }} />
          <span className="truncate">{partnerName}</span>
        </span>
      </div>

      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={H} className="block overflow-visible" role="img" aria-label="Weekly lineup change for both teams">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={GUTTER} x2={width} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={GUTTER - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tabular" fontSize="10" fill="var(--color-faint)">
                {t > 0 ? `+${t}` : t === 0 ? '0' : `−${Math.abs(t)}`}
              </text>
            </g>
          ))}

          {rows.map((r, i) => {
            const x0 = GUTTER + i * colW
            const cx = x0 + colW / 2
            const selected = r.week === week
            return (
              <g key={r.week}>
                {(selected || hover === r.week) && (
                  // A band around the bars, not the whole column (wide when there are few weeks).
                  <rect
                    x={cx - Math.min(colW - 4, barW * 2 + 28) / 2}
                    y={TOP - 4}
                    width={Math.min(colW - 4, barW * 2 + 28)}
                    height={PLOT_H + LABELS + 2}
                    rx={8}
                    fill={selected ? 'rgb(255 255 255 / 0.06)' : 'rgb(255 255 255 / 0.03)'}
                  />
                )}
                <path d={barPath(cx - barW - 1, barW, zero, y(r.you))} fill={YOU} />
                <path d={barPath(cx + 1, barW, zero, y(r.them))} fill={THEM} />
                {(i % labelEvery === 0 || selected) && (
                  <text x={cx} y={TOP + PLOT_H + 15} textAnchor="middle" fontSize="10.5" fontWeight={selected ? 700 : 500} fill={selected ? 'var(--color-ink)' : 'var(--color-muted)'}>
                    W{r.week}
                  </text>
                )}
                {/* Hit area: the whole column, much bigger than the bars. */}
                <rect
                  x={x0}
                  y={0}
                  width={colW}
                  height={H}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(r.week)}
                  onClick={() => onWeek(r.week)}
                >
                  <title>{`Week ${r.week}: you ${signed(r.you, 1)}, ${partnerName} ${signed(r.them, 1)}`}</title>
                </rect>
              </g>
            )
          })}
        </svg>

        {/* Hover tooltip, beside the column (flips left near the right edge). */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg bg-panel-3 px-2.5 py-1.5 text-[11.5px] whitespace-nowrap shadow-xl ring-1 ring-line"
            style={{
              top: TOP,
              ...(tipLeft + colW / 2 + 150 < width
                ? { left: tipLeft + colW / 2 + 4 }
                : { right: width - (tipLeft - colW / 2 - 4) }),
            }}
          >
            <TipBody row={focus} partnerName={partnerName} />
          </div>
        )}
      </div>
      {/* The selected week, always spelled out (touch screens have no hover). */}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
        <span className="font-semibold text-ink">Week {week}</span>
        {(() => {
          const r = rows.find((x) => x.week === week) ?? rows[0]
          return (
            <>
              <span className="tabular">You {signed(r.you, 1)}</span>
              <span className="tabular">
                {partnerName} {signed(r.them, 1)}
              </span>
            </>
          )
        })()}
        <span className="text-faint max-sm:w-full">Tap a week to see its lineups below.</span>
      </div>
    </div>
  )
}

function TipBody({ row, partnerName }: { row: { week: number; you: number; them: number }; partnerName: string }) {
  return (
    <>
      <div className="font-semibold">Week {row.week}</div>
      <div className="tabular flex items-center gap-1.5">
        <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: YOU }} /> You {signed(row.you, 1)}
      </div>
      <div className="tabular flex items-center gap-1.5">
        <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: THEM }} /> {partnerName} {signed(row.them, 1)}
      </div>
    </>
  )
}
