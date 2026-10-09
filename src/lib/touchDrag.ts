// Drag and drop that works on phones. Mouse uses native HTML5 drag; touch browsers
// mostly don't fire those events, so on touch a short press-and-hold lifts the row
// into a floating chip that follows the finger, and releasing over a team panel drops
// it there. A swipe that starts moving before the hold completes is left to scroll.

import { useEffect, useRef, useState, type DragEvent, type TouchEvent as ReactTouchEvent } from 'react'

const HOLD_MS = 260
const SLOP_PX = 10

const handlers = new Map<string, (data: string) => void>()
const listeners = new Set<(side: string | null) => void>()
let hovered: string | null = null
/** Ends the touch drag in progress, if any (only one finger drags at a time). */
let endActive: (() => void) | null = null

/** 'player' = a rostered player (moves between teams); 'add' = a waiver or IR pickup. */
const kindOf = (data: string) => (/^(fa|ir):/.test(data) ? 'add' : 'player')

function setDragging(on: boolean, source?: Element | null, data = '') {
  document.body.classList.toggle('dragging', on)
  document.body.dataset.dragKind = on ? kindOf(data) : ''
  document.querySelectorAll('.is-source').forEach((el) => el.classList.remove('is-source'))
  if (on && source) source.classList.add('is-source')
}

function setHovered(side: string | null) {
  if (side === hovered) return
  hovered = side
  listeners.forEach((l) => l(side))
}

function sideAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-side]')
  return el?.dataset.dropSide ?? null
}

function startTouchDrag(startX: number, startY: number, data: string, label: string, source: Element) {
  endActive?.()
  let active = false
  let ghost: HTMLElement | null = null

  let lastX = startX
  let lastY = startY
  let raf = 0

  const place = (x: number, y: number) => {
    if (ghost) ghost.style.transform = `translate(${x - 20}px, ${y - 46}px)`
  }
  // Near the top edge, or just above the drop dock, the page scrolls under the finger.
  const autoScroll = () => {
    const dock = document.querySelector('.drop-dock')?.getBoundingClientRect()
    const bottom = dock && dock.height > 0 ? dock.top : window.innerHeight
    const EDGE = 72
    const v = lastY < EDGE ? -(EDGE - lastY) : lastY > bottom - EDGE && lastY < bottom ? lastY - (bottom - EDGE) : 0
    if (v) {
      window.scrollBy(0, v * 0.35)
      setHovered(sideAt(lastX, lastY))
    }
    raf = requestAnimationFrame(autoScroll)
  }
  const end = () => {
    window.clearTimeout(timer)
    cancelAnimationFrame(raf)
    ghost?.remove()
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', end)
    setHovered(null)
    setDragging(false)
    if (endActive === end) endActive = null
  }
  const onMove = (e: TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    if (!active) {
      // Moved before the hold finished: it's a scroll, not a drag.
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > SLOP_PX) end()
      return
    }
    e.preventDefault() // keep the page still while dragging
    lastX = t.clientX
    lastY = t.clientY
    place(t.clientX, t.clientY)
    setHovered(sideAt(t.clientX, t.clientY))
  }
  const onEnd = (e: TouchEvent) => {
    if (active) {
      e.preventDefault()
      const t = e.changedTouches[0]
      const side = t ? sideAt(t.clientX, t.clientY) : null
      if (side) handlers.get(side)?.(data)
    }
    end()
  }
  const timer = window.setTimeout(() => {
    active = true
    ghost = document.createElement('div')
    ghost.className = 'touch-ghost'
    ghost.textContent = label
    document.body.appendChild(ghost)
    place(startX, startY)
    setDragging(true, source, data)
    navigator.vibrate?.(12)
    raf = requestAnimationFrame(autoScroll)
  }, HOLD_MS)

  // Non-passive so the drag can stop the page from scrolling once it starts.
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd, { passive: false })
  document.addEventListener('touchcancel', end)
  endActive = end
}

/** Props that make an element draggable by mouse and by touch. */
export function useDraggable(data: string, label: string, enabled = true) {
  if (!enabled) return {}
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', data)
      e.dataTransfer.effectAllowed = 'move'
      const el = e.currentTarget
      // Next frame, so the browser snapshots the row before it dims.
      requestAnimationFrame(() => setDragging(true, el, data))
    },
    onDragEnd: () => setDragging(false),
    onTouchStart: (e: ReactTouchEvent) => {
      if (e.touches.length !== 1 || (e.target as HTMLElement).closest('button, a, input, select')) return
      startTouchDrag(e.touches[0].clientX, e.touches[0].clientY, data, label, e.currentTarget)
    },
    // A long press would otherwise open the browser's context menu.
    onContextMenu: (e: { preventDefault: () => void }) => {
      if (endActive) e.preventDefault()
    },
  }
}

/** A panel that accepts drops from mouse and touch drags. */
export function useDropTarget(side: string, labels: { move: string; add: string }, onDrop: (data: string) => void) {
  const [nativeOver, setNativeOver] = useState(false)
  const [touchOver, setTouchOver] = useState(false)
  const cb = useRef(onDrop)
  useEffect(() => {
    cb.current = onDrop
  })

  useEffect(() => {
    handlers.set(side, (d) => cb.current(d))
    const l = (s: string | null) => setTouchOver(s === side)
    listeners.add(l)
    return () => {
      handlers.delete(side)
      listeners.delete(l)
    }
  }, [side])

  return {
    over: nativeOver || touchOver,
    bind: {
      'data-drop-side': side,
      'data-drop-label': labels.move,
      'data-add-label': labels.add,
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setNativeOver(true)
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setNativeOver(false)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setNativeOver(false)
        setDragging(false)
        const data = e.dataTransfer.getData('text/plain')
        if (data) cb.current(data)
      },
    },
  }
}

/**
 * A secondary target for an existing side (the phone drop dock): routes mouse and
 * touch drops to whatever that side's panel registered, and reports hover.
 */
export function useDockTarget(side: string) {
  const [nativeOver, setNativeOver] = useState(false)
  const [touchOver, setTouchOver] = useState(false)
  useEffect(() => {
    const l = (s: string | null) => setTouchOver(s === side)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [side])
  return {
    over: nativeOver || touchOver,
    bind: {
      'data-drop-side': side,
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        setNativeOver(true)
      },
      onDragLeave: () => setNativeOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setNativeOver(false)
        setDragging(false)
        const data = e.dataTransfer.getData('text/plain')
        if (data) handlers.get(side)?.(data)
      },
    },
  }
}
