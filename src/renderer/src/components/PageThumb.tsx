import { useEffect, useState } from 'react'
import {
  getPageVisualSize,
  getPlacementVisualBox,
  renderThumbnail,
  textAnnotationBlockHeight,
  TEXT_LINE_HEIGHT,
  type SignatureVisualBox
} from '../lib/pdfEngine'
import { ANNOTATION_FONT_CSS } from '../lib/annotationStyle'
import { beginPagesDrag, cancelDrag, consumeDragClick, finishDrag, updateDrag } from '../lib/dragController'
import { usePressDrag } from '../hooks/usePressDrag'
import { useStudioStore } from '../store'
import type { Annotation, PageRef, SignaturePlacement, SourceFile } from '../types'
import { IconClose, IconRotate } from './icons'

const BASE_WIDTH = 190

/**
 * Canvas zoom quantized to half steps so thumbnails re-render sharper as you
 * zoom in, without thrashing. The 1.5x factor oversamples the bitmap relative
 * to its on-screen size so it stays crisp even between the half steps.
 */
function useThumbResolutionScale(): number {
  return useStudioStore((s) => Math.min(4.5, Math.max(1.5, (Math.ceil(s.canvasScale * 2) / 2) * 1.5)))
}

interface Decorations {
  pageWidth: number
  signatures: { placement: SignaturePlacement; box: SignatureVisualBox }[]
  annotations: { annotation: Annotation; box: SignatureVisualBox }[]
}

/** Signature/annotation overlays so placed items are visible on the small thumbnail too. */
function useDecorations(page: PageRef, source: SourceFile | undefined): Decorations | null {
  const [decorations, setDecorations] = useState<Decorations | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!source || (page.signatures.length === 0 && page.annotations.length === 0)) {
      setDecorations(null)
      return
    }
    ;(async () => {
      const size = await getPageVisualSize(source, page.sourcePageIndex, page.rotation)
      const signatures = await Promise.all(
        page.signatures.map(async (placement) => ({
          placement,
          box: await getPlacementVisualBox(source, page.sourcePageIndex, page.rotation, placement)
        }))
      )
      const annotations = await Promise.all(
        page.annotations.map(async (annotation) => ({
          annotation,
          box: await getPlacementVisualBox(source, page.sourcePageIndex, page.rotation, {
            x: annotation.x,
            y: annotation.y,
            width: annotation.type === 'highlight' ? annotation.width : 0,
            height: annotation.type === 'highlight' ? annotation.height : textAnnotationBlockHeight(annotation)
          })
        }))
      )
      if (!cancelled) setDecorations({ pageWidth: size.width, signatures, annotations })
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page.sourcePageIndex, page.rotation, page.signatures, page.annotations])

  return decorations
}

interface Props {
  page: PageRef
  source: SourceFile | undefined
  index: number
}

