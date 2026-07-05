import { useEffect, useMemo, useState } from 'react'
import { useStudioStore } from '../store'
import { getPageVisualSize, getPdfMetadata, renderThumbnail, type PdfMetadata } from '../lib/pdfRender'
import { diffPages, exportDiffReport, type PageDiff, type NumberChange } from '../lib/pdfDiff'
import { IconChevronLeft, IconChevronRight, IconClose, IconFolderOpen } from './icons'
import type { DocGroup, PageRef, SourceFile } from '../types'

const COL_WIDTH = 460

function ComparePane({
  group,
  page,
  diffLines,
  numberMarks = []
}: {
  group: DocGroup | undefined
  page: PageRef | undefined
  diffLines: PageDiff['left']
  numberMarks?: NumberChange[]
}): JSX.Element {
  const sources = useStudioStore((s) => s.sources)
  const [thumb, setThumb] = useState<string | null>(null)
  const [size, setSize] = useState({ width: 595, height: 842 })
  const [meta, setMeta] = useState<PdfMetadata | null>(null)
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

  useEffect(() => {
    let cancelled = false
    if (!source) {
      setMeta(null)
      return
    }
    getPdfMetadata(source)
      .then((m) => !cancelled && setMeta(m))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source])

  const scale = COL_WIDTH / size.width

  return (
    <div className="compare-pane">
      <div className="compare-pane__title">{group?.name ?? '—'}</div>
      {meta && (meta.title || meta.created || meta.modified) && (
        <div className="compare-pane__meta">
          {meta.title && <span title="Titel in PDF">📄 {meta.title}</span>}
          {meta.created && <span title="Aangemaakt">🗓 gemaakt {meta.created}</span>}
          {meta.modified && <span title="Laatst gewijzigd">✏️ gewijzigd {meta.modified}</span>}
        </div>
      )}
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
        {numberMarks.map((n, i) => (
          <div
            key={`n${i}`}
            className="compare-mark compare-mark--number"
            style={{
              left: n.box.x * scale,
              top: n.box.y * scale,
              width: n.box.width * scale,
              height: n.box.height * scale
            }}
            title={`${n.label}: ${n.from} → ${n.to}`}
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
  const [diff, setDiff] = useState<PageDiff>({ left: [], right: [], changeCount: 0, numbers: [] })
  const [report, setReport] = useState<
    { page: number; left: string[]; right: string[]; changed: number; numbers: NumberChange[] }[] | null
  >(null)
  const [reportBusy, setReportBusy] = useState(false)

  const left = groups.find((g) => g.id === compare.leftGroupId)
  const right = groups.find((g) => g.id === compare.rightGroupId)
  const maxPages = Math.max(left?.pages.length ?? 0, right?.pages.length ?? 0)

  async function addDocument(): Promise<void> {
    if (typeof window.api.openPdfs !== 'function') return
    const files = await window.api.openPdfs()
    if (files.length) await useStudioStore.getState().importFiles(files)
  }

  /** Bouwt een verschiloverzicht over alle pagina's om in een venster te tonen. */
  async function buildReport(): Promise<void> {
    if (!left || !right || reportBusy) return
    setReportBusy(true)
    try {
      const rows: { page: number; left: string[]; right: string[]; changed: number; numbers: NumberChange[] }[] = []
      for (let i = 0; i < maxPages; i += 1) {
        const lp = left.pages[i]
        const rp = right.pages[i]
        const d = await diffPages(
          lp ? sources.get(lp.sourceId) : undefined,
          lp,
          rp ? sources.get(rp.sourceId) : undefined,
          rp
        ).catch(() => ({ left: [], right: [], changeCount: 0, numbers: [] }) as PageDiff)
        if (d.changeCount > 0 || d.numbers.length > 0) {
          rows.push({
            page: i + 1,
            left: d.left.filter((x) => x.kind !== 'added').map((x) => x.text),
            right: d.right.filter((x) => x.kind !== 'removed').map((x) => x.text),
            changed: d.changeCount,
            numbers: d.numbers
          })
        }
      }
      setReport(rows)
    } finally {
      setReportBusy(false)
    }
  }

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
          <span className="compare-legend compare-legend--number">cijfer gewijzigd</span>
        </div>
        <button
          type="button"
          className="pill-btn"
          title="Nog een document openen om te vergelijken"
          onClick={() => void addDocument()}
        >
          <IconFolderOpen size={14} /> Document toevoegen
        </button>
        <button
          type="button"
          className="pill-btn"
          disabled={!left || !right || reportBusy}
          title="Toon alle verschillen in een venster"
          onClick={() => void buildReport()}
        >
          {reportBusy ? 'Bezig…' : 'Verschillen tonen'}
        </button>
        <button
          type="button"
          className="pill-btn"
          disabled={!left || !right}
          title="Alle verschillen als PDF-rapport opslaan"
          onClick={() => left && right && void exportDiffReport(left, right, sources)}
        >
          Verschilrapport (PDF)
        </button>
        <button type="button" className="icon-btn" title="Vergelijken sluiten (Esc)" onClick={close}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="compare-view__panes">
        <ComparePane group={left} page={leftPage} diffLines={diff.left} />
        <ComparePane group={right} page={rightPage} diffLines={diff.right} numberMarks={diff.numbers} />
      </div>

      {report && (
        <div className="modal-overlay" onClick={() => setReport(null)}>
          <div className="modal-card compare-report" onClick={(e) => e.stopPropagation()}>
            <div className="modal-card__header">
              <h3>Verschiloverzicht — {report.reduce((n, r) => n + r.changed, 0)} wijziging(en)</h3>
              <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setReport(null)}>
                <IconClose size={14} />
              </button>
            </div>
            {report.length === 0 ? (
              <p>De documenten zijn tekstueel gelijk.</p>
            ) : (
              <div className="compare-report__list">
                {report.map((r) => (
                  <div key={r.page} className="compare-report__page">
                    <div className="compare-report__page-title">
                      Pagina {r.page} — {r.changed} wijziging(en)
                      {r.numbers.length > 0 ? ` · ${r.numbers.length} cijferwijziging(en)` : ''}
                    </div>
                    {r.numbers.length > 0 && (
                      <div className="compare-report__numbers">
                        {r.numbers.map((n, k) => (
                          <div key={k} className="compare-report__number">
                            <span className="compare-report__number-label">{n.label || 'Getal'}</span>
                            <span className="compare-report__number-from">{n.from}</span>
                            <span className="compare-report__number-arrow">→</span>
                            <span className="compare-report__number-to">{n.to}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="compare-report__cols">
                      <div className="compare-report__col compare-report__col--left">
                        <div className="compare-report__col-head">{left?.name}</div>
                        {r.left.map((t, i) => (
                          <div key={i} className="compare-report__line">{t}</div>
                        ))}
                      </div>
                      <div className="compare-report__col compare-report__col--right">
                        <div className="compare-report__col-head">{right?.name}</div>
                        {r.right.map((t, i) => (
                          <div key={i} className="compare-report__line">{t}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-card__actions">
              <button type="button" className="pill-btn pill-btn--primary" onClick={() => setReport(null)}>
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
