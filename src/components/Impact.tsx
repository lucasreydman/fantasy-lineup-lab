import type { TeamEval } from '../lib/trade'
import { Delta, fmt1, signed, TeamAvatar } from './ui'

export interface Horizon {
  start: number
  end: number
}

interface PickerProps {
  current: number
  lastWeek: number
  regSeasonEnd: number
  value: Horizon
  onChange: (h: Horizon) => void
}

export function HorizonPicker({ current, lastWeek, regSeasonEnd, value, onChange }: PickerProps) {
  const presets: { label: string; h: Horizon }[] = [
    { label: 'This week', h: { start: current, end: current } },
    { label: 'Next 3', h: { start: current, end: Math.min(lastWeek, current + 2) } },
    { label: 'Rest of reg. season', h: { start: current, end: Math.max(current, regSeasonEnd) } },
    { label: 'Rest of season', h: { start: current, end: Math.max(current, Math.min(lastWeek, 17)) } },
  ].filter((p, i, all) => all.findIndex((q) => q.h.start === p.h.start && q.h.end === p.h.end) === i)
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1)
  const select = 'rounded-lg bg-panel-3 px-2 py-1.5 text-[12px] font-medium outline-none ring-1 ring-line focus:ring-teal'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap rounded-full bg-panel-2 p-1 ring-1 ring-line">
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
      {n > 1 && <WeekBars me={me.ev} partner={partner.ev} week={week} onWeek={onWeek} />}
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

function WeekBars({ me, partner, week, onWeek }: { me: TeamEval; partner: TeamEval; week: number; onWeek: (w: number) => void }) {
  const deltas = me.weeks.map((w, i) => ({
    week: w.week,
    me: w.after.total - w.before.total,
    them: partner.weeks[i].after.total - partner.weeks[i].before.total,
  }))
  const max = Math.max(1, ...deltas.flatMap((d) => [Math.abs(d.me), Math.abs(d.them)]))
  const H = 34
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center gap-4 text-[11px] text-muted">
        <span>Weekly lineup change — tap a week to see its lineups</span>
        <span className="ml-auto flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm bg-teal" /> You
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm bg-muted" /> Partner
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {deltas.map((d) => {
          const active = d.week === week
          return (
            <button
              key={d.week}
              type="button"
              onClick={() => onWeek(d.week)}
              title={`Week ${d.week}: you ${signed(d.me)}, partner ${signed(d.them)}`}
              className={`flex min-w-11 max-w-24 flex-1 flex-col items-center rounded-lg px-1 pt-1 pb-1.5 transition ${
                active ? 'bg-panel-3 ring-1 ring-teal' : 'hover:bg-panel-2'
              }`}
            >
              <div className="relative w-full" style={{ height: H * 2 }}>
                <div className="absolute top-1/2 right-0 left-0 h-px bg-line" />
                {[d.me, d.them].map((v, i) => {
                  const h = (Math.abs(v) / max) * H
                  return (
                    <div
                      key={i}
                      className="absolute w-[34%] rounded-sm transition-all"
                      style={{
                        left: i === 0 ? '12%' : '54%',
                        height: Math.max(h, 1.5),
                        top: v >= 0 ? H - h : H,
                        background: i === 0 ? (v < 0 ? 'var(--color-down)' : 'var(--color-teal)') : 'var(--color-muted)',
                        opacity: i === 0 ? 1 : 0.55,
                      }}
                    />
                  )
                })}
              </div>
              <span className={`tabular text-[10.5px] ${active ? 'font-semibold text-ink' : 'text-muted'}`}>W{d.week}</span>
              <span className={`tabular text-[10px] ${d.me > 0.004 ? 'text-up' : d.me < -0.004 ? 'text-down' : 'text-faint'}`}>
                {signed(d.me, 1)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
