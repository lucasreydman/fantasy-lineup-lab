import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface RowAction {
  key: string
  /** Full label: the button text on phones, the tooltip on desktop icon buttons. */
  label: string
  /** Desktop shows this compact icon instead of the label when given. */
  icon?: ReactNode
  tone?: 'muted' | 'down' | 'teal' | 'wr'
  /** A lone primary action stays inline on phones too (e.g. Add). */
  primary?: boolean
  onClick: () => void
}

const TONE = {
  muted: { icon: 'hover:bg-panel-3 hover:text-ink', text: 'bg-panel-3 text-ink hover:bg-line', sheet: 'bg-panel-3 text-ink' },
  down: { icon: 'hover:bg-down/15 hover:text-down', text: 'bg-down/10 text-down hover:bg-down/20', sheet: 'bg-down/12 text-down' },
  teal: { icon: 'hover:bg-teal/15 hover:text-teal', text: 'bg-teal/15 text-teal hover:bg-teal/25', sheet: 'bg-teal/15 text-teal' },
  wr: { icon: 'hover:bg-wr/15 hover:text-wr', text: 'bg-wr/15 text-wr hover:bg-wr/25', sheet: 'bg-wr/15 text-wr' },
}

/** On phones a lone primary action stays inline; everything else lives behind ⋯. */
export const inlineOnPhone = (actions: RowAction[]) => actions.length === 1 && !!actions[0].primary

export function RowActionsInline({ actions, onMore }: { actions: RowAction[]; onMore: () => void }) {
  if (!actions.length) return null
  return (
    <>
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {actions.map((a) =>
          a.icon ? (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              title={a.label}
              aria-label={a.label}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-muted ring-1 ring-line/70 transition active:scale-90 focus-visible:outline-2 focus-visible:outline-teal ${TONE[a.tone ?? 'muted'].icon}`}
            >
              {a.icon}
            </button>
          ) : (
            <TextButton key={a.key} action={a} />
          ),
        )}
      </div>
      <div className="flex shrink-0 sm:hidden">
        {inlineOnPhone(actions) ? (
          <TextButton action={actions[0]} />
        ) : (
          <button
            type="button"
            onClick={onMore}
            aria-label="Player actions"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted ring-1 ring-line/70 transition active:scale-90 active:bg-panel-3"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          </button>
        )}
      </div>
    </>
  )
}

function TextButton({ action: a }: { action: RowAction }) {
  return (
    <button
      type="button"
      onClick={a.onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition active:scale-95 focus-visible:outline-2 focus-visible:outline-teal ${TONE[a.tone ?? 'muted'].text}`}
    >
      {a.label}
    </button>
  )
}

/** Bottom sheet with a player's actions, sized for thumbs. */
export function ActionSheet({
  title, subtitle, actions, onClose,
}: { title: string; subtitle?: ReactNode; actions: RowAction[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portaled out of the row's DOM, and React events stopped here too: React bubbles
  // through portals, so a tap or hold would otherwise reach the row (reopen / start a drag).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/55 backdrop-blur-[2px]"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      onTouchStart={(e) => e.stopPropagation()}
      onDragStart={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
    >
      <div onClick={(e) => e.stopPropagation()} className="sheet-in safe-bottom w-full rounded-t-3xl bg-panel px-4 pt-3 pb-4 ring-1 ring-line">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="px-1 pb-3">
          <div className="text-[16px] font-semibold">{title}</div>
          {subtitle && <div className="text-[12.5px] text-muted">{subtitle}</div>}
        </div>
        <div className="space-y-2">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                a.onClick()
                onClose()
              }}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-[15px] font-semibold transition active:scale-[0.98] ${TONE[a.tone ?? 'muted'].sheet}`}
            >
              {a.icon && <span className="flex w-5 justify-center text-[12px]">{a.icon}</span>}
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold text-muted transition active:scale-[0.98]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
