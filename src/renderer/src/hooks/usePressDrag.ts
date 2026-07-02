import { useRef } from 'react'

const DRAG_THRESHOLD_PX = 6

interface PressDragOptions {
  /** Called once when the pointer moves past the threshold. Return false to abort the drag. */
  onStart: (e: React.PointerEvent<HTMLElement>) => boolean | void
  onMove: (x: number, y: number) => void
  onEnd: () => void
  onCancel: () => void
  /** Elements that should never start a drag (buttons inside the draggable, etc.). */
  ignoreSelector?: string
}

interface PressDragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
}

/**
 * Press-and-hold dragging on plain pointer events: a click stays a click
 * until the pointer travels past a small threshold, then the drag callbacks
 * take over. Pointer capture keeps the gesture alive even when the cursor
 * leaves the element or the window.
 */
export function usePressDrag(opts: PressDragOptions): PressDragHandlers {
  const gesture = useRef({ pressed: false, dragging: false, startX: 0, startY: 0 })

  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      if (opts.ignoreSelector && (e.target as HTMLElement).closest(opts.ignoreSelector)) return
      gesture.current = { pressed: true, dragging: false, startX: e.clientX, startY: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => {
      const g = gesture.current
      if (!g.pressed) return
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD_PX) return
        if (opts.onStart(e) === false) {
          g.pressed = false
          return
        }
        g.dragging = true
      }
      opts.onMove(e.clientX, e.clientY)
    },
    onPointerUp: (e) => {
      const g = gesture.current
      if (g.dragging) opts.onEnd()
      g.pressed = false
      g.dragging = false
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    },
    onPointerCancel: (e) => {
      const g = gesture.current
      if (g.dragging) opts.onCancel()
      g.pressed = false
      g.dragging = false
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
}
