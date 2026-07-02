import { useEffect, useState } from 'react'
import { renderThumbnail } from '../lib/pdfEngine'
import { beginPagesDrag, cancelDrag, consumeDragClick, finishDrag, updateDrag } from '../lib/dragController'
import { usePressDrag } from '../hooks/usePressDrag'
import { useStudioStore } from '../store'
import type { PageRef, SourceFile } from '../types'
import { IconClose, IconRotate } from './icons'

const BASE_WIDTH = 190

/** Canvas zoom quantized to half steps so thumbnails re-render sharper as you zoom in, without thrashing. */
function useThumbResolutionScale(): number {
  return useStudioStore((s) => Math.min(3, Math.max(1, Math.ceil(s.canvasScale * 2) / 2)))
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