export default function PageThumb({ page, source, index }: Props): JSX.Element {
  const [thumb, setThumb] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const rotatePages = useStudioStore((s) => s.rotatePages)
  const deletePages = useStudioStore((s) => s.deletePages)
  const openLightbox = useStudioStore((s) => s.openLightbox)
  const toggleSelectPage = useStudioStore((s) => s.toggleSelectPage)
  const rangeSelectPage = useStudioStore((s) => s.rangeSelectPage)
  const isSelected = useStudioStore((s) => s.selectedPageIds.has(page.id))
  const isDragSource = useStudioStore((s) => s.dragPageIds?.includes(page.id) ?? false)
  const resolutionScale = useThumbResolutionScale()
  const decorations = useDecorations(page, source)

  useEffect(() => {
    let cancelled = false
    if (!source) return
    setFailed(false)
    const targetWidth = Math.round(BASE_WIDTH * (window.devicePixelRatio || 1) * resolutionScale)
    renderThumbnail(source, page.sourcePageIndex, page.rotation, targetWidth)
      .then((url) => {
        if (!cancelled) setThumb(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [source, page.sourcePageIndex, page.rotation, resolutionScale, retryToken])

  const dragHandlers = usePressDrag({
    ignoreSelector: 'button',
    onStart: (e) => {
      const { selectedPageIds, groups } = useStudioStore.getState()
      const ids =
        isSelected && selectedPageIds.size > 1
          ? groups.flatMap((g) => g.pages.map((p) => p.id)).filter((id) => selectedPageIds.has(id))
          : [page.id]
      beginPagesDrag(ids, thumb, e.clientX, e.clientY)
    },
    onMove: updateDrag,
    onEnd: finishDrag,
    onCancel: cancelDrag
  })

  const decorScale = decorations ? BASE_WIDTH / decorations.pageWidth : 1

  return (
    <div
      className={`page-thumb${isSelected ? ' page-thumb--selected' : ''}${isDragSource ? ' page-thumb--drag-source' : ''}`}
      data-page-id={page.id}
      data-index={index}
      {...dragHandlers}
      onClick={(e) => {
        if (consumeDragClick()) return
        if (e.ctrlKey || e.metaKey) toggleSelectPage(page.id)
        else if (e.shiftKey) rangeSelectPage(page.id)
        else openLightbox(page.id)
      }}
      title="Klik voor volledig scherm · Ctrl+klik selecteren · Shift+klik bereik · sleep om te verplaatsen"
    >
      <div className="page-thumb__frame" style={{ width: BASE_WIDTH }}>
        {thumb ? (
          <img src={thumb} alt={`Pagina ${index + 1}`} draggable={false} />
        ) : failed ? (
          <div className="page-thumb__error">
            <span>Laden mislukt</span>
            <button
              type="button"
              className="text-btn"
              onClick={(e) => {
                e.stopPropagation()
                setRetryToken((t) => t + 1)
              }}
            >
              Opnieuw proberen
            </button>
          </div>
        ) : (
          <div className="page-thumb__loading" />
        )}
        {thumb && decorations && (
          <div className="page-thumb__decorations">
            {decorations.annotations.map(({ annotation, box }) =>
              annotation.type === 'highlight' ? (
                <div
                  key={annotation.id}
                  className="page-decoration page-decoration--highlight"
                  style={{
                    left: box.pivotX * decorScale,
                    top: (box.pivotY - box.height) * decorScale,
                    width: box.width * decorScale,
                    height: box.height * decorScale,
                    transform: `rotate(${box.rotateDeg}deg)`,
                    background: annotation.color,
                    opacity: annotation.opacity
                  }}
                />
              ) : (
                <div
                  key={annotation.id}
                  className="page-decoration page-decoration--text"
                  style={{
                    left: box.pivotX * decorScale,
                    top: (box.pivotY - box.height) * decorScale,
                    transform: `rotate(${box.rotateDeg}deg)`,
                    color: annotation.color,
                    fontFamily: ANNOTATION_FONT_CSS[annotation.font],
                    fontSize: annotation.size * decorScale,
                    lineHeight: TEXT_LINE_HEIGHT,
                    fontWeight: annotation.bold ? 700 : 400,
                    fontStyle: annotation.italic ? 'italic' : 'normal'
                  }}
                >
                  {annotation.text}
                </div>
              )
            )}
            {decorations.signatures.map(({ placement, box }) => (
              <img
                key={placement.id}
                className="page-decoration"
                src={placement.imageDataUrl}
                alt=""
                draggable={false}
                style={{
                  left: box.pivotX * decorScale,
                  top: (box.pivotY - box.height) * decorScale,
                  width: box.width * decorScale,
                  height: box.height * decorScale,
                  transform: `rotate(${box.rotateDeg}deg)`
                }}
              />
            ))}
          </div>
        )}
        <div className="page-thumb__actions">
          <button
            type="button"
            className="icon-btn"
            title="Roteer pagina"
            onClick={(e) => {
              e.stopPropagation()
              rotatePages([page.id])
            }}
          >
            <IconRotate size={13} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            title="Verwijder pagina"
            onClick={(e) => {
              e.stopPropagation()
              deletePages([page.id])
            }}
          >
            <IconClose size={13} />
          </button>
        </div>
        <span className="page-thumb__index">{index + 1}</span>
        {isSelected && <span className="page-thumb__selected-badge" />}
      </div>
    </div>
  )
}
