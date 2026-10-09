import { useEffect, useMemo, useRef, useState } from 'react'
import type { Player } from '../lib/types'
import { PlayerAvatar, PosText } from './ui'

interface SideProps {
  title: string
  subtitle: string
  selected: string[]
  pool: string[]
  players: Map<string, Player>
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

function TradeSide({ title, subtitle, selected, pool, players, onAdd, onRemove }: SideProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return pool
      .filter((id) => !selected.includes(id))
      .map((id) => ({ id, p: players.get(id) }))
      .filter(({ p, id }) => !needle || `${p?.first} ${p?.last} ${p?.team} ${p?.pos}`.toLowerCase().includes(needle) || id === needle)
      .sort((a, b) => {
        const pa = POS_ORDER.indexOf(a.p?.pos ?? '')
        const pb = POS_ORDER.indexOf(b.p?.pos ?? '')
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || (a.p?.last ?? '').localeCompare(b.p?.last ?? '')
      })
  }, [pool, selected, players, q])

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</span>
        <span className="truncate text-[11px] text-faint">{subtitle}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((id) => {
          const p = players.get(id)
          return (
            <span key={id} className="pop-in flex items-center gap-2 rounded-full bg-panel-3 py-1 pr-1 pl-1 text-[13px]">
              <PlayerAvatar id={id} pos={p?.pos ?? ''} size={24} />
              <span className="font-medium">{p ? `${p.first.slice(0, 1)}. ${p.last}` : id}</span>
              <PosText pos={p?.pos ?? ''} />
              <button
                type="button"
                onClick={() => onRemove(id)}
                aria-label="Remove"
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink"
              >
                ×
              </button>
            </span>
          )
        })}
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-[13px] text-muted transition hover:border-teal hover:text-teal"
          >
            <span className="text-base leading-none">+</span> Add player
          </button>
          {open && (
            <div className="pop-in absolute top-10 left-0 z-30 w-72 overflow-hidden rounded-xl bg-panel-2 shadow-2xl ring-1 ring-line">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search roster…"
                className="w-full border-b border-line bg-transparent px-3 py-2.5 text-[13px] outline-none placeholder:text-faint"
              />
              <div className="max-h-72 overflow-y-auto">
                {options.length === 0 && <div className="px-3 py-3 text-[12px] text-faint">No players</div>}
                {options.map(({ id, p }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onAdd(id)
                      setQ('')
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-panel-3"
                  >
                    <PlayerAvatar id={id} pos={p?.pos ?? ''} size={26} />
                    <span className="flex-1 truncate">{p ? `${p.first} ${p.last}` : id}</span>
                    <span className="text-[11px]">
                      <PosText pos={p?.pos ?? ''} /> <span className="text-muted">{p?.team ?? 'FA'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface Props {
  myName: string
  partnerName: string
  myPool: string[]
  partnerPool: string[]
  send: string[]
  receive: string[]
  players: Map<string, Player>
  onSend: (id: string, add: boolean) => void
  onReceive: (id: string, add: boolean) => void
  /** Anything to undo: a trade, or any drop / IR / pickup / keep on either team. */
  dirty: boolean
  onReset: () => void
}

export function TradeBar(props: Props) {
  const empty = props.send.length === 0 && props.receive.length === 0
  return (
    <div className="relative rounded-2xl bg-panel p-4 ring-1 ring-line">
      <ResetButton disabled={!props.dirty} onClick={props.onReset} />
      <div className="flex flex-col gap-4 pr-24 md:flex-row md:items-start md:pr-28">
        <TradeSide
          title="You send"
          subtitle={`to ${props.partnerName}`}
          selected={props.send}
          pool={props.myPool}
          players={props.players}
          onAdd={(id) => props.onSend(id, true)}
          onRemove={(id) => props.onSend(id, false)}
        />
        <div className="hidden h-14 w-px bg-line md:block" />
        <TradeSide
          title="You receive"
          subtitle={`from ${props.partnerName}`}
          selected={props.receive}
          pool={props.partnerPool}
          players={props.players}
          onAdd={(id) => props.onReceive(id, true)}
          onRemove={(id) => props.onReceive(id, false)}
        />
      </div>
      {empty && (
        <p className="mt-3 text-[12px] text-faint">
          Drag players between the two rosters below (press and hold on a phone), tap a player for options, or add them
          here.
        </p>
      )}
    </div>
  )
}

function ResetButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Nothing to reset yet' : 'Send every player back to their team and undo all moves'}
      className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-panel-3 px-3 py-1.5 text-[12px] font-semibold text-ink ring-1 ring-line transition hover:bg-line active:scale-95 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-faint disabled:active:scale-100"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
        <path d="M2.5 2.5v3h3" />
      </svg>
      Reset
    </button>
  )
}
