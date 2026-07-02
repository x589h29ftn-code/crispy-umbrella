import { useEffect, useState } from 'react'
import { renderThumbnail } from '../lib/pdfEngine'
import { useStudioStore } from '../store'
import type { PageRef, SourceFile } from '../types'
import { IconClose, IconRotate } from './icons'

const BASE_WIDTH = 190

interface Props {
  page: PageRef
  source: SourceFile | undefined
  onDragOverSlot: (index: number, edge: 'before' | 'after') => void
  index: number
}

export default function PageThumb({ page, source, index, onDragOverSlot }: Props): JSX.Element {
  const [thumb, setThumb] = useState<string | null>(null)
  const rotatePages = useStudioStore((s) => s.rotatePages)
  const deletePages = useStudioStore((s) => s.deletePages)
  const openLightbox = useStudioStore((s) => s.openLightbox)
  const toggleSelectPage = useStudioStore((s) => s.toggleSelectPage)
  const rangeSelectPage = useStudioStore((s) => s.rangeSelectPage)
  const setDragPageIds = useStudioStore((s) => s.setDragPageIds)
  const isSelected = useStudioStore((s) => s.selectedPageIds.has(page.id))
  const selectionCount = useStudioStore((s) => s.selectedPageIds.size)

  useEffect(() => {
    let cancelled = false
    if (!source) return
    const targetWidth = Math.round(BASE_WIDTH * (window.devicePixelRatio || 1))
    renderThumbnail(source, page.sourcePageIndex, page.rotation, targetWidth)
      .then((url) => {
        if (!cancelled) setThumb(url)
      })
      .catch(() => {
        if (!cancelled) setThumb(null)
      })
    return () => {
      cancelled = true
    }
  }, [source, page.sourcePageIndex, page.rotation])

  return (
    <div
      className={`page-thumb${isSelected ? ' page-thumb--selected' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', page.id)
        // Dragging a selected page carries the whole selection along.
        const { selectedPageIds, groups } = useStudioStore.getState()
        const ids =
          isSelected && selectedPageIds.size > 1
            ? groups.flatMap((g) => g.pages.map((p) => p.id)).filter((id) => selectedPageIds.has(id))
            : [page.id]
        setDragPageIds(ids)
      }}
      onDragEnd={() => setDragPageIds(null)}
      onDragOver={(e) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const edge = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
        onDragOverSlot(index, edge)
      }}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) toggleSelectPage(page.id)
        else if (e.shiftKey) rangeSelectPage(page.id)
        else openLightbox(page.id)
      }}
      title={
        selectionCount > 0 ? undefined : 'Klik voor volledig scherm · Ctrl+klik selecteren · Shift+klik bereik'
      }
    >
      <div className="page-thumb__frame" style={{ width: BASE_WIDTH }}>
        {thumb ? (
          <img src={thumb} alt={`Pagina ${index + 1}`} draggable={false} />
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
