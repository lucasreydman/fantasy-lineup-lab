import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BLEND_LABEL, type BlendPart, type BlendResult } from '../lib/blend'
import { newsVsTag, type Flag, type FlagLevel } from '../lib/flags'
import { getPlayerNews } from '../lib/sleeper'
import type { NewsItem, Player } from '../lib/types'
import type { RowAction } from './RowActions'
import { fmt, InjuryTag, PlayerAvatar, PosText, signed, Spinner } from './ui'

export const FLAG_STYLE: Record<FlagLevel, string> = {
  danger: 'bg-down/12 text-down ring-down/30',
  warn: 'bg-warn/12 text-warn ring-warn/30',
  info: 'bg-panel-3 text-muted ring-line',
}

export function TagNote({ signal }: { signal: 'cleared' | 'out' | null }) {
  if (!signal) return null
  return signal === 'cleared' ? (
    <p className="rounded-lg bg-up/10 px-2.5 py-1.5 text-[12px] text-up">
      Latest news says he's good to go. Sleeper's injury tag hasn't caught up yet.
    </p>
  ) : (
    <p className="rounded-lg bg-down/10 px-2.5 py-1.5 text-[12px] text-down">
      Latest news says he's out. Sleeper's injury tag hasn't caught up yet.
    </p>
  )
}

export function timeAgo(ms: number, now = Date.now()) {
  const m = Math.round((now - ms) / 60_000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function FlagChips({ flags, compact }: { flags: Flag[]; compact?: boolean }) {
  if (!flags.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <span key={f.label} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ${FLAG_STYLE[f.level]}`}>
          {f.label}
          {f.detail && !compact && <span className="font-normal opacity-85"> · {f.detail}</span>}
        </span>
      ))}
    </div>
  )
}

interface Props {
  id: string
  player: Player | undefined
  flags: Flag[]
  week: number
  opponent: string
  points: number
  blend: BlendResult | null
  actions?: RowAction[]
  onClose: () => void
}

/** A player's card: what's wrong (if anything), this week's projection, the latest news, and what you can do. */
export function PlayerSheet({ id, player, flags, week, opponent, points, blend, actions = [], onClose }: Props) {
  const [news, setNews] = useState<NewsItem[] | null>(null)
  const [newsError, setNewsError] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    getPlayerNews(id).then(
      (n) => live && setNews(n),
      () => live && setNewsError(true),
    )
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      live = false
      window.removeEventListener('keydown', onKey)
    }
  }, [id, onClose])

  const name = player ? `${player.first} ${player.last}`.trim() : `Player ${id}`
  const pos = player?.pos ?? ''
  const parts = blend ? (Object.entries(blend.contrib) as [BlendPart, number][]) : []

  // Portaled, and React events stopped at the root: rows open this, and React
  // bubbles through portals, so a tap here must never reach the row underneath.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      onTouchStart={(e) => e.stopPropagation()}
      onDragStart={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-in safe-bottom flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-panel ring-1 ring-line sm:rounded-3xl"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 pt-5 pb-4">
          <PlayerAvatar id={id} pos={pos} size={52} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[18px] font-semibold">
              <span className="truncate">{name}</span>
              <InjuryTag status={player?.injury ?? null} />
            </div>
            <div className="text-[12.5px] text-muted">
              <PosText pos={pos} /> {player?.team ?? 'FA'} · Week {week} {opponent}
            </div>
          </div>
          <div className="text-right">
            <div className="tabular text-[20px] font-semibold">{fmt(points)}</div>
            <div className="text-[11px] text-muted">proj pts</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 ml-1 flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-full text-muted transition hover:bg-panel-3 hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {flags.length > 0 && (
            <Block title="Status">
              <div className="space-y-2">
                <FlagChips flags={flags} />
                <TagNote signal={newsVsTag(player, news?.[0])} />
              </div>
            </Block>
          )}

          {parts.length > 0 && blend && (
            <Block title={`Week ${week} projection`}>
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-[12.5px]">
                <span className="text-muted">Sleeper</span>
                <span className="tabular text-right">{fmt(blend.sleeper)}</span>
                {parts.map(([k, v]) => (
                  <Row key={k} label={BLEND_LABEL[k]} value={signed(v)} tone={v > 0 ? 'text-up' : 'text-down'} />
                ))}
                <span className="border-t border-line pt-1 font-semibold">Lineup Lab</span>
                <span className="tabular border-t border-line pt-1 text-right font-semibold">{fmt(blend.points)}</span>
              </div>
            </Block>
          )}

          <Block title="Latest news">
            {!news && !newsError && <Spinner label="Loading news…" />}
            {newsError && <p className="text-[13px] text-faint">Couldn't load news right now.</p>}
            {news?.length === 0 && <p className="text-[13px] text-faint">No recent news.</p>}
            <div className="space-y-4">
              {news?.slice(0, 5).map((n, i) => (
                <article key={i} className="space-y-1">
                  <div className="text-[11px] text-faint">
                    {n.source} · {timeAgo(n.published)}
                  </div>
                  <h3 className="text-[14px] leading-snug font-semibold">{n.title}</h3>
                  {n.description && n.description !== n.title && <Clamp text={n.description} />}
                  {n.analysis && (
                    <>
                      {open === i ? (
                        <p className="rounded-lg bg-panel-2 px-3 py-2 text-[13px] leading-relaxed text-ink">{n.analysis}</p>
                      ) : (
                        <button type="button" onClick={() => setOpen(i)} className="text-[12px] font-semibold text-teal hover:underline">
                          Read the analysis
                        </button>
                      )}
                    </>
                  )}
                  {n.url && (
                    <a href={n.url} target="_blank" rel="noreferrer" className="block text-[12px] text-faint hover:text-ink">
                      Full story ↗
                    </a>
                  )}
                </article>
              ))}
            </div>
          </Block>
        </div>

        {actions.length > 0 && (
          <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 pt-3 pb-4 sm:flex-row sm:flex-wrap">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => {
                  a.onClick()
                  onClose()
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-semibold transition active:scale-[0.98] sm:flex-1 ${ACTION_TONE[a.tone ?? 'muted']}`}
              >
                {a.icon && <span className="flex w-4 justify-center text-[11px]">{a.icon}</span>}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

const ACTION_TONE = {
  muted: 'bg-panel-3 text-ink hover:bg-line',
  down: 'bg-down/12 text-down hover:bg-down/20',
  teal: 'bg-teal/15 text-teal hover:bg-teal/25',
  wr: 'bg-wr/15 text-wr hover:bg-wr/25',
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className={`tabular text-right ${tone}`}>{value}</span>
    </>
  )
}

/** Long blurbs fold to four lines with a "Read more". */
function Clamp({ text }: { text: string }) {
  const [more, setMore] = useState(false)
  const long = text.length > 260
  return (
    <div>
      <p className={`text-[13px] leading-relaxed text-muted ${long && !more ? 'line-clamp-4' : ''}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setMore((m) => !m)} className="text-[12px] font-semibold text-muted hover:text-ink">
          {more ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
