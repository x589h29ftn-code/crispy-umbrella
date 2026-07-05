import { useEffect, useMemo, useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { getPageVisualSize, getPdfMetadata, renderThumbnail, type PdfMetadata } from '../lib/pdfRender'
import { diffPages, exportDiffReport, type PageDiff, type NumberChange } from '../lib/pdfDiff'
import { IconClose, IconFolderOpen, IconMinus, IconPlus } from './icons'
import type { DocGroup, PageRef, SourceFile } from '../types'

const BASE_WIDTH = 460

function ComparePane({
  page,
  diffLines,
  numberMarks = [],
  width
}: {
  page: PageRef | undefined
  diffLines: PageDiff['left']
  numberMarks?: NumberChange[]
  width: number
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
    renderThumbnail(source, page.sourcePageIndex, page.rotation, Math.round(BASE_WIDTH * 2))
      .then((url) => !cancelled && setThumb(url))
      .catch(() => undefined)
    getPageVisualSize(source, page.sourcePageIndex, page.rotation)
      .then((s) => !cancelled && setSize(s))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page])

  const scale = width / size.width

  return (
    <div className="compare-pane">
      <div className="compare-pane__page" style={{ width, height: size.height * scale }}>
        {thumb ? <img src={thumb} alt="" draggable={false} style={{ width }} /> : <div className="compare-pane__ph" />}
        {diffLines.map((d, i) => (
          <div
            key={i}
            className="compare-mark compare-mark--diff"
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

/** Eén paginapaar in de doorlopende vergelijking; de diff wordt pas berekend zodra de rij in beeld komt. */
function CompareRow({
  index,
  left,
  right,
  width
}: {
  index: number
  left: DocGroup | undefined
  right: DocGroup | undefined
  width: number
}): JSX.Element {
  const sources = useStudioStore((s) => s.sources)
  const [diff, setDiff] = useState<PageDiff | null>(null)
  const [visible, setVisible] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const leftPage = left?.pages[index]
  const rightPage = right?.pages[index]

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '900px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
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
  }, [visible, leftPage, rightPage, sources])

  return (
    <div className="compare-row" ref={rootRef} data-page={index + 1}>
      <div className="compare-row__head">
        Pagina {index + 1}
        {diff
          ? diff.changeCount > 0 || diff.numbers.length > 0
            ? ` — ${diff.changeCount} wijziging${diff.changeCount === 1 ? '' : 'en'}${diff.numbers.length ? ` · ${diff.numbers.length} cijfer(s)` : ''}`
            : ' — gelijk'
          : ' — vergelijken…'}
      </div>
      <div className="compare-row__panes">
        {visible ? (
          <>
            <ComparePane page={leftPage} diffLines={diff?.left ?? []} width={width} />
            <ComparePane page={rightPage} diffLines={diff?.right ?? []} numberMarks={diff?.numbers ?? []} width={width} />
          </>
        ) : (
          <div className="compare-pane__ph" style={{ width: width * 2 + 24, height: width * 1.41 }} />
        )}
      </div>
    </div>
  )
}

function MetaLine({ group }: { group: DocGroup | undefined }): JSX.Element | null {
  const sources = useStudioStore((s) => s.sources)
  const [meta, setMeta] = useState<PdfMetadata | null>(null)
  const source = group?.pages[0] ? sources.get(group.pages[0].sourceId) : undefined
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
  return (
    <div className="compare-pane__metaCol">
      <div className="compare-pane__title">{group?.name ?? '—'}</div>
      {meta && (meta.title || meta.created || meta.modified) && (
        <div className="compare-pane__meta">
          {meta.title && <span title="Titel in PDF">📄 {meta.title}</span>}
          {meta.created && <span title="Aangemaakt">🗓 gemaakt {meta.created}</span>}
          {meta.modified && <span title="Laatst gewijzigd">✏️ gewijzigd {meta.modified}</span>}
        </div>
      )}
    </div>
  )
}

/** Volledig-scherm vergelijking: doorlopend scrollen langs alle pagina's, met zoom. */
export default function CompareView(): JSX.Element | null {
  const compare = useStudioStore((s) => s.compare)
  const close = useStudioStore((s) => s.closeCompare)
  const setCompareGroups = useStudioStore((s) => s.setCompareGroups)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)

  const [zoom, setZoom] = useState(1)
  const [report, setReport] = useState<
    { page: number; left: string[]; right: string[]; changed: number; numbers: NumberChange[] }[] | null
  >(null)
  const [reportBusy, setReportBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const left = groups.find((g) => g.id === compare.leftGroupId)
  const right = groups.find((g) => g.id === compare.rightGroupId)
  const maxPages = Math.max(left?.pages.length ?? 0, right?.pages.length ?? 0)
  const paneWidth = Math.round(BASE_WIDTH * zoom)

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

  // Ctrl+wheel zoomt binnen de vergelijking (zoals in de leesweergave).
  useEffect(() => {
    if (!compare.open) return
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => Math.min(3, Math.max(0.4, z * Math.exp(-e.deltaY * 0.0022))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [compare.open])

  useEffect(() => {
    if (!compare.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compare.open, close])

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
        <select value={compare.rightGroupId ?? ''} onChange={(e) => setCompareGroups('right', e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <div className="compare-view__nav" title="Zoom (ook Ctrl + muiswiel)">
          <button type="button" className="pill-btn pill-btn--icon" onClick={() => setZoom((z) => Math.max(0.4, z / 1.2))}>
            <IconMinus size={13} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="pill-btn pill-btn--icon" onClick={() => setZoom((z) => Math.min(3, z * 1.2))}>
            <IconPlus size={13} />
          </button>
        </div>
        <div className="compare-view__legend">
          <span className="compare-legend compare-legend--diff">verschil</span>
          <span className="compare-legend compare-legend--number">cijfer gewijzigd</span>
        </div>
        <button type="button" className="pill-btn" title="Nog een document openen om te vergelijken" onClick={() => void addDocument()}>
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
          title="Cijferwijzigingen (was/is/verschil/% mutatie) naar Excel — voor jaarrekeningen"
          onClick={() =>
            left && right && void import('../lib/yearCompare').then((m) => m.exportYearComparisonXlsx(left, right, sources))
          }
        >
          Jaar-op-jaar (Excel)
        </button>
        <button
          type="button"
          className="pill-btn"
          disabled={!left || !right}
          title="Alle verschillen als PDF-rapport opslaan (per hoofdstuk, met inhoudsopgave)"
          onClick={() => left && right && void exportDiffReport(left, right, sources)}
        >
          Verschilrapport (PDF)
        </button>
        <button type="button" className="icon-btn" title="Vergelijken sluiten (Esc)" onClick={close}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="compare-view__metabar">
        <MetaLine group={left} />
        <MetaLine group={right} />
      </div>
      <div className="compare-view__scroll" ref={scrollRef}>
        {Array.from({ length: maxPages }, (_, i) => (
          <CompareRow key={`${compare.leftGroupId}-${compare.rightGroupId}-${i}`} index={i} left={left} right={right} width={paneWidth} />
        ))}
        {maxPages === 0 && <p className="compare-view__empty">Kies links en rechts een document om te vergelijken.</p>}
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
