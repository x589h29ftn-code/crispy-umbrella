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
  const rotatePage = useStudioStore((s) => s.rotatePage)
  const deletePage = useStudioStore((s) => s.deletePage)
  const openLightbox = useStudioStore((s) => s.openLightbox)
  const setDragPageId = useStudioStore((s) => s.setDragPageId)

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
      className="page-thumb"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', page.id)
        setDragPageId(page.id)
      }}
      onDragEnd={() => setDragPageId(null)}
      onDragOver={(e) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const edge = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
        onDragOverSlot(index, edge)
      }}
      onClick={() => openLightbox(page.id)}
      title="Klik voor volledig scherm"
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
              rotatePage(page.id)
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
              deletePage(page.id)
            }}
          >
            <IconClose size={13} />
          </button>
        </div>
        <span className="page-thumb__index">{index + 1}</span>
      </div>
    </div>
  )
}
