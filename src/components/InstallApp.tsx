import { useEffect, useState, type ReactNode } from 'react'
import { LogoMark } from './LogoMark'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Platform = 'ios' | 'android' | 'desktop'

function detect(): Platform {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

// Chromium fires this once, early; keep it so the button can use it whenever it's tapped.
let deferred: InstallPromptEvent | null = null
const subs = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    subs.forEach((s) => s())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    subs.forEach((s) => s())
  })
}

export function useInstall() {
  const [, bump] = useState(0)
  useEffect(() => {
    const s = () => bump((n) => n + 1)
    subs.add(s)
    return () => {
      subs.delete(s)
    }
  }, [])
  return {
    installed: isStandalone(),
    platform: detect(),
    canPrompt: !!deferred,
    prompt: async () => {
      if (!deferred) return false
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      deferred = null
      subs.forEach((s) => s())
      return outcome === 'accepted'
    },
  }
}

export function InstallButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-teal/15 px-3 py-1.5 text-[12px] font-semibold text-teal transition hover:bg-teal/25 active:scale-95"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="1.5" width="8" height="13" rx="2" />
        <path d="M8 5v5M6 8l2 2 2-2" />
      </svg>
      <span className="hidden sm:inline">Get the app</span>
      <span className="sm:hidden">App</span>
    </button>
  )
}

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5">
    <path d="M8 10V1.5M5 4.5l3-3 3 3M3.5 7.5v6h9v-6" />
  </svg>
)
const PlusSquare = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="inline -mt-0.5">
    <rect x="2" y="2" width="12" height="12" rx="3" />
    <path d="M8 5v6M5 8h6" />
  </svg>
)
const Dots = () => <span className="font-bold tracking-tighter">⋮</span>

const STEPS: Record<Platform, { label: string; steps: ReactNode[] }> = {
  ios: {
    label: 'iPhone & iPad',
    steps: [
      <>Open this page in Safari (or Chrome) on your iPhone.</>,
      <>
        Tap the Share button <ShareIcon /> in the toolbar.
      </>,
      <>
        Scroll down and tap <b>Add to Home Screen</b> <PlusSquare />.
      </>,
      <>
        Tap <b>Add</b>. Lineup Lab opens full-screen from your home screen, like any other app.
      </>,
    ],
  },
  android: {
    label: 'Android',
    steps: [
      <>Open this page in Chrome.</>,
      <>
        Tap the menu <Dots /> in the top-right corner.
      </>,
      <>
        Tap <b>Install app</b> (or <b>Add to Home screen</b>).
      </>,
      <>Confirm. It shows up in your app drawer and opens full-screen.</>,
    ],
  },
  desktop: {
    label: 'Computer',
    steps: [
      <>In Chrome or Edge, click the install icon at the right end of the address bar.</>,
      <>
        Or open the browser menu and choose <b>Install Lineup Lab</b>.
      </>,
      <>It gets its own window and a dock / taskbar icon.</>,
    ],
  },
}

export function InstallSheet({ onClose }: { onClose: () => void }) {
  const install = useInstall()
  const [tab, setTab] = useState<Platform>(install.platform)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-panel ring-1 ring-line sm:rounded-3xl"
      >
        <div className="flex items-center gap-4 px-6 pt-6">
          <LogoMark size={56} />
          <div>
            <h2 id="install-title" className="text-[20px] font-bold tracking-tight">
              Install Lineup Lab
            </h2>
            <p className="text-[13px] text-muted">Free, no app store. Opens full-screen like any app.</p>
          </div>
        </div>

        {install.canPrompt && (
          <div className="px-6 pt-5">
            <button
              type="button"
              onClick={async () => {
                if (await install.prompt()) onClose()
              }}
              className="w-full rounded-xl bg-teal px-4 py-3.5 text-[15px] font-semibold text-bg transition hover:brightness-110 active:scale-[0.98]"
            >
              Install Lineup Lab
            </button>
          </div>
        )}

        <div className="mx-6 mt-5 flex rounded-full bg-panel-2 p-1 ring-1 ring-line">
          {(Object.keys(STEPS) as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setTab(p)}
              className={`flex-1 rounded-full px-2 py-1.5 text-[12px] font-semibold transition ${
                tab === p ? 'bg-panel-3 text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {STEPS[p].label}
            </button>
          ))}
        </div>

        <ol className="space-y-3 px-6 py-5">
          {STEPS[tab].steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal/15 text-[12px] font-bold text-teal">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-panel-3 px-4 py-3 text-[14px] font-semibold transition hover:bg-line active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
