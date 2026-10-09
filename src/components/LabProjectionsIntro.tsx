import { useEffect, type ReactNode } from 'react'
import type { BlendCtx } from '../lib/blend'

const FOREVER = 'lineuplab:introHidden'
const SESSION = 'lineuplab:introSeen'

/** First switch to Lineup Lab projections explains them, unless hidden for this session or for good. */
export function shouldShowIntro(): boolean {
  try {
    return !localStorage.getItem(FOREVER) && !sessionStorage.getItem(SESSION)
  } catch {
    return true
  }
}

function remember(forever: boolean) {
  try {
    sessionStorage.setItem(SESSION, '1')
    if (forever) localStorage.setItem(FOREVER, '1')
  } catch {
    /* private mode: it'll just show again */
  }
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Sportsbooks lead',
    body: 'Player props from Pinnacle (the sharpest book) and Underdog: passing, rushing and receiving yards, receptions, attempts, anytime TD. Real money moves these lines, so wherever a book has a price, it carries 70–85% of the weight on that stat.',
  },
  {
    title: 'Sleeper + ESPN fill the gaps',
    body: 'Books only price some stats for some players, and only this week. Everything else (bench and waiver players, kickers, defenses, fumbles, bonuses, future weeks) comes from Sleeper’s and ESPN’s projections averaged, so neither site alone decides it.',
  },
  {
    title: 'Game script',
    body: "Each team's implied point total and the spread, applied to the stats the books didn't price. A team expected to score 30 gets more touchdowns than one expected to score 17; big favorites run more, big underdogs throw more.",
  },
  {
    title: 'Matchup',
    body: 'How many fantasy points each defense allows to the position, scored with your league’s settings and weighted by how much that actually predicts (it’s noisy, so the effect is capped at ±10%).',
  },
  {
    title: 'Health',
    body: 'Out and IR players go to zero. Questionable players are discounted by practice reports: did not practice 0.6×, limited 0.85×, full 1×.',
  },
]

export function LabProjectionsIntro({ ctx, onClose }: { ctx: BlendCtx | null; onClose: () => void }) {
  const close = (forever: boolean) => {
    remember(forever)
    onClose()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => close(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lab-intro-title"
    >
      {/* Buttons sit outside the scroll area: on a phone the explanation scrolls, and the
          live counts loading in must never shift the buttons under a thumb. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in safe-bottom flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-panel ring-1 ring-line sm:rounded-3xl"
      >
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="px-6 pt-6 pb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-wr">Projections</div>
          <h2 id="lab-intro-title" className="mt-1 text-[22px] font-bold tracking-tight">
            What are Lineup Lab projections?
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            What the betting market expects, with projections filling in what it doesn't price. Every number is scored
            with your league's exact settings.
          </p>
        </div>
        <ol className="space-y-3 px-6 py-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wr/15 text-[12px] font-bold text-wr">
                {i + 1}
              </span>
              <div>
                <div className="text-[14px] font-semibold">{s.title}</div>
                <div className="text-[13px] leading-relaxed text-muted">{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mx-6 rounded-xl bg-panel-2 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
          {ctx ? (
            <>
              Right now: <span className="font-semibold text-ink">{ctx.stats.propsMatched}</span> player props,{' '}
              <span className="font-semibold text-ink">{ctx.stats.games}</span> game lines and{' '}
              <span className="font-semibold text-ink">{ctx.stats.espnMatched}</span> ESPN projections for Week {ctx.week}.
            </>
          ) : (
            'Loading this week’s props and lines…'
          )}{' '}
          Books only price the current week, so later weeks use Sleeper's projection adjusted for matchup. Tap a
          player's points to see how each step moved them; the small number underneath is Sleeper's.
        </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-t border-line px-6 pt-4 pb-5 sm:flex-row-reverse">
          <button
            type="button"
            autoFocus
            onClick={() => close(false)}
            className="flex-1 rounded-xl bg-wr px-4 py-3 text-[14px] font-semibold text-bg transition hover:brightness-110 active:scale-[0.98]"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className="flex-1 rounded-xl bg-panel-3 px-4 py-3 text-[14px] font-semibold text-ink transition hover:bg-line active:scale-[0.98]"
          >
            Got it, don't show again
          </button>
        </div>
      </div>
    </div>
  )
}
