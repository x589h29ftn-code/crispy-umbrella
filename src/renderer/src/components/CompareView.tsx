import { useEffect, useMemo, useState } from 'react'
import { useStudioStore } from '../store'
import { getPageVisualSize, renderThumbnail } from '../lib/pdfEngine'
import { diffPages, exportDiffReport, type PageDiff } from '../lib/pdfDiff'
import { IconChevronLeft, IconChevronRight, IconClose } from './icons'
import type { DocGroup, PageRef, SourceFile } from '../types'

const COL_WIDTH = 460

function ComparePane({
  group,
  page,
  diffLines
}: {
  group: DocGroup | undefined
  page: PageRef | undefined
  diffLines: PageDiff['left']
}): JSX.Element {
  const sources = useStudioStore((s) => s.sources)
  const [thumb, setThumb] = useState<string | null>(null)
  const [size, setSize] = useState({ width: 595, height: 842 })
  const source: SourceFile | undefined = page ? sources.get(page.sourceId) : undefined

  useEffect(() => {
    let cancelled = false
    if (!source || !page) {
      setThumb(null)
      return
    }
    renderThumbnail(source, page.sourcePageIndex, page.rotation, Math.round(COL_WIDTH * 2))
      .then((url) => !cancelled && setThumb(url))
      .catch(() => undefined)
    getPageVisualSize(source, page.sourcePageIndex, page.rotation)
      .then((s) => !cancelled && setSize(s))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page])

  const scale = COL_WIDTH / size.width

  return (
    <div className="compare-pane">
      <div className="compare-pane__title">{group?.name ?? '—'}</div>
      <div className="compare-pane__page" style={{ width: COL_WIDTH, height: size.height * scale }}>
        {thumb ? <img src={thumb} alt="" draggable={false} style={{ width: COL_WIDTH }} /> : <div className="compare-pane__ph" />}
        {diffLines.map((d, i) => (
          <div
            key={i}
            className={`compare-mark compare-mark--${d.kind}`}
            style={{
              left: d.box.x * scale,
              top: d.box.y * scale,
              width: d.box.width * scale,
              height: d.box.height * scale
            }}
            title={d.text}
          />
        ))}
      </div>
    </div>
  )
}

/** Volledig-scherm vergelijking van twee documenten met tekstverschillen per pagina. */
export default function CompareView(): JSX.Element | null {
  const compare = useStudioStore((s) => s.compare)
  const close = useStudioStore((s) => s.closeCompare)
  const setCompareGroups = useStudioStore((s) => s.setCompareGroups)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)

  const [pageIndex, setPageIndex] = useState(0)
  const [diff, setDiff] = useState<PageDiff>({ left: [], right: [], changeCount: 0 })

  const left = groups.find((g) => g.id === compare.leftGroupId)
  const right = groups.find((g) => g.id === compare.rightGroupId)
  const maxPages = Math.max(left?.pages.length ?? 0, right?.pages.length ?? 0)

  const leftPage = left?.pages[pageIndex]
  const rightPage = right?.pages[pageIndex]

  useEffect(() => {
    setPageIndex(0)
  }, [compare.leftGroupId, compare.rightGroupId])

  useEffect(() => {
    if (!compare.open) return
    let cancelled = false
    diffPages(
      leftPage ? sources.get(leftPage.sourceId) : undefined,
      leftPage,
      rightPage ? sources.get(rightPage.sourceId) : undefined,
      rightPage
    )
      .then((d) => !cancelled && setDiff(d))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [compare.open, leftPage, rightPage, sources])

  useEffect(() => {
    if (!compare.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') setPageIndex((p) => Math.min(maxPages - 1, p + 1))
      if (e.key === 'ArrowLeft') setPageIndex((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compare.open, close, maxPages])

  const options = useMemo(() => groups.map((g) => ({ id: g.id, name: g.name })), [groups])

  if (!compare.open) return null

  return (
    <div className="compare-view">
      <div className="compare-view__bar">
        <select value={compare.leftGroupId ?? ''} onChange={(e) => setCompareGroups('left', e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <div className="compare-view__nav">
          <button
            type="button"
            className="pill-btn pill-btn--icon"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
          >
            <IconChevronLeft size={14} />
          </button>
          <span>
            pagina {pageIndex + 1} / {maxPages}
            {diff.changeCount > 0 ? ` · ${diff.changeCount} wijziging${diff.changeCount === 1 ? '' : 'en'}` : ' · gelijk'}
          </span>
          <button
            type="button"
            className="pill-btn pill-btn--icon"
            disabled={pageIndex >= maxPages - 1}
            onClick={() => setPageIndex((p) => Math.min(maxPages - 1, p + 1))}
          >
            <IconChevronRight size={14} />
          </button>
        </div>
        <select value={compare.rightGroupId ?? ''} onChange={(e) => setCompareGroups('right', e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <div className="compare-view__legend">
          <span className="compare-legend compare-legend--removed">verwijderd</span>
          <span className="compare-legend compare-legend--changed">gewijzigd</span>
          <span className="compare-legend compare-legend--added">toegevoegd</span>
        </div>
        <button
          type="button"
          className="pill-btn"
          disabled={!left || !right}
          title="Alle verschillen als PDF-rapport opslaan"
          onClick={() => left && right && void exportDiffReport(left, right, sources)}
        >
          Verschilrapport
        </button>
        <button type="button" className="icon-btn" title="Vergelijken sluiten (Esc)" onClick={close}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="compare-view__panes">
        <ComparePane group={left} page={leftPage} diffLines={diff.left} />
        <ComparePane group={right} page={rightPage} diffLines={diff.right} />
      </div>
    </div>
  )
}
