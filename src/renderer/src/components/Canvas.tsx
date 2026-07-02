import { useEffect, useMemo, useRef, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStudioStore } from '../store'
import { usePanZoom, type PanZoomTransform } from '../hooks/usePanZoom'
import { mergeRefs } from '../lib/mergeRefs'
import GroupRow from './GroupRow'
import AddTile from './AddTile'
import EmptyState from './EmptyState'

interface Props {
  onScaleChange: (scale: number) => void
  registerZoomControls: (controls: { zoomBy: (f: number) => void; zoomTo: (s: number) => void }) => void
}

/** Layout offset of .canvas-content inside the viewport (top/left, in px). */
const CONTENT_MARGIN = 40

export default function Canvas({ onScaleChange, registerZoomControls }: Props): JSX.Element {
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const importFiles = useStudioStore((s) => s.importFiles)
  const canvasDropActive = useStudioStore((s) => s.dropTarget?.type === 'canvas')
  const [scalePct, setScalePct] = useState(100)
  const [transform, setTransform] = useState<PanZoomTransform>({ x: 0, y: 0, k: 1 })
  const [sizes, setSizes] = useState({ viewportW: 0, contentW: 0 })

  const handleTransformChange = useMemo(
    () => (t: PanZoomTransform) => {
      setTransform(t)
      setScalePct(Math.round(t.k * 100))
      useStudioStore.getState().setCanvasScale(t.k)
      onScaleChange(t.k)
    },
    [onScaleChange]
  )

  const { viewportRef, contentRef, zoomBy, zoomTo, panToX } = usePanZoom(handleTransformChange)
  const [animateRef] = useAutoAnimate<HTMLDivElement>({ duration: 180, easing: 'ease-out' })
  const contentNodeRef = useMemo(() => mergeRefs(contentRef, animateRef), [contentRef, animateRef])

  useEffect(() => {
    registerZoomControls({ zoomBy, zoomTo })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const measure = (): void =>
      setSizes({ viewportW: viewport.clientWidth, contentW: content.offsetWidth })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Horizontal scrollbar: appears when the (zoomed) content is wider than the
  // viewport, mirroring the pan-x of the d3-zoom transform.
  const scaledWidth = sizes.contentW * transform.k + 2 * CONTENT_MARGIN
  const showHScroll = sizes.viewportW > 0 && scaledWidth > sizes.viewportW + 1
  const panRange = sizes.viewportW - scaledWidth // < 0 when scrollable; x pans from 0 down to panRange
  const scrollPos = showHScroll ? Math.min(1, Math.max(0, transform.x / panRange)) : 0
  const thumbFrac = showHScroll ? Math.max(0.06, sizes.viewportW / scaledWidth) : 1

  const trackRef = useRef<HTMLDivElement>(null)
  const thumbDragRef = useRef<{ startClientX: number; startPos: number } | null>(null)

  function thumbTravel(): number {
    const track = trackRef.current
    if (!track) return 1
    return Math.max(1, track.clientWidth * (1 - thumbFrac))
  }

  async function pickAndAddDocuments(): Promise<void> {
    const files = await window.api.openPdfs()
    if (files.length) await importFiles(files)
  }

  async function addDroppedDocuments(fileList: FileList): Promise<void> {
    const files = await Promise.all(
      Array.from(fileList)
        .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
        .map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))
    )
    if (files.length) await importFiles(files)
  }

  return (
    <div
      className={`canvas-viewport${canvasDropActive ? ' canvas-viewport--drop' : ''}`}
      ref={viewportRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        void addDroppedDocuments(e.dataTransfer.files)
      }}
    >
      <div className="canvas-content" ref={contentNodeRef}>
        {groups.map((group, i) => (
          <GroupRow
            key={group.id}
            group={group}
            index={i}
            isLast={i === groups.length - 1}
            sources={sources}
            isActive={group.id === activeGroupId}
          />
        ))}
        {groups.length > 0 && (
          <AddTile
            label="Document toevoegen"
            compact
            onClick={() => void pickAndAddDocuments()}
            onFilesDropped={addDroppedDocuments}
          />
        )}
      </div>

      {groups.length === 0 && (
        <EmptyState onBrowse={() => void pickAndAddDocuments()} onFilesDropped={addDroppedDocuments} />
      )}

      {showHScroll && (
        <div
          className="canvas-scrollbar"
          ref={trackRef}
          onPointerDown={(e) => {
            // Clicking the track (not the thumb) jumps so the thumb centers on the click.
            if ((e.target as HTMLElement).closest('.canvas-scrollbar__thumb')) return
            const track = trackRef.current
            if (!track) return
            const rect = track.getBoundingClientRect()
            const pos = Math.min(
              1,
              Math.max(0, (e.clientX - rect.left - (thumbFrac * rect.width) / 2) / thumbTravel())
            )
            panToX(pos * panRange)
          }}
        >
          <div
            className="canvas-scrollbar__thumb"
            style={{ width: `${thumbFrac * 100}%`, left: `${scrollPos * (1 - thumbFrac) * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              thumbDragRef.current = { startClientX: e.clientX, startPos: scrollPos }
            }}
            onPointerMove={(e) => {
              const drag = thumbDragRef.current
              if (!drag) return
              const pos = Math.min(
                1,
                Math.max(0, drag.startPos + (e.clientX - drag.startClientX) / thumbTravel())
              )
              panToX(pos * panRange)
            }}
            onPointerUp={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
              thumbDragRef.current = null
            }}
          />
        </div>
      )}

      {Math.abs(scalePct - 100) > 1 && (
        <button
          type="button"
          className={`zoom-reset-btn${showHScroll ? ' zoom-reset-btn--lifted' : ''}`}
          onClick={() => zoomTo(1)}
          title="Terug naar origineel formaat"
        >
          {scalePct}% · Origineel
        </button>
      )}
    </div>
  )
}
