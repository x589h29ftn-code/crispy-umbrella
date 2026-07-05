import { useEffect, useRef, type RefObject } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'

export interface PanZoomTransform {
  x: number
  y: number
  k: number
}

export interface PanZoomHandle {
  viewportRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  zoomBy: (factor: number) => void
  zoomTo: (scale: number) => void
  /** Pans to an absolute translate-x, keeping the current y and scale (scrollbar drags). */
  panToX: (x: number) => void
}

export function usePanZoom(onTransformChange: (transform: PanZoomTransform) => void): PanZoomHandle {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const behaviorRef = useRef<ReturnType<typeof zoom<HTMLDivElement, unknown>> | null>(null)
  const transformRef = useRef<PanZoomTransform>({ x: 0, y: 0, k: 1 })

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.15, 5])
      .filter((event: Event) => {
        if (event.type === 'wheel') return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey
        if (event.type === 'dblclick') return false
        // Thumbnails and document headers have their own pointer-based drag;
        // panning should only start from empty canvas.
        const target = event.target as HTMLElement | null
        if (target?.closest('.page-thumb, .group-row__header, .dropdown-menu, button, input')) return false
        return !(event as MouseEvent).button
      })
      .on('zoom', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        const { x, y, k } = event.transform
        content.style.transform = `translate(${x}px, ${y}px) scale(${k})`
        transformRef.current = { x, y, k }
        onTransformChange({ x, y, k })
      })

    const selection = select(viewport)
    selection.call(behavior)
    behaviorRef.current = behavior

    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) return
      event.preventDefault()
      selection.call(behavior.translateBy, -event.deltaX, -event.deltaY)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      viewport.removeEventListener('wheel', onWheel)
      selection.on('.zoom', null)
    }
  }, [onTransformChange])

  const zoomBy = (factor: number): void => {
    const viewport = viewportRef.current
    const behavior = behaviorRef.current
    if (!viewport || !behavior) return
    select(viewport).call(behavior.scaleBy, factor)
  }

  const zoomTo = (scale: number): void => {
    const viewport = viewportRef.current
    const behavior = behaviorRef.current
    if (!viewport || !behavior) return
    select(viewport).call(behavior.transform, zoomIdentity.scale(scale))
  }

  const panToX = (x: number): void => {
    const viewport = viewportRef.current
    const behavior = behaviorRef.current
    if (!viewport || !behavior) return
    const { y, k } = transformRef.current
    select(viewport).call(behavior.transform, zoomIdentity.translate(x, y).scale(k))
  }

  return { viewportRef, contentRef, zoomBy, zoomTo, panToX }
}
