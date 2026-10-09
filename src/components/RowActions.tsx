import type { ReactNode } from 'react'

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
