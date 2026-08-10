import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { getPdfMetadata, renderThumbnail, type PdfMetadata } from '../lib/pdfRender'
import {
  DEFAULT_DIFF_FILTER,
  diffDocuments,
  exportDiffReport,
  filterChanges,
  formatDiffNumber,
  summarizeChanges,
  type ChangeEntry,
  type ChangeKind,
  type DiffBox,
  type DiffFilter,
  type DocumentDiff
} from '../lib/pdfDiff'
import { IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconFolderOpen, IconMinus, IconPlus } from './icons'
import ScanNotice from './ScanNotice'
import type { DocGroup, PageRef, SourceFile } from '../types'

const BASE_WIDTH = 460
/** Horizontale padding van .compare-view__scroll (2 × 24 px). */
const SCROLL_PADDING = 48
/** Ruimte tussen de twee pagina's (.compare-row__panes gap). */
const PANE_GAP = 24

interface Mark {
  id: string
  kind: ChangeKind
  box: DiffBox
  title: string
}

const KIND_LABELS: Record<ChangeKind, string> = {
  changed: 'Gewijzigd',
  added: 'Toegevoegd',
  removed: 'Verwijderd',
  number: 'Bedrag',
  'page-added': 'Pagina toegevoegd',
  'page-removed': 'Pagina verwijderd'
}

/** Korte omschrijving van een wijziging voor de lijst en de tooltip. */
function changeTitle(c: ChangeEntry): string {
  if (c.kind === 'number') {
    const mutation =
      c.delta !== null && c.delta !== undefined
        ? ` (${c.delta > 0 ? '+' : ''}${formatDiffNumber(c.delta)}${c.pct !== null && c.pct !== undefined ? `, ${c.pct > 0 ? '+' : ''}${c.pct}%` : ''})`
        : ''
    return `${c.label ?? 'Getal'}: ${formatDiffNumber(c.from)} → ${formatDiffNumber(c.to)}${mutation}`
  }
  if (c.kind === 'changed') return `Oud: ${c.before ?? ''} — Nieuw: ${c.after ?? ''}`
  return c.after ?? c.before ?? KIND_LABELS[c.kind]
}

function ComparePane({
  page,
  size,
  marks,
  activeId,
  width,
  renderWidth
}: {
  page: PageRef | undefined
  size: { width: number; height: number } | undefined
  marks: Mark[]
  activeId: string | null
  width: number
  /** Resolutie waarop de pagina getekend wordt (volgt de zoom en het scherm). */
  renderWidth: number
}): JSX.Element {
  const sources = useStudioStore((s) => s.sources)
  const [thumb, setThumb] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const source: SourceFile | undefined = page ? sources.get(page.sourceId) : undefined
  const pageSize = size ?? { width: 595, height: 842 }

  // De afbeelding pas renderen zodra de pagina in de buurt van het scherm komt.
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

  // Opnieuw tekenen zodra er (flink) verder ingezoomd wordt, anders wordt de
  // pagina bij 200% een vlek.
  useEffect(() => {
    let cancelled = false
    if (!source || !page || !visible) return
    renderThumbnail(source, page.sourcePageIndex, page.rotation, renderWidth)
      .then((url) => !cancelled && setThumb(url))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page, visible, renderWidth])

  const scale = width / pageSize.width

  return (
    <div className="compare-pane" ref={rootRef}>
      <div className="compare-pane__page" style={{ width, height: pageSize.height * scale }}>
        {thumb ? <img src={thumb} alt="" draggable={false} style={{ width }} /> : <div className="compare-pane__ph" />}
        {marks.map((m) => (
          <div
            key={m.id}
            data-change-id={m.id}
            className={`compare-mark compare-mark--${m.kind}${activeId === m.id ? ' compare-mark--active' : ''}`}
            style={{
              left: m.box.x * scale,
              top: m.box.y * scale,
              width: m.box.width * scale,
              height: m.box.height * scale
            }}
            title={m.title}
          />
        ))}
      </div>
    </div>
  )
}

