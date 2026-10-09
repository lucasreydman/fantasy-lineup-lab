import { useEffect, useState } from 'react'
import { newsVsTag, type Flag } from '../lib/flags'
import { getPlayerNews } from '../lib/sleeper'
import type { NewsItem, Player } from '../lib/types'
import { FlagChips, TagNote, timeAgo } from './PlayerSheet'
import { PlayerAvatar, PosText } from './ui'

interface Incoming {
  id: string
  /** How he's arriving: in the trade, or a pickup / IR move the roster needs */
  via: 'trade' | 'pickup' | 'ir'
}

interface Props {
  incoming: Incoming[]
  players: Map<string, Player>
  flagsFor: (id: string) => Flag[]
  onOpen: (id: string) => void
}

const VIA: Record<Incoming['via'], string> = { trade: 'in the trade', pickup: 'waiver pickup', ir: 'off IR' }

/**
 * Before you send it: every player coming to your roster with an injury, a practice
 * report, a status problem, a bye or fresh news is spelled out here with his latest
 * headline, so nothing slips through.
 */
export function TradeAlerts({ incoming, players, flagsFor, onOpen }: Props) {
  // A real problem or fresh news puts a player here; once here, he shows every flag
  // (an upcoming bye alone isn't worth an alert, but it's worth seeing next to an injury).
  const flagged = incoming
    .map((p) => ({ ...p, flags: flagsFor(p.id) }))
    .filter((p) => p.flags.some((f) => f.level !== 'info' || f.label.startsWith('News in')))
  const ids = flagged.map((p) => p.id).join(',')

  const [headlines, setHeadlines] = useState<Record<string, NewsItem | null>>({})
  useEffect(() => {
    let live = true
    for (const id of ids ? ids.split(',') : []) {
      getPlayerNews(id).then(
        (n) => live && setHeadlines((h) => ({ ...h, [id]: n[0] ?? null })),
        () => live && setHeadlines((h) => ({ ...h, [id]: null })),
      )
    }
    return () => {
      live = false
    }
  }, [ids])

  if (!incoming.some((p) => p.via === 'trade')) return null
  if (!flagged.length)
    return (
      <div className="flex items-center gap-2 rounded-xl bg-up/8 px-4 py-2.5 text-[12.5px] text-muted ring-1 ring-up/20">
        <span className="text-up">✓</span> No injury, status or news flags on the players coming to you.
      </div>
    )

  const serious = flagged.some((p) => p.flags.some((f) => f.level === 'danger'))
  return (
    <div
      className={`pop-in rounded-2xl p-4 ring-1 ${serious ? 'bg-down/8 ring-down/35' : 'bg-warn/8 ring-warn/35'}`}
      role="alert"
    >
      <div className={`mb-3 flex items-center gap-2 text-[13px] font-semibold ${serious ? 'text-down' : 'text-warn'}`}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <path d="M8 1.8l6.5 11.6H1.5z" />
          <path d="M8 6.3v3.2M8 11.6v.1" strokeLinecap="round" />
        </svg>
        Heads up: {flagged.length === 1 ? 'a player' : `${flagged.length} players`} coming to you
        {flagged.length === 1 ? ' has' : ' have'} something to check
      </div>
      <div className="space-y-3">
        {flagged.map(({ id, via, flags }) => {
          const p = players.get(id)
          const news = headlines[id]
          return (
            <div key={id} className="flex gap-3 rounded-xl bg-panel/70 p-3">
              <PlayerAvatar id={id} pos={p?.pos ?? ''} size={40} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[14px] font-semibold">{p ? `${p.first} ${p.last}` : id}</span>
                  <span className="text-[11.5px] text-muted">
                    <PosText pos={p?.pos ?? ''} /> {p?.team ?? 'FA'} · {VIA[via]}
                  </span>
                </div>
                <FlagChips flags={flags} />
                <TagNote signal={newsVsTag(p, news)} />
                {news === undefined && <div className="h-4 w-48 animate-pulse rounded bg-panel-3" />}
                {news && (
                  <p className="text-[12.5px] leading-snug text-muted">
                    <span className="text-ink">{news.title}</span>
                    <span className="text-faint">
                      {' '}
                      · {news.source}, {timeAgo(news.published)}
                    </span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpen(id)}
                className="shrink-0 self-start rounded-full bg-panel-3 px-3 py-1.5 text-[12px] font-semibold text-ink ring-1 ring-line transition hover:bg-line active:scale-95"
              >
                News & details
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
