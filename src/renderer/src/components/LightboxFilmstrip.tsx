import { useEffect, useState } from 'react'
import { renderThumbnail } from '../lib/pdfRender'
import { useStudioStore } from '../store'
import type { DocGroup, SourceFile } from '../types'

const THUMB_WIDTH = 60

export default function LightboxFilmstrip(): JSX.Element {
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const currentPageId = useStudioStore((s) => s.lightbox.pageId)
  const openLightbox = useStudioStore((s) => s.openLightbox)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  const flat = groups.flatMap((g: DocGroup) => g.pages.map((p) => ({ page: p, group: g })))

  useEffect(() => {
    let cancelled = false
    flat.forEach(({ page }) => {
      const source: SourceFile | undefined = sources.get(page.sourceId)
      if (!source) return
      renderThumbnail(source, page.sourcePageIndex, page.rotation, THUMB_WIDTH * 2)
        .then((url) => {
          if (!cancelled) setThumbs((prev) => (prev[page.id] ? prev : { ...prev, [page.id]: url }))
        })
        .catch(() => undefined)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, sources])

  return (
    <div className="filmstrip" onClick={(e) => e.stopPropagation()}>
      {flat.map(({ page }) => (
        <button
          key={page.id}
          type="button"
          className={`filmstrip__item${page.id === currentPageId ? ' filmstrip__item--active' : ''}`}
          onClick={() => openLightbox(page.id)}
        >
          {thumbs[page.id] ? <img src={thumbs[page.id]} alt="" /> : <span className="filmstrip__placeholder" />}
        </button>
      ))}
    </div>
  )
}