/** Eén paginapaar in de doorlopende vergelijking. */
function CompareRow({
  index,
  left,
  right,
  leftSize,
  rightSize,
  leftMarks,
  rightMarks,
  activeId,
  width,
  renderWidth,
  label
}: {
  index: number
  left: DocGroup | undefined
  right: DocGroup | undefined
  leftSize: { width: number; height: number } | undefined
  rightSize: { width: number; height: number } | undefined
  leftMarks: Mark[]
  rightMarks: Mark[]
  activeId: string | null
  width: number
  renderWidth: number
  label: string
}): JSX.Element {
  return (
    <div className="compare-row" data-page={index + 1}>
      <div className="compare-row__head">
        Pagina {index + 1}
        {label}
      </div>
      <div className="compare-row__panes">
        <ComparePane
          page={left?.pages[index]}
          size={leftSize}
          marks={leftMarks}
          activeId={activeId}
          width={width}
          renderWidth={renderWidth}
        />
        <ComparePane
          page={right?.pages[index]}
          size={rightSize}
          marks={rightMarks}
          activeId={activeId}
          width={width}
          renderWidth={renderWidth}
        />
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

  /** null = passend in beeld; een getal is een handmatig gekozen zoom. */
  const [zoom, setZoom] = useState<number | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [diff, setDiff] = useState<DocumentDiff | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [filter, setFilter] = useState<DiffFilter>(DEFAULT_DIFF_FILTER)
  const [mode, setMode] = useState<'all' | 'numbers'>('all')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const left = groups.find((g) => g.id === compare.leftGroupId)
  const right = groups.find((g) => g.id === compare.rightGroupId)
  const maxPages = Math.max(left?.pages.length ?? 0, right?.pages.length ?? 0)

  // Zonder eigen zoomkeuze passen de twee pagina's samen precies in de strook,
  // zodat er geen ruimte onbenut blijft en er niets onder het paneel schuift.
  const fitZoom = viewportWidth > 0 ? Math.min(3, Math.max(0.4, (viewportWidth - SCROLL_PADDING - PANE_GAP) / 2 / BASE_WIDTH)) : 1
  const effectiveZoom = zoom ?? fitZoom
  const paneWidth = Math.round(BASE_WIDTH * effectiveZoom)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  // In stappen van 200 px, zodat kleine zoomstapjes niet alles opnieuw tekenen.
  const renderWidth = Math.min(2600, Math.max(700, Math.ceil((paneWidth * dpr * 1.1) / 200) * 200))

  useEffect(() => {
    const el = scrollRef.current
    if (!compare.open || !el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setViewportWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [compare.open, panelOpen])

  // Documentbrede vergelijking zodra beide documenten bekend zijn. Wisselen van
  // document breekt de lopende berekening netjes af.
  useEffect(() => {
    if (!compare.open || !left || !right) {
      setDiff(null)
      return
    }
    let cancelled = false
    setDiff(null)
    setActiveId(null)
    setProgress({ done: 0, total: Math.max(left.pages.length, right.pages.length) })
    diffDocuments(left, right, sources, (p) => !cancelled && setProgress(p), () => cancelled)
      .then((result) => {
        if (cancelled) return
        setDiff(result)
        setProgress(null)
      })
      .catch(() => {
        if (!cancelled) setProgress(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare.open, compare.leftGroupId, compare.rightGroupId, left?.pages.length, right?.pages.length])

  const effectiveFilter: DiffFilter = useMemo(
    () => (mode === 'numbers' ? { ...filter, changed: false, added: false, removed: false, numbers: true } : filter),
    [filter, mode]
  )

  const visible = useMemo(
    () => (diff ? filterChanges(diff.changes, effectiveFilter) : []),
    [diff, effectiveFilter]
  )

  /** Aantallen per soort, met de kop-/voetteksten al buiten beschouwing gelaten. */
  const counts = useMemo(
    () => summarizeChanges(diff ? diff.changes.filter((c) => !filter.ignoreHeads || !c.head) : []),
    [diff, filter.ignoreHeads]
  )
  const headCount = useMemo(() => (diff ? diff.changes.filter((c) => c.head).length : 0), [diff])

  // Markeringen per pagina en per kant, uit de gefilterde lijst.
  const marksByPage = useMemo(() => {
    const map = new Map<number, { left: Mark[]; right: Mark[] }>()
    for (const c of visible) {
      let entry = map.get(c.page)
      if (!entry) {
        entry = { left: [], right: [] }
        map.set(c.page, entry)
      }
      const title = changeTitle(c)
      if (c.left) entry.left.push({ id: c.id, kind: c.kind, box: c.left, title })
      if (c.right) entry.right.push({ id: c.id, kind: c.kind, box: c.right, title })
    }
    return map
  }, [visible])

  const countsByPage = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of visible) map.set(c.page, (map.get(c.page) ?? 0) + 1)
    return map
  }, [visible])

  /** Springt naar een wijziging: markering in beeld en regel in de lijst. */
  const goTo = useCallback((id: string | null) => {
    setActiveId(id)
    if (!id) return
    window.requestAnimationFrame(() => {
      const scroller = scrollRef.current
      const mark = scroller?.querySelector<HTMLElement>(`[data-change-id="${id}"]`)
      if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
      listRef.current?.querySelector<HTMLElement>(`[data-list-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  const step = useCallback(
    (delta: number) => {
      if (!visible.length) return
      const current = visible.findIndex((c) => c.id === activeId)
      const next = current < 0 ? (delta > 0 ? 0 : visible.length - 1) : (current + delta + visible.length) % visible.length
      goTo(visible[next].id)
    },
    [visible, activeId, goTo]
  )

  const activeIndex = visible.findIndex((c) => c.id === activeId)

  // Ctrl+wheel zoomt binnen de vergelijking (zoals in de leesweergave).
  useEffect(() => {
    if (!compare.open) return
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => Math.min(3, Math.max(0.4, (z ?? fitZoom) * Math.exp(-e.deltaY * 0.0022))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [compare.open, fitZoom])

  useEffect(() => {
    if (!compare.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close()
        return
      }
      // F3 / Alt+pijltjes: naar de volgende of vorige wijziging.
      if (e.key === 'F3' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight'))) {
        e.preventDefault()
        step(e.shiftKey && e.key === 'F3' ? -1 : 1)
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        step(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compare.open, close, step])

  const options = useMemo(() => groups.map((g) => ({ id: g.id, name: g.name })), [groups])

  async function addDocument(): Promise<void> {
    if (typeof window.api.openPdfs !== 'function') return
    const files = await window.api.openPdfs()
    if (files.length) await useStudioStore.getState().importFiles(files)
  }

  if (!compare.open) return null

  const pagesDiffer = Boolean(left && right && left.pages.length !== right.pages.length)
  const sameDocument = Boolean(left && right && left.id === right.id)

  return (
    <div className={`compare-view${panelOpen ? '' : ' compare-view--wide'}`}>
      <div className="compare-view__bar">
        <select
          value={compare.leftGroupId ?? ''}
          className={sameDocument ? 'compare-view__select--warn' : undefined}
          title="Oude versie (links)"
          onChange={(e) => setCompareGroups('left', e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.id === compare.rightGroupId ? ' (staat al rechts)' : ''}
            </option>
          ))}
        </select>
        <select
          value={compare.rightGroupId ?? ''}
          className={sameDocument ? 'compare-view__select--warn' : undefined}
          title="Nieuwe versie (rechts)"
          onChange={(e) => setCompareGroups('right', e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.id === compare.leftGroupId ? ' (staat al links)' : ''}
            </option>
          ))}
        </select>
        <div className="compare-view__nav" title="Zoom (ook Ctrl + muiswiel)">
          <button
            type="button"
            className="pill-btn pill-btn--icon"
            title="Kleiner"
            onClick={() => setZoom((z) => Math.max(0.4, (z ?? fitZoom) / 1.2))}
          >
            <IconMinus size={13} />
          </button>
          <span>{Math.round(effectiveZoom * 100)}%</span>
          <button
            type="button"
            className="pill-btn pill-btn--icon"
            title="Groter"
            onClick={() => setZoom((z) => Math.min(3, (z ?? fitZoom) * 1.2))}
          >
            <IconPlus size={13} />
          </button>
          <button
            type="button"
            className={`pill-btn${zoom === null ? ' pill-btn--primary' : ''}`}
            title="Beide pagina's passend naast elkaar"
            onClick={() => setZoom(null)}
          >
            Passend
          </button>
        </div>
        {/* Compacte legenda: met de volledige tekst erbij liep de balk op een
            laptopscherm over twee regels. De filterknoppen in het paneel dragen
            dezelfde kleuren. */}
        <div
          className="compare-view__legend"
          title="Geel = gewijzigd · groen = toegevoegd · rood = verwijderd · blauw = gewijzigd bedrag"
        >
          <span className="compare-legend compare-legend--changed" />
          <span className="compare-legend compare-legend--added" />
          <span className="compare-legend compare-legend--removed" />
          <span className="compare-legend compare-legend--number" />
        </div>
        <button type="button" className="pill-btn" title="Nog een document openen om te vergelijken" onClick={() => void addDocument()}>
          <IconFolderOpen size={14} /> Toevoegen
        </button>
        <button
          type="button"
          className="pill-btn"
          disabled={!left || !right || !visible.some((c) => c.kind === 'number')}
          title="Jaar-op-jaar naar Excel: was, is, verschil en % mutatie — voor jaarrekeningen"
          onClick={() =>
            left && right && void import('../lib/yearCompare').then((m) => m.exportYearComparisonXlsx(left, right, visible))
          }
        >
          Jaar-op-jaar
        </button>
        <button
          type="button"
          className="pill-btn"
          disabled={!left || !right || !diff}
          title="Verschilrapport (PDF): de wijzigingen zoals ze nu in beeld staan, per hoofdstuk met inhoudsopgave"
          onClick={() => left && right && void exportDiffReport(left, right, sources, visible)}
        >
          Verschilrapport
        </button>
        <button
          type="button"
          className="pill-btn"
          title={panelOpen ? 'Wijzigingenlijst verbergen' : 'Wijzigingenlijst tonen'}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? 'Lijst verbergen' : `Lijst${visible.length ? ` (${visible.length})` : ''}`}
        </button>
        <button type="button" className="icon-btn" title="Vergelijken sluiten (Esc)" onClick={close}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="compare-view__metabar">
        <MetaLine group={left} />
        <MetaLine group={right} />
      </div>
      <ScanNotice group={left} />
      {left?.id !== right?.id && <ScanNotice group={right} />}

      <div className="compare-view__body">
        <div className="compare-view__scroll" ref={scrollRef}>
          {Array.from({ length: maxPages }, (_, i) => {
            const marks = marksByPage.get(i)
            const n = countsByPage.get(i) ?? 0
            return (
              <CompareRow
                key={`${compare.leftGroupId}-${compare.rightGroupId}-${i}`}
                index={i}
                left={left}
                right={right}
                leftSize={diff?.pages[i]?.leftSize}
                rightSize={diff?.pages[i]?.rightSize}
                leftMarks={marks?.left ?? []}
                rightMarks={marks?.right ?? []}
                activeId={activeId}
                width={paneWidth}
                renderWidth={renderWidth}
                label={progress ? ' — vergelijken…' : n ? ` — ${n} wijziging${n === 1 ? '' : 'en'}` : ' — gelijk'}
              />
            )
          })}
          {maxPages === 0 && <p className="compare-view__empty">Kies links en rechts een document om te vergelijken.</p>}
        </div>

        {panelOpen && (
          <aside className="compare-side" aria-label="Wijzigingen">
            <div className="compare-side__head">
              <div className="compare-side__title">
                {progress ? (
                  <>
                    Vergelijken… pagina {progress.done} van {progress.total}
                  </>
                ) : diff ? (
                  <>
                    {visible.length} wijziging{visible.length === 1 ? '' : 'en'}
                    {visible.length !== counts.total ? <span className="compare-side__of"> van {counts.total}</span> : null}
                  </>
                ) : (
                  'Nog geen vergelijking'
                )}
              </div>
              <div className="compare-side__stepper">
                <button
                  type="button"
                  className="icon-btn icon-btn--chrome"
                  title="Vorige wijziging (Shift+F3)"
                  disabled={!visible.length}
                  onClick={() => step(-1)}
                >
                  <IconChevronLeft size={14} />
                </button>
                <span className="compare-side__position">
                  {visible.length ? `${activeIndex >= 0 ? activeIndex + 1 : '–'} / ${visible.length}` : '–'}
                </span>
                <button
                  type="button"
                  className="icon-btn icon-btn--chrome"
                  title="Volgende wijziging (F3)"
                  disabled={!visible.length}
                  onClick={() => step(1)}
                >
                  <IconChevronRight size={14} />
                </button>
              </div>
            </div>

            {progress && (
              <div className="compare-side__progress">
                <div
                  className="compare-side__progress-bar"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            )}

            <div className="compare-side__modes">
              <button
                type="button"
                className={`compare-mode${mode === 'all' ? ' compare-mode--active' : ''}`}
                onClick={() => setMode('all')}
              >
                Alles
              </button>
              <button
                type="button"
                className={`compare-mode${mode === 'numbers' ? ' compare-mode--active' : ''}`}
                title="Alleen bedragen en aantallen, met verschil en % mutatie"
                onClick={() => setMode('numbers')}
              >
                Alleen cijfers
              </button>
            </div>

            {mode === 'all' ? (
              <div className="compare-side__chips">
                {(
                  [
                    ['changed', 'Gewijzigd', counts.changed],
                    ['added', 'Toegevoegd', counts.added + counts.pagesAdded],
                    ['removed', 'Verwijderd', counts.removed + counts.pagesRemoved],
                    ['numbers', 'Cijfers', counts.numbers]
                  ] as [keyof DiffFilter, string, number][]
                ).map(([key, label, n]) => (
                  <button
                    key={key}
                    type="button"
                    className={`compare-chip compare-chip--${key}${filter[key] ? ' compare-chip--on' : ''}`}
                    title={`${label} aan- of uitzetten`}
                    aria-pressed={Boolean(filter[key])}
                    onClick={() => setFilter((f) => ({ ...f, [key]: !f[key] }))}
                  >
                    {filter[key] && <IconCheck size={11} />}
                    {label}
                    <span className="compare-chip__count">{n}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="compare-side__thresholds">
                <label>
                  Vanaf verschil
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={filter.minAmount || ''}
                    placeholder="0"
                    onChange={(e) => setFilter((f) => ({ ...f, minAmount: Math.max(0, Number(e.target.value) || 0) }))}
                  />
                </label>
                <label>
                  Vanaf mutatie %
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={filter.minPercent || ''}
                    placeholder="0"
                    onChange={(e) => setFilter((f) => ({ ...f, minPercent: Math.max(0, Number(e.target.value) || 0) }))}
                  />
                </label>
              </div>
            )}

            <label className="compare-side__toggle" title="Paginanummers, kantoornaam en bestandsnaam in de marge overslaan">
              <input
                type="checkbox"
                checked={filter.ignoreHeads}
                onChange={(e) => setFilter((f) => ({ ...f, ignoreHeads: e.target.checked }))}
              />
              Kop-/voetteksten negeren{headCount ? ` (${headCount})` : ''}
            </label>

            {sameDocument && (
              <p className="compare-side__note compare-side__note--warn">
                Links en rechts staat hetzelfde document. Kies bovenaan twee verschillende documenten (of open eerst de
                andere versie) om verschillen te zien.
              </p>
            )}

            {!sameDocument && pagesDiffer && (
              <p className="compare-side__note">
                Verschillend aantal pagina&apos;s: links {left?.pages.length}, rechts {right?.pages.length}. Pagina&apos;s
                worden één-op-één vergeleken, dus een ingevoegde pagina verschuift de rest.
              </p>
            )}

            <div className="compare-side__list" ref={listRef}>
              {!diff && !progress && <p className="compare-side__empty">Kies twee documenten om te vergelijken.</p>}
              {diff && !visible.length && (
                <p className="compare-side__empty">
                  {counts.total ? 'Geen wijzigingen binnen de gekozen filters.' : 'Geen verschillen gevonden.'}
                </p>
              )}
              {visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-list-id={c.id}
                  className={`change-item change-item--${c.kind}${activeId === c.id ? ' change-item--active' : ''}`}
                  title={changeTitle(c)}
                  onClick={() => goTo(c.id)}
                >
                  <span className="change-item__head">
                    <span className="change-item__kind">{KIND_LABELS[c.kind]}</span>
                    <span className="change-item__page">p. {c.page + 1}</span>
                  </span>
                  {c.kind === 'number' ? (
                    <span className="change-item__number">
                      <span className="change-item__label">{c.label || 'Getal'}</span>
                      <span className="change-item__values">
                        <span className="change-item__from">{formatDiffNumber(c.from)}</span>
                        <span className="change-item__arrow">→</span>
                        <span className="change-item__to">{formatDiffNumber(c.to)}</span>
                        {c.delta !== null && c.delta !== undefined && (
                          <span className={`change-item__delta${c.delta < 0 ? ' change-item__delta--down' : ''}`}>
                            {c.delta > 0 ? '+' : ''}
                            {formatDiffNumber(c.delta)}
                            {c.pct !== null && c.pct !== undefined ? ` · ${c.pct > 0 ? '+' : ''}${c.pct}%` : ''}
                          </span>
                        )}
                      </span>
                    </span>
                  ) : c.kind === 'changed' ? (
                    <span className="change-item__body">
                      <span className="change-item__old">{c.before}</span>
                      <span className="change-item__new">{c.after}</span>
                    </span>
                  ) : (
                    <span className="change-item__body">
                      <span className={c.kind === 'removed' || c.kind === 'page-removed' ? 'change-item__old' : 'change-item__new'}>
                        {c.after ?? c.before}
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
