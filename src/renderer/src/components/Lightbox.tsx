import { useEffect, useMemo, useState } from 'react'
import { renderThumbnail } from '../lib/pdfEngine'
import { useStudioStore } from '../store'

export default function Lightbox(): JSX.Element | null {
  const lightbox = useStudioStore((s) => s.lightbox)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const closeLightbox = useStudioStore((s) => s.closeLightbox)
  const stepLightbox = useStudioStore((s) => s.stepLightbox)
  const rotatePage = useStudioStore((s) => s.rotatePage)
  const [image, setImage] = useState<string | null>(null)

  const context = useMemo(() => {
    if (!lightbox.pageId) return null
    for (const group of groups) {
      const idx = group.pages.findIndex((p) => p.id === lightbox.pageId)
      if (idx !== -1) return { group, page: group.pages[idx], indexInGroup: idx }
    }
    return null
  }, [lightbox.pageId, groups])

  const flatPosition = useMemo(() => {
    if (!lightbox.pageId) return null
    const flat = groups.flatMap((g) => g.pages)
    const idx = flat.findIndex((p) => p.id === lightbox.pageId)
    return idx === -1 ? null : { idx, total: flat.length }
  }, [lightbox.pageId, groups])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowRight') stepLightbox(1)
      if (e.key === 'ArrowLeft') stepLightbox(-1)
    }
    if (lightbox.open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox.open, closeLightbox, stepLightbox])

  useEffect(() => {
    let cancelled = false
    if (!context) {
      setImage(null)
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    const targetWidth = Math.round(Math.min(window.innerWidth * 0.8, 1400) * (window.devicePixelRatio || 1))
    renderThumbnail(source, context.page.sourcePageIndex, context.page.rotation, targetWidth).then((url) => {
      if (!cancelled) setImage(url)
    })
    return () => {
      cancelled = true
    }
  }, [context, sources])

  if (!lightbox.open || !context) return null

  return (
    <div className="lightbox" onClick={closeLightbox}>
      <div className="lightbox__topbar" onClick={(e) => e.stopPropagation()}>
        <span>{context.group.name}</span>
        {flatPosition && (
          <span className="lightbox__count">
            {flatPosition.idx + 1} / {flatPosition.total}
          </span>
        )}
        <div className="lightbox__spacer" />
        <button type="button" className="icon-btn" onClick={() => rotatePage(context.page.id)} title="Roteer">
          ⟳
        </button>
        <button type="button" className="icon-btn" onClick={closeLightbox} title="Sluiten (Esc)">
          ✕
        </button>
      </div>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--prev"
        disabled={!flatPosition || flatPosition.idx === 0}
        onClick={(e) => {
          e.stopPropagation()
          stepLightbox(-1)
        }}
        aria-label="Vorige pagina"
      >
        ‹
      </button>

      <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {image ? <img src={image} alt={context.group.name} /> : <div className="lightbox__loading" />}
      </div>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--next"
        disabled={!flatPosition || flatPosition.idx === flatPosition.total - 1}
        onClick={(e) => {
          e.stopPropagation()
          stepLightbox(1)
        }}
        aria-label="Volgende pagina"
      >
        ›
      </button>
    </div>
  )
}
