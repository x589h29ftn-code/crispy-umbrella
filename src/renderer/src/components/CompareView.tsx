import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import {
  contentPointsToVisualPoints,
  getPdfMetadata,
  getPlacementVisualBox,
  renderThumbnail,
  visualPointToContentPoint,
  visualRectToContentRect,
  type PdfMetadata
} from '../lib/pdfRender'
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
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconComment,
  IconCursor,
  IconDownload,
  IconFile,
  IconFolderOpen,
  IconGridView,
  IconHighlighter,
  IconMinus,
  IconPlus
} from './icons'
import ScanNotice from './ScanNotice'
import type { DocGroup, HighlightAnnotation, PageComment, PageRef, SourceFile } from '../types'

/** Gereedschap in de vergelijker: kijken, markeren of een opmerking plaatsen. */
type CompareTool = 'view' | 'highlight' | 'comment'

/** Kleur van een markering die je in de vergelijker zet. */
const MARK_COLOR = '#ffd54a'
const MARK_OPACITY = 0.45

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
  renderWidth,
  tool
}: {
  page: PageRef | undefined
  size: { width: number; height: number } | undefined
  marks: Mark[]
  activeId: string | null
  width: number
  /** Resolutie waarop de pagina getekend wordt (volgt de zoom en het scherm). */
  renderWidth: number
  /** Actief gereedschap: kijken, markeren of een opmerking plaatsen. */
  tool: CompareTool
}): JSX.Element {
  const sources = useStudioStore((s) => s.sources)
  const addAnnotation = useStudioStore((s) => s.addAnnotation)
  const addComment = useStudioStore((s) => s.addComment)
  const [thumb, setThumb] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
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
      // Root = de scrollende strook, anders geldt de kijkmarge niet en zie je
      // bij het scrollen eerst grijze vlakken.
      { root: el.closest('.compare-view__scroll'), rootMargin: '1200px 0px' }
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

  // Eigen markeringen en opmerkingen die al op deze pagina staan, zodat je in de
  // vergelijking ziet wat je (of een collega) eerder heeft aangebracht.
  const [ownMarks, setOwnMarks] = useState<{ id: string; left: number; top: number; width: number; height: number; color: string; opacity: number }[]>([])
  const [pins, setPins] = useState<{ id: string; x: number; y: number; text: string; resolved: boolean }[]>([])
  useEffect(() => {
    let cancelled = false
    if (!source || !page) {
      setOwnMarks([])
      setPins([])
      return
    }
    const highlights = page.annotations.filter((a): a is HighlightAnnotation => a.type === 'highlight')
    Promise.all([
      Promise.all(
        highlights.map(async (a) => {
          const box = await getPlacementVisualBox(source, page.sourcePageIndex, page.rotation, a)
          return {
            id: a.id,
            left: box.pivotX,
            top: box.pivotY - box.height,
            width: box.width,
            height: box.height,
            color: a.color,
            opacity: a.opacity
          }
        })
      ),
      contentPointsToVisualPoints(
        source,
        page.sourcePageIndex,
        page.rotation,
        page.comments.map((c) => ({ x: c.x, y: c.y }))
      )
    ])
      .then(([boxes, points]) => {
        if (cancelled) return
        setOwnMarks(boxes)
        setPins(
          page.comments.map((c, i) => ({ id: c.id, x: points[i]?.x ?? 0, y: points[i]?.y ?? 0, text: c.text, resolved: c.resolved }))
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page])

  // --- Zelf markeren / een opmerking plaatsen ---
  const [band, setBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const bandStart = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; value: string } | null>(null)
  const editable = Boolean(page && source && tool !== 'view')

  function pointOf(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null {
    const el = pageRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!editable || tool !== 'highlight' || e.button !== 0) return
    const p = pointOf(e)
    if (!p) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    bandStart.current = p
    setBand({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!bandStart.current) return
    const p = pointOf(e)
    if (!p) return
    setBand({
      x1: bandStart.current.x,
      y1: bandStart.current.y,
      x2: Math.min(pageSize.width, Math.max(0, p.x)),
      y2: Math.min(pageSize.height, Math.max(0, p.y))
    })
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const finished = band
    bandStart.current = null
    setBand(null)
    if (!finished || !page || !source) return
    const left = Math.min(finished.x1, finished.x2)
    const top = Math.min(finished.y1, finished.y2)
    const w = Math.abs(finished.x2 - finished.x1)
    const h = Math.abs(finished.y2 - finished.y1)
    if (w * scale < 5 || h * scale < 5) return
    void visualRectToContentRect(source, page.sourcePageIndex, page.rotation, {
      xPct: left / pageSize.width,
      yPct: top / pageSize.height,
      wPct: w / pageSize.width,
      hPct: h / pageSize.height
    }).then((rect) => {
      const annotation: HighlightAnnotation = {
        id: nanoid(),
        type: 'highlight',
        ...rect,
        color: MARK_COLOR,
        opacity: MARK_OPACITY
      }
      addAnnotation(page.id, annotation)
    })
  }

  function onPaneClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (!editable || tool !== 'comment') return
    const p = pointOf(e)
    if (!p) return
    setDraft({ x: p.x, y: p.y, value: '' })
  }

  function commitDraft(): void {
    const d = draft
    setDraft(null)
    if (!d || !page || !source) return
    const text = d.value.trim()
    if (!text) return
    void visualPointToContentPoint(source, page.sourcePageIndex, page.rotation, d.x, d.y).then(({ x, y }) => {
      const comment: PageComment = { id: nanoid(), x, y, text, createdAt: Date.now(), resolved: false, replies: [] }
      addComment(page.id, comment)
    })
  }

  return (
    <div className="compare-pane" ref={rootRef}>
      <div
        ref={pageRef}
        className={`compare-pane__page${editable ? ` compare-pane__page--${tool}` : ''}`}
        style={{ width, height: pageSize.height * scale }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onPaneClick}
      >
        {thumb ? <img src={thumb} alt="" draggable={false} style={{ width }} /> : <div className="compare-pane__ph" />}
        {ownMarks.map((m) => (
          <div
            key={m.id}
            className="compare-annot"
            title="Markering in dit document"
            style={{
              left: m.left * scale,
              top: m.top * scale,
              width: m.width * scale,
              height: m.height * scale,
              background: m.color,
              opacity: m.opacity
            }}
          />
        ))}
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
        {pins.map((pin) => (
          <span
            key={pin.id}
            className={`comment-pin comment-pin--static${pin.resolved ? ' comment-pin--resolved' : ''}`}
            style={{ left: pin.x * scale, top: pin.y * scale }}
            title={pin.text}
          >
            <IconComment size={11} />
          </span>
        ))}
        {band && (
          <div
            className="highlight-band"
            style={{
              left: Math.min(band.x1, band.x2) * scale,
              top: Math.min(band.y1, band.y2) * scale,
              width: Math.abs(band.x2 - band.x1) * scale,
              height: Math.abs(band.y2 - band.y1) * scale,
              background: MARK_COLOR,
              opacity: MARK_OPACITY
            }}
          />
        )}
        {draft && (
          <div
            className="comment-thread compare-draft"
            style={{ left: draft.x * scale + 12, top: draft.y * scale + 6 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="comment-thread__head">
              <span className="comment-thread__time">Nieuwe opmerking</span>
              <button type="button" className="icon-btn icon-btn--chrome" title="Annuleren" onClick={() => setDraft(null)}>
                <IconClose size={12} />
              </button>
            </div>
            <textarea
              autoFocus
              className="comment-thread__textarea"
              placeholder="Typ je opmerking…"
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitDraft()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setDraft(null)
                }
              }}
            />
            <button
              type="button"
              className="pill-btn pill-btn--primary comment-thread__submit"
              disabled={!draft.value.trim()}
              onClick={commitDraft}
            >
              Plaatsen
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Eén paginapaar in de doorlopende vergelijking. Welke linkerpagina naast welke
 * rechterpagina staat komt uit de uitlijning, dus na een ingevoegde pagina
 * blijven de bij elkaar horende pagina's naast elkaar staan.
 */
function CompareRow({
  index,
  leftIndex,
  rightIndex,
  left,
  right,
  leftSize,
  rightSize,
  leftMarks,
  rightMarks,
  activeId,
  width,
  renderWidth,
  label,
  tool
}: {
  index: number
  leftIndex: number | null
  rightIndex: number | null
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
  tool: CompareTool
}): JSX.Element {
  const heading =
    leftIndex !== null && rightIndex !== null
      ? leftIndex === rightIndex
        ? `Pagina ${rightIndex + 1}`
        : `Pagina ${leftIndex + 1} ↔ ${rightIndex + 1}`
      : rightIndex !== null
        ? `Pagina ${rightIndex + 1} — nieuw`
        : `Pagina ${(leftIndex ?? 0) + 1} — vervallen`
  return (
    <div className="compare-row" data-page={index + 1}>
      <div className="compare-row__head">
        {heading}
        {label}
      </div>
      <div className="compare-row__panes">
        <ComparePane
          page={leftIndex === null ? undefined : left?.pages[leftIndex]}
          size={leftSize}
          marks={leftMarks}
          activeId={activeId}
          width={width}
          renderWidth={renderWidth}
          tool={tool}
        />
        <ComparePane
          page={rightIndex === null ? undefined : right?.pages[rightIndex]}
          size={rightSize}
          marks={rightMarks}
          activeId={activeId}
          width={width}
          renderWidth={renderWidth}
          tool={tool}
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
  /** Gereedschap: kijken, markeren of een opmerking plaatsen. */
  const [tool, setTool] = useState<CompareTool>('view')
  const [saveOpen, setSaveOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const left = groups.find((g) => g.id === compare.leftGroupId)
  const right = groups.find((g) => g.id === compare.rightGroupId)
  const maxPages = Math.max(left?.pages.length ?? 0, right?.pages.length ?? 0)

  /**
   * De rijen in beeld. Zodra de vergelijking klaar is volgen we de uitlijning
   * (pagina 4 links kan naast pagina 3 rechts staan); zolang die er nog niet is
   * zetten we de pagina's voorlopig één-op-één naast elkaar.
   */
  const rows = useMemo(
    () =>
      diff
        ? diff.pages.map((p) => ({ leftIndex: p.leftIndex, rightIndex: p.rightIndex }))
        : Array.from({ length: maxPages }, (_, i) => ({
            leftIndex: i < (left?.pages.length ?? 0) ? i : null,
            rightIndex: i < (right?.pages.length ?? 0) ? i : null
          })),
    [diff, maxPages, left?.pages.length, right?.pages.length]
  )

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

  const addToast = useStudioStore((s) => s.addToast)

  /**
   * Zet een markering (of opmerking) op de plek van een wijziging, in het
   * document zelf. Standaard in de nieuwe versie rechts; bij een vervallen
   * regel in de oude versie links, want daar staat de tekst nog.
   */
  const applyToChange = useCallback(
    async (c: ChangeEntry, what: 'mark' | 'comment'): Promise<void> => {
      const wantsLeft = !c.right && Boolean(c.left)
      const group = wantsLeft ? left : right
      const pageIndex = wantsLeft ? c.leftPage : c.rightPage
      const box = wantsLeft ? c.left : c.right
      const size = wantsLeft ? diff?.pages[c.page]?.leftSize : diff?.pages[c.page]?.rightSize
      const pageRef = group && pageIndex !== undefined ? group.pages[pageIndex] : undefined
      const source = pageRef ? sources.get(pageRef.sourceId) : undefined
      if (!box || !size || !pageRef || !source) {
        addToast('info', 'Deze wijziging heeft geen plek op een pagina om te markeren')
        return
      }
      const store = useStudioStore.getState()
      if (what === 'mark') {
        const pad = 1.5
        const rect = await visualRectToContentRect(source, pageRef.sourcePageIndex, pageRef.rotation, {
          xPct: (box.x - pad) / size.width,
          yPct: (box.y - pad) / size.height,
          wPct: (box.width + pad * 2) / size.width,
          hPct: (box.height + pad * 2) / size.height
        })
        store.addAnnotation(pageRef.id, {
          id: nanoid(),
          type: 'highlight',
          ...rect,
          color: MARK_COLOR,
          opacity: MARK_OPACITY
        })
        addToast('success', `Gemarkeerd in "${group?.name ?? ''}" op pagina ${(pageIndex ?? 0) + 1}`)
        return
      }
      const point = await visualPointToContentPoint(source, pageRef.sourcePageIndex, pageRef.rotation, box.x, box.y)
      store.addComment(pageRef.id, {
        id: nanoid(),
        x: point.x,
        y: point.y,
        text: changeTitle(c),
        createdAt: Date.now(),
        resolved: false,
        replies: []
      })
      addToast('success', `Opmerking geplaatst in "${group?.name ?? ''}" op pagina ${(pageIndex ?? 0) + 1}`)
    },
    [left, right, diff, sources, addToast]
  )

  /** Aantal eigen markeringen/opmerkingen in een document (voor de opslaan-knop). */
  const marksIn = useCallback(
    (group: DocGroup | undefined): number =>
      group
        ? group.pages.reduce((n, p) => n + p.annotations.filter((a) => a.type === 'highlight').length + p.comments.length, 0)
        : 0,
    []
  )

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
        {/* Zelf aantekeningen maken zonder de vergelijking te verlaten. */}
        <div className="compare-view__tools" role="group" aria-label="Gereedschap">
          {(
            [
              ['view', 'Bekijken', <IconCursor key="v" size={14} />, 'Bekijken: alleen kijken en navigeren'],
              [
                'highlight',
                'Markeren',
                <IconHighlighter key="h" size={14} />,
                'Markeren: sleep over de tekst — de markering komt in het document zelf'
              ],
              [
                'comment',
                'Opmerking',
                <IconComment key="c" size={14} />,
                'Opmerking: klik op een plek in het document om er een notitie bij te zetten'
              ]
            ] as [CompareTool, string, JSX.Element, string][]
          ).map(([key, label, icon, hint]) => (
            <button
              key={key}
              type="button"
              className={`pill-btn pill-btn--icon${tool === key ? ' pill-btn--primary' : ''}`}
              title={hint}
              aria-label={label}
              aria-pressed={tool === key}
              onClick={() => setTool(key)}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="compare-view__save">
          <button
            type="button"
            className="pill-btn"
            disabled={!left && !right}
            title="Opslaan en exporteren: het gemarkeerde document, het verschilrapport of jaar-op-jaar naar Excel"
            onClick={() => setSaveOpen((v) => !v)}
          >
            <IconDownload size={14} /> Opslaan
          </button>
          {saveOpen && (
            <div className="dropdown-menu compare-view__savemenu" onClick={(e) => e.stopPropagation()}>
              {[right, left]
                .filter((g): g is DocGroup => Boolean(g))
                .filter((g, i, arr) => arr.findIndex((x) => x.id === g.id) === i)
                .map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="dropdown-menu__item"
                    onClick={() => {
                      setSaveOpen(false)
                      void import('../lib/exportActions').then((m) => m.exportGroupPdf(g.id))
                    }}
                  >
                    <IconDownload size={13} />
                    <span className="dropdown-menu__ellipsis">
                      {g.id === right?.id ? 'Nieuwe versie' : 'Oude versie'}: {g.name}
                    </span>
                    <span className="compare-view__savecount">{marksIn(g)}</span>
                  </button>
                ))}
              <div className="compare-view__savehint">
                Markeringen en opmerkingen staan in het document zelf — ze blijven ook in het leestabblad staan.
              </div>
              <div className="dropdown-menu__divider" />
              <button
                type="button"
                className="dropdown-menu__item"
                disabled={!left || !right || !diff}
                title="Verschilrapport (PDF): de wijzigingen zoals ze nu in beeld staan, per hoofdstuk met inhoudsopgave"
                onClick={() => {
                  setSaveOpen(false)
                  if (left && right) void exportDiffReport(left, right, sources, visible)
                }}
              >
                <IconFile size={13} />
                <span className="dropdown-menu__ellipsis">Verschilrapport (PDF)</span>
              </button>
              <button
                type="button"
                className="dropdown-menu__item"
                disabled={!left || !right || !visible.some((c) => c.kind === 'number')}
                title="Jaar-op-jaar naar Excel: was, is, verschil en % mutatie — voor jaarrekeningen"
                onClick={() => {
                  setSaveOpen(false)
                  if (left && right) {
                    void import('../lib/yearCompare').then((m) => m.exportYearComparisonXlsx(left, right, visible))
                  }
                }}
              >
                <IconGridView size={13} />
                <span className="dropdown-menu__ellipsis">Jaar-op-jaar (Excel)</span>
              </button>
            </div>
          )}
        </div>
        <button type="button" className="pill-btn" title="Nog een document openen om te vergelijken" onClick={() => void addDocument()}>
          <IconFolderOpen size={14} /> Toevoegen
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
          {rows.map((row, i) => {
            const marks = marksByPage.get(i)
            const n = countsByPage.get(i) ?? 0
            return (
              <CompareRow
                key={`${compare.leftGroupId}-${compare.rightGroupId}-${i}`}
                index={i}
                leftIndex={row.leftIndex}
                rightIndex={row.rightIndex}
                left={left}
                right={right}
                leftSize={diff?.pages[i]?.leftSize}
                rightSize={diff?.pages[i]?.rightSize}
                leftMarks={marks?.left ?? []}
                rightMarks={marks?.right ?? []}
                activeId={activeId}
                width={paneWidth}
                renderWidth={renderWidth}
                tool={tool}
                label={progress ? ' — vergelijken…' : n ? ` — ${n} wijziging${n === 1 ? '' : 'en'}` : ' — gelijk'}
              />
            )
          })}
          {rows.length === 0 && <p className="compare-view__empty">Kies links en rechts een document om te vergelijken.</p>}
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
                Verschillend aantal pagina&apos;s: links {left?.pages.length}, rechts {right?.pages.length}. De pagina&apos;s
                worden bij elkaar gezocht op inhoud, dus een ingevoegde of vervallen pagina verschuift de rest niet — die
                staat als aparte wijziging in de lijst.
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
                <div
                  key={c.id}
                  data-list-id={c.id}
                  className={`change-item change-item--${c.kind}${activeId === c.id ? ' change-item--active' : ''}`}
                >
                  <div className="change-item__actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn--chrome"
                      title="Deze wijziging markeren in het document"
                      onClick={() => void applyToChange(c, 'mark')}
                    >
                      <IconHighlighter size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--chrome"
                      title="Opmerking bij deze wijziging plaatsen"
                      onClick={() => void applyToChange(c, 'comment')}
                    >
                      <IconComment size={12} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="change-item__main"
                    title={changeTitle(c)}
                    onClick={() => goTo(c.id)}
                  >
                  <span className="change-item__head">
                    <span className="change-item__kind">{KIND_LABELS[c.kind]}</span>
                    <span className="change-item__page">
                      p.{' '}
                      {c.leftPage !== undefined && c.rightPage !== undefined && c.leftPage !== c.rightPage
                        ? `${c.leftPage + 1}→${c.rightPage + 1}`
                        : (c.rightPage ?? c.leftPage ?? c.page) + 1}
                    </span>
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
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
