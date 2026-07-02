import { useEffect, useRef, type RefObject } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'

export interface PanZoomHandle {
  viewportRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
  zoomBy: (factor: number) => void
  zoomTo: (scale: number) => void
}

export function usePanZoom(onScaleChange: (scale: number) => void): PanZoomHandle {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const behaviorRef = useRef<ReturnType<typeof zoom<HTMLDivElement, unknown>> | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.15, 3])
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
        onScaleChange(k)
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
  }, [onScaleChange])

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

  return { viewportRef, contentRef, zoomBy, zoomTo }
}
