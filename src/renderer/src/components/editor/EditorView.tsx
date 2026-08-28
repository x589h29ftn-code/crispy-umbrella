import { useEffect, useMemo, useRef, useState } from 'react'
import { useStudioStore } from '../../store'
import { noteScroll } from '../../lib/scrollGate'
import { usePressDrag } from '../../hooks/usePressDrag'
import {
  getPageVisualSize,
  renderThumbnail,
  visualRectToSignaturePlacement
} from '../../lib/pdfRender'
import {
  ANNOTATION_FONT_LABELS,
  HIGHLIGHT_COLORS,
  TEXT_ALIGNMENTS,
  TEXT_COLOR_LABELS,
  INK_WIDTHS,
  TEXT_COLORS
} from '../../lib/annotationStyle'
import { ShapePreviewIcon, SHAPE_LABELS, STAMP_PRESETS } from '../../lib/shapes'
import { FIELD_KIND_HINTS, FIELD_KIND_LABELS, FIELD_KINDS } from '../../lib/formFields'
import type { AnnotationFont, FieldKind, PageRef, ShapeKind, SourceFile } from '../../types'
import EditorPage, { type EditorMode, type EditorSelection, type ToolSettings } from './EditorPage'
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconComment,
  IconBookmark,
  IconCalendar,
  IconCursor,
  IconEditText,
  IconCheckbox,
  IconDropdown,
  IconEraser,
  IconExpand,
  IconFieldPlus,
  IconForm,
  IconGridView,
  IconHash,
  IconHighlighter,
  IconMinus,
  IconMoonStars,
  IconPen,
  IconPlus,
  IconRadio,
  IconRedact,
  IconRotate,
  IconShapes,
  IconStamp,
  IconTrash,
  IconSignature,
  IconType
} from '../icons'

const DEFAULT_SIGNATURE_WIDTH_PCT = 0.28

/** Single-letter tool shortcuts in the editor (shown in the tooltips). */
const MODE_SHORTCUTS: Record<string, EditorMode> = {
  v: 'view',
  m: 'highlight',
  p: 'draw',
  s: 'shape',
  k: 'stamp',
  f: 'form',
  i: 'field',
  t: 'text',
  b: 'edittext',
  r: 'redact',
  c: 'comment',
  e: 'erase'
}

const MODE_KEY_LABEL: Partial<Record<EditorMode, string>> = Object.fromEntries(
  Object.entries(MODE_SHORTCUTS).map(([key, mode]) => [mode, key.toUpperCase()])
)

interface Props {
  groupId: string
}

/**
 * Small page thumbnail in the left rail; press-and-drag reorders the page.
 *
 * De miniatuur wordt pas getekend als hij (bijna) in beeld komt. Bij een
 * document van honderd pagina's werden voorheen alle honderd miniaturen meteen
 * gerenderd — dat was verreweg het duurste deel van het openen.
 */
function RailThumb({
  page,
  source,
  index,
  width,
  ratio,
  active,
  dragging,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRotate,
  onDelete
}: {
  page: PageRef
  source: SourceFile | undefined
  /** Breedte van de strook: bepaalt hoe scherp de miniatuur gerenderd wordt. */
  width: number
  /** Hoogte/breedte-verhouding voor de plaatshouder zolang er nog niets staat. */
  ratio: number
  index: number
  active: boolean
  dragging: boolean
  onClick: () => void
  onDragStart: (index: number) => void
  onDragMove: (clientY: number) => void
  onDragEnd: (commit: boolean) => void
  onRotate: () => void
  onDelete: () => void
}): JSX.Element {
  const [thumb, setThumb] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const drag = usePressDrag({
    ignoreSelector: '.editor-rail__act',
    onStart: () => {
      onDragStart(index)
    },
    onMove: (_x, y) => onDragMove(y),
    onEnd: () => onDragEnd(true),
    onCancel: () => onDragEnd(false)
  })

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), {
      root: el.closest('.editor-rail'),
      rootMargin: '700px 0px'
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!source || !near) return
    // Renderbreedte volgt de strook (op halve stappen, zodat slepen niet
    // bij elke pixel opnieuw rendert) en telt de schermdichtheid mee.
    const target = Math.round((Math.ceil(width / 40) * 40 - 24) * Math.min(2, window.devicePixelRatio || 1))
    renderThumbnail(source, page.sourcePageIndex, page.rotation, Math.max(120, target), () => cancelled)
      .then((url) => {
        if (!cancelled) setThumb(url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page.sourcePageIndex, page.rotation, width, near])

  const placeholderHeight = Math.round((width - 24) * ratio)
  return (
    <div
      ref={rootRef}
      className={`editor-rail__thumb${active ? ' editor-rail__thumb--active' : ''}${dragging ? ' editor-rail__thumb--dragging' : ''}`}
      title="Klik om te tonen; sleep om de pagina te verplaatsen"
      onClick={onClick}
      {...drag}
    >
      {thumb ? (
        <img src={thumb} alt={`Pagina ${index + 1}`} draggable={false} />
      ) : (
        <span className="editor-rail__ph" style={{ height: placeholderHeight }} />
      )}
      <span className="editor-rail__num">{index + 1}</span>
      {/* Snelacties zoals in Acrobat: verschijnen bij aanwijzen. */}
      <span className="editor-rail__acts">
        <button
          type="button"
          className="editor-rail__act"
          title={`Pagina ${index + 1} rechtsom draaien`}
          onClick={(e) => {
            e.stopPropagation()
            onRotate()
          }}
        >
          <IconRotate size={12} />
        </button>
        <button
          type="button"
          className="editor-rail__act editor-rail__act--danger"
          title={`Pagina ${index + 1} verwijderen`}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <IconTrash size={12} />
        </button>
      </span>
    </div>
  )
}

/** Pictogram per veldsoort in het formuliergereedschap. */
const FIELD_KIND_ICONS: Record<FieldKind, JSX.Element> = {
  text: <IconFieldPlus size={14} />,
  multiline: <IconType size={14} />,
  date: <IconCalendar size={14} />,
  amount: <IconHash size={14} />,
  checkbox: <IconCheckbox size={14} />,
  radio: <IconRadio size={14} />,
  dropdown: <IconDropdown size={14} />,
  signature: <IconSignature size={14} />
}

/** Uitlijnknoppen voor het tekstgereedschap. */
const ALIGN_OPTIONS = TEXT_ALIGNMENTS.map(({ key, label }) => ({
  key,
  label,
  icon:
    key === 'left' ? <IconAlignLeft size={14} /> : key === 'center' ? <IconAlignCenter size={14} /> : <IconAlignRight size={14} />
}))

/**
 * Tabbed editor view (Adobe-style): thumbnail rail left, scrollable pages in
 * the middle (continuous / two-up / single page at 100%), tools panel right.
 * Edits share the same project state as the Overzicht canvas.
 */
export default function EditorView({ groupId }: Props): JSX.Element | null {
  const group = useStudioStore((s) => s.groups.find((g) => g.id === groupId))
  const sources = useStudioStore((s) => s.sources)
  const viewMode = useStudioStore((s) => s.editorViewMode)
  const setViewMode = useStudioStore((s) => s.setEditorViewMode)
  const setActiveEditorTab = useStudioStore((s) => s.setActiveEditorTab)
  const signatureAssets = useStudioStore((s) => s.signatureAssets)
  const activeSignatureId = useStudioStore((s) => s.activeSignatureId)
  const setActiveSignature = useStudioStore((s) => s.setActiveSignature)
  const addSignaturePlacement = useStudioStore((s) => s.addSignaturePlacement)
  const updateAnnotation = useStudioStore((s) => s.updateAnnotation)
  const removeAnnotation = useStudioStore((s) => s.removeAnnotation)
  const markHistory = useStudioStore((s) => s.markHistory)
  const flattenForms = useStudioStore((s) => s.flattenForms)
  const setFlattenForms = useStudioStore((s) => s.setFlattenForms)
  const movePages = useStudioStore((s) => s.movePages)
  const rotatePages = useStudioStore((s) => s.rotatePages)
  const deletePages = useStudioStore((s) => s.deletePages)
  const insertBlankPage = useStudioStore((s) => s.insertBlankPage)
  const setDocPropertiesOpen = useStudioStore((s) => s.setDocPropertiesOpen)
  const presentationMode = useStudioStore((s) => s.presentationMode)
  const setPresentationMode = useStudioStore((s) => s.setPresentationMode)
  const bookmarksPanelOpen = useStudioStore((s) => s.bookmarksPanelOpen)
  const setBookmarksPanelOpen = useStudioStore((s) => s.setBookmarksPanelOpen)
  const nightMode = useStudioStore((s) => s.readerNightMode)
  const setNightMode = useStudioStore((s) => s.setReaderNightMode)
  // In volledig scherm kun je de miniaturenstrip los aan-/uitzetten (standaard
  // uit voor snelheid); de inhoudsopgave gebruikt het bestaande bladwijzerpaneel.
  const [presentThumbs, setPresentThumbs] = useState(false)
  const railWidth = useStudioStore((s) => s.railWidth)
  const setRailWidth = useStudioStore((s) => s.setRailWidth)
  const railCollapsed = useStudioStore((s) => s.railCollapsed)
  const setRailCollapsed = useStudioStore((s) => s.setRailCollapsed)
  const toolsCollapsed = useStudioStore((s) => s.toolsCollapsed)
  const setToolsCollapsed = useStudioStore((s) => s.setToolsCollapsed)
  const railResize = useRef<{ startX: number; startWidth: number } | null>(null)

  const [mode, setMode] = useState<EditorMode>('view')
  const [selection, setSelection] = useState<EditorSelection | null>(null)
  const zoom = useStudioStore((s) => s.editorZoom)
  const setZoom = useStudioStore((s) => s.setEditorZoom)
  const setDisplayScale = useStudioStore((s) => s.setEditorDisplayScale)
  const [currentPage, setCurrentPage] = useState(0)
  const [centerWidth, setCenterWidth] = useState(800)
  const [centerHeight, setCenterHeight] = useState(600)
  const [pageBaseSize, setPageBaseSize] = useState({ width: 595, height: 842 })
  const [sigPickerOpen, setSigPickerOpen] = useState(false)
  const centerRef = useRef<HTMLDivElement>(null)

  const [settings, setSettings] = useState<ToolSettings>({
    highlightColor: HIGHLIGHT_COLORS[0],
    highlightOpacity: 0.4,
    inkColor: HIGHLIGHT_COLORS[1],
    inkWidth: INK_WIDTHS[1],
    textFont: 'arial',
    textSize: 16,
    textBold: false,
    textItalic: false,
    textColor: TEXT_COLORS[0],
    textAlign: 'left',
    textUnderline: false,
    textStrike: false,
    shapeKind: 'arrow',
    shapeColor: TEXT_COLORS[1],
    shapeWidth: INK_WIDTHS[1],
    stampKey: STAMP_PRESETS[0].key,
    fieldKind: 'text',
    fieldLabel: '',
    fieldGroup: 'Keuze',
    fieldOptions: '',
    fieldRequired: false
  })

  const selectedAnnotation = useMemo(() => {
    if (!selection || !group) return null
    const page = group.pages.find((p) => p.id === selection.pageId)
    return page?.annotations.find((a) => a.id === selection.annotationId) ?? null
  }, [selection, group])

  useEffect(() => {
    const el = centerRef.current
    if (!el) return
    const measure = (): void => {
      setCenterWidth(el.clientWidth)
      setCenterHeight(el.clientHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Page proportions of the current page, used to fit single/spread views.
  useEffect(() => {
    let cancelled = false
    const page = group?.pages[currentPage]
    const source = page && sources.get(page.sourceId)
    if (!page || !source) return
    getPageVisualSize(source, page.sourcePageIndex, page.rotation)
      .then((size) => {
        if (!cancelled) setPageBaseSize(size)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [group, currentPage, sources])

  useEffect(() => {
    if (group && currentPage >= group.pages.length) setCurrentPage(Math.max(0, group.pages.length - 1))
  }, [group, currentPage])

  // Delete removes the selected annotation; Escape leaves the active tool;
  // single letters switch tools (see the tooltips in the tools panel).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        removeAnnotation(selection.pageId, selection.annotationId)
        setSelection(null)
        return
      }
      if (e.key === 'Escape') {
        if (useStudioStore.getState().presentationMode) setPresentationMode(false)
        else if (mode !== 'view') setMode('view')
        else setSelection(null)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const toolMode = MODE_SHORTCUTS[e.key.toLowerCase()]
      if (toolMode) {
        e.preventDefault()
        setMode(toolMode)
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, mode, removeAnnotation])

  // --- Paginateller: waar sta ik, en spring naar een pagina ---
  const pageInputRef = useRef<HTMLInputElement>(null)
  const [pageInput, setPageInput] = useState('1')
  useEffect(() => setPageInput(String(currentPage + 1)), [currentPage])

  /** Springt naar een pagina (0-gebaseerd): scrollt of bladert, al naar gelang de weergave. */
  function goToPage(index: number): void {
    const total = group?.pages.length ?? 0
    if (!total) return
    const target = Math.max(0, Math.min(total - 1, index))
    setCurrentPage(target)
    const page = group?.pages[target]
    if (page && viewModeRef.current === 'scroll') {
      // Een sprong van een paar pagina's mag zacht scrollen; over tientallen
      // pagina's duurt dat te lang — dan spring je er direct heen.
      const far = Math.abs(target - currentPage) > 3
      document
        .querySelector(`.editor-view .editor-page[data-page-id="${page.id}"]`)
        ?.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'start' })
    }
  }


  // Ctrl+G zet de cursor in het paginaveld (zoals "Ga naar pagina" in Acrobat).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        pageInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Rail drag-reorder state: which thumb is being dragged and where it lands.
  const [railDrag, setRailDrag] = useState<{ fromIndex: number; toIndex: number } | null>(null)
  const railDragRef = useRef<{ fromIndex: number; toIndex: number } | null>(null)
  railDragRef.current = railDrag

  function railIndexFromY(clientY: number): number {
    const thumbs = Array.from(document.querySelectorAll('.editor-view .editor-rail__thumb'))
    for (let i = 0; i < thumbs.length; i += 1) {
      const rect = thumbs[i].getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return i
    }
    return thumbs.length
  }

  // Terwijl er gescrold wordt, tekenen de pagina's alleen een snelle
  // voorvertoning (zie lib/scrollGate). Passieve listener: het scrollen zelf
  // blijft daarmee volledig aan de browser.
  useEffect(() => {
    const el = centerRef.current?.querySelector('.editor-pages') as HTMLElement | null
    if (!el) return
    el.addEventListener('scroll', noteScroll, { passive: true })
    return () => el.removeEventListener('scroll', noteScroll)
  }, [viewMode])

  // Ctrl+wheel zooms (smooth, proportional to scroll speed); a plain wheel in
  // the single/spread views flips pages when there's nothing left to scroll,
  // while normal scrolling inside a zoomed page keeps working.
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const pageCountRef = useRef(0)
  pageCountRef.current = group?.pages.length ?? 0
  const lastFlipRef = useRef(0)
  useEffect(() => {
    const el = centerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        // Exponential in deltaY: small ticks nudge, fast wheels move quickly.
        setZoom((z) => Math.min(5, Math.max(0.3, z * Math.exp(-e.deltaY * 0.0022))))
        return
      }
      const vm = viewModeRef.current
      if (vm !== 'single' && vm !== 'spread') return
      const scroller = el.querySelector('.editor-pages') as HTMLElement | null
      // Kleine overschrijding (padding rond een passend gemaakte pagina) telt
      // niet als scrollbaar — anders blijft de eerste wheel-tik "hangen".
      const canScroll = scroller && scroller.scrollHeight > scroller.clientHeight + 28
      if (canScroll && scroller) {
        const atTop = scroller.scrollTop <= 1
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
        if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) return // normal scroll
      }
      // Page flip, debounced so one wheel gesture flips once.
      const now = performance.now()
      if (now - lastFlipRef.current < 350 || Math.abs(e.deltaY) < 4) return
      lastFlipRef.current = now
      e.preventDefault()
      const step = vm === 'spread' ? 2 : 1
      setCurrentPage((p) => {
        const max = Math.max(0, pageCountRef.current - 1)
        const next = e.deltaY > 0 ? p + step : p - step
        return Math.max(0, Math.min(max, next))
      })
      if (scroller) scroller.scrollTop = e.deltaY > 0 ? 0 : scroller.scrollHeight
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Signature: press-and-drag from the panel onto a page.
  const [trayGhost, setTrayGhost] = useState<{ x: number; y: number } | null>(null)
  const trayPosRef = useRef<{ x: number; y: number } | null>(null)
  const trayDrag = usePressDrag({
    ignoreSelector: 'button',
    onStart: (e) => {
      trayPosRef.current = { x: e.clientX, y: e.clientY }
      setTrayGhost(trayPosRef.current)
    },
    onMove: (x, y) => {
      trayPosRef.current = { x, y }
      setTrayGhost({ x, y })
    },
    onEnd: () => {
      const pos = trayPosRef.current
      setTrayGhost(null)
      if (pos) void dropSignatureAt(pos.x, pos.y)
    },
    onCancel: () => setTrayGhost(null)
  })

  const activeSignature = signatureAssets.find((a) => a.id === activeSignatureId) ?? signatureAssets[0] ?? null

  async function dropSignatureAt(clientX: number, clientY: number): Promise<void> {
    if (!activeSignature || !group) return
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.editor-page[data-page-id]')
    const img = el?.querySelector('img')
    if (!el || !img) return
    const pageId = el.dataset.pageId!
    const page = group.pages.find((p) => p.id === pageId)
    const source = page && sources.get(page.sourceId)
    if (!page || !source) return
    const rect = img.getBoundingClientRect()
    const size = await getPageVisualSize(source, page.sourcePageIndex, page.rotation)
    const scale = rect.width / size.width
    const dropVisualX = (clientX - rect.left) / scale
    const dropVisualY = (clientY - rect.top) / scale
    const wPct = DEFAULT_SIGNATURE_WIDTH_PCT
    const aspect = activeSignature.naturalHeight / activeSignature.naturalWidth
    const hPct = (wPct * size.width * aspect) / size.height
    const placement = await visualRectToSignaturePlacement(
      source,
      page.sourcePageIndex,
      page.rotation,
      {
        xPct: dropVisualX / size.width - wPct / 2,
        yPct: dropVisualY / size.height - hPct / 2,
        wPct,
        hPct
      },
      activeSignature.dataUrl
    )
    addSignaturePlacement(page.id, placement)
  }

  function patchSelected(patch: Record<string, unknown>): void {
    if (selection && selectedAnnotation) {
      markHistory()
      updateAnnotation(selection.pageId, selection.annotationId, patch)
    }
  }

  const shownHighlightColor =
    selectedAnnotation?.type === 'highlight' ? selectedAnnotation.color : settings.highlightColor
  const shownHighlightOpacity =
    selectedAnnotation?.type === 'highlight' ? selectedAnnotation.opacity : settings.highlightOpacity
  const shownInkColor = selectedAnnotation?.type === 'ink' ? selectedAnnotation.color : settings.inkColor
  const shownInkWidth = selectedAnnotation?.type === 'ink' ? selectedAnnotation.strokeWidth : settings.inkWidth
  const shownText = selectedAnnotation?.type === 'text' ? selectedAnnotation : null

  const showHighlight = mode === 'highlight' || selectedAnnotation?.type === 'highlight'
  const showInk = mode === 'draw' || selectedAnnotation?.type === 'ink'
  const showText = mode === 'text' || mode === 'edittext' || selectedAnnotation?.type === 'text'
  const showShape = mode === 'shape' || selectedAnnotation?.type === 'shape'
  const showStamp = mode === 'stamp'
  const shownShape = selectedAnnotation?.type === 'shape' ? selectedAnnotation : null
  const shownField = selectedAnnotation?.type === 'field' ? selectedAnnotation : null
  const showField = mode === 'field' || Boolean(shownField)
  /** Welke veldsoort de instellingen laten zien: die van het gekozen veld, anders het gereedschap. */
  const activeFieldKind: FieldKind = shownField?.fieldKind ?? settings.fieldKind

  // Single/spread fit the window like a real reader: zoom 1 = the page(s)
  // exactly fill the available space (no dead margins), zooming multiplies.
  const gap = 28
  const aspect = pageBaseSize.height / Math.max(1, pageBaseSize.width)
  const fitHeight = Math.max(200, centerHeight - 118) // minus view bar + pages padding
  const singleFit = Math.max(160, Math.min(centerWidth - gap * 2, fitHeight / aspect))
  const spreadFit = Math.max(140, Math.min((centerWidth - gap * 3) / 2, fitHeight / aspect))
  /** Breedte van een pagina bij zoom 1 in de huidige weergave. */
  // Doorlopend: zoom 1 = precies passend op de breedte, zodat de zoomkeuze bij
  // het openen op "Passend op breedte" staat in plaats van een los percentage.
  const unitWidth =
    viewMode === 'single' ? singleFit : viewMode === 'spread' ? spreadFit : Math.max(220, centerWidth - gap * 2)
  const pageWidth = Math.max(160, unitWidth * zoom)
  /** Werkelijke weergaveschaal: 100% = één PDF-punt op één beeldpunt, zoals in Acrobat. */
  const displayScale = pageWidth / Math.max(1, pageBaseSize.width)
  /** Zoom die nodig is voor een gewenste weergaveschaal. */
  const zoomForScale = (scale: number): number =>
    Math.min(5, Math.max(0.3, (scale * pageBaseSize.width) / Math.max(1, unitWidth)))
  const fitWidthScale = Math.max(0.05, (centerWidth - gap * 2) / Math.max(1, pageBaseSize.width))
  const fitPageScale = Math.max(0.05, fitHeight / aspect / Math.max(1, pageBaseSize.width))
  const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.012
  const zoomChoice = near(displayScale, fitWidthScale)
    ? 'fit-width'
    : near(displayScale, fitPageScale)
      ? 'fit-page'
      : (ZOOM_PRESETS.find((p) => near(displayScale, p))?.toString() ?? 'custom')

  // In de doorlopende weergave volgt de teller het scrollen: de bovenste pagina
  // die nog in beeld staat is "de pagina waar je bent".
  useEffect(() => {
    if (viewMode !== 'scroll') return
    const el = centerRef.current?.querySelector('.editor-pages') as HTMLElement | null
    if (!el) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const line = el.getBoundingClientRect().top + 80
      const pages = Array.from(el.querySelectorAll('.editor-page')) as HTMLElement[]
      let best = 0
      for (let i = 0; i < pages.length; i += 1) {
        if (pages[i].getBoundingClientRect().top <= line) best = i
        else break
      }
      setCurrentPage((p) => (p === best ? p : best))
    }
    const onScroll = (): void => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
    // pageWidth staat erbij: na zoomen verschuiven de pagina's, dus dan moet de
    // teller opnieuw kijken waar je bent.
  }, [viewMode, group?.pages.length, pageWidth])

  // De statusbalk toont dezelfde schaal als de balk boven het document.
  useEffect(() => {
    setDisplayScale(displayScale)
  }, [displayScale, setDisplayScale])

  const spreadStart = currentPage - (currentPage % 2)
  const pages = group?.pages ?? []
  const visiblePages =
    viewMode === 'single'
      ? [pages[currentPage]].filter(Boolean)
      : viewMode === 'spread'
        ? pages.slice(spreadStart, spreadStart + 2)
        : pages

  const MODES: { key: EditorMode; label: string; icon: JSX.Element; title: string; tone: string }[] = [
    { key: 'view', label: 'Selecteren', icon: <IconCursor size={15} />, title: 'Selecteren en verplaatsen', tone: 'slate' },
    {
      key: 'highlight',
      label: 'Markeren',
      icon: <IconHighlighter size={15} />,
      title: 'Sleep een vak over de tekst',
      tone: 'amber'
    },
    { key: 'draw', label: 'Tekenen', icon: <IconPen size={15} />, title: 'Vrij tekenen of schrijven', tone: 'violet' },
    {
      key: 'shape',
      label: 'Vormen',
      icon: <IconShapes size={15} />,
      title: 'Sleep een pijl, lijn, rechthoek of ovaal',
      tone: 'violet'
    },
    {
      key: 'stamp',
      label: 'Stempel',
      icon: <IconStamp size={15} />,
      title: 'Klik op de pagina om een stempel te plaatsen',
      tone: 'green'
    },
    {
      key: 'form',
      label: 'Formulier',
      icon: <IconForm size={15} />,
      title: 'Vul formuliervelden in dit document in',
      tone: 'teal'
    },
    {
      key: 'field',
      label: 'Invulveld',
      icon: <IconFieldPlus size={15} />,
      title: 'Formulier bouwen: sleep een vak of klik om een invulveld te plaatsen',
      tone: 'teal'
    },
    {
      key: 'text',
      label: 'Tekst',
      icon: <IconType size={15} />,
      title: 'Klik op de pagina om tekst te plaatsen',
      tone: 'blue'
    },
    {
      key: 'edittext',
      label: 'Tekst bewerken',
      icon: <IconEditText size={15} />,
      title: 'Klik op een bestaande tekstregel',
      tone: 'blue'
    },
    {
      key: 'redact',
      label: 'Redigeren',
      icon: <IconRedact size={15} />,
      title: 'Zwartlakken — inhoud verdwijnt echt bij export',
      tone: 'red'
    },
    {
      key: 'comment',
      label: 'Commentaar',
      icon: <IconComment size={15} />,
      title: 'Klik op de pagina voor een opmerking',
      tone: 'amber'
    },
    {
      key: 'erase',
      label: 'Gum',
      icon: <IconEraser size={15} />,
      title: 'Klik op een getekende lijn om te wissen',
      tone: 'slate'
    }
  ]

  // Pas hier stoppen: alle hooks hierboven draaien altijd, ook als het document
  // net gesloten of gesplitst is (anders klopt de hook-volgorde van React niet).
  if (!group) return null

  return (
    <div
      className={`editor-view${presentationMode ? ' editor-view--presentation' : ''}${
        presentationMode && presentThumbs ? ' editor-view--present-thumbs' : ''
      }`}
    >
      {presentationMode && (
        <button
          type="button"
          className="pill-btn presentation-exit"
          onClick={() => setPresentationMode(false)}
          title="Volledig scherm afsluiten (Esc)"
        >
          <IconClose size={13} /> Volledig scherm afsluiten
        </button>
      )}
      {presentationMode && (
        <div className="presentation-panels">
          <button
            type="button"
            className={`pill-btn${presentThumbs ? ' pill-btn--primary' : ''}`}
            onClick={() => setPresentThumbs((v) => !v)}
            title="Miniaturen tonen/verbergen"
          >
            <IconGridView size={13} /> Miniaturen
          </button>
          <button
            type="button"
            className={`pill-btn${bookmarksPanelOpen ? ' pill-btn--primary' : ''}`}
            onClick={() => setBookmarksPanelOpen(!bookmarksPanelOpen)}
            title="Inhoudsopgave tonen/verbergen"
          >
            <IconBookmark size={13} /> Inhoud
          </button>
        </div>
      )}
      {presentationMode && (
        <div className="presentation-zoom" title="Zoom (of Ctrl+scrollen)">
          <button type="button" className="pill-btn pill-btn--icon" onClick={() => setZoom((z) => Math.max(0.3, z / 1.2))} title="Uitzoomen">
            <IconMinus size={14} />
          </button>
          <button type="button" className="toolbar__zoom-pct" onClick={() => setZoom(1)} title="Zoom herstellen">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="pill-btn pill-btn--icon" onClick={() => setZoom((z) => Math.min(5, z * 1.2))} title="Inzoomen">
            <IconPlus size={14} />
          </button>
        </div>
      )}
      {/* De miniatuurstrip is duur om te tekenen; in volledig scherm laten we
          hem standaard weg (dat scheelt bij grote documenten flink in snelheid),
          maar met de knop "Miniaturen" toont de gebruiker hem daar alsnog. */}
      {(!presentationMode || presentThumbs) && railCollapsed && (
        <button
          type="button"
          className="editor-rail-restore"
          title="Miniaturen tonen"
          onClick={() => setRailCollapsed(false)}
        >
          <IconChevronRight size={14} />
        </button>
      )}
      {(!presentationMode || presentThumbs) && !railCollapsed && (
      <div className="editor-rail" style={{ width: railWidth }}>
        <div className="editor-rail__head">
          <span className="editor-rail__title">Pagina's</span>
          <button
            type="button"
            className="icon-btn icon-btn--chrome"
            title="Miniaturen kleiner"
            disabled={railWidth <= 90}
            onClick={() => setRailWidth(railWidth - 40)}
          >
            <IconMinus size={13} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--chrome"
            title="Miniaturen groter"
            disabled={railWidth >= 420}
            onClick={() => setRailWidth(railWidth + 40)}
          >
            <IconPlus size={13} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--chrome"
            title="Miniaturen inklappen"
            onClick={() => setRailCollapsed(true)}
          >
            <IconChevronLeft size={14} />
          </button>
        </div>
        <div
          className="editor-rail__resizer"
          title="Sleep om de miniaturen breder of smaller te maken"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            railResize.current = { startX: e.clientX, startWidth: railWidth }
          }}
          onPointerMove={(e) => {
            const drag = railResize.current
            if (drag) setRailWidth(drag.startWidth + (e.clientX - drag.startX))
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
            railResize.current = null
          }}
        />
        {group.pages.map((page, i) => (
          <div key={page.id} className="editor-rail__slot">
            {railDrag && railDrag.toIndex === i && <div className="editor-rail__indicator" />}
            <RailThumb
              page={page}
              source={sources.get(page.sourceId)}
              index={i}
              width={railWidth}
              ratio={pageBaseSize.height / pageBaseSize.width}
              onRotate={() => rotatePages([page.id])}
              onDelete={() => deletePages([page.id])}
              active={
                viewMode === 'single'
                  ? i === currentPage
                  : viewMode === 'spread'
                    ? i === spreadStart || i === spreadStart + 1
                    : false
              }
              dragging={railDrag?.fromIndex === i}
              onClick={() => {
                setCurrentPage(i)
                if (viewMode === 'scroll')
                  document
                    .querySelector(`.editor-view .editor-page[data-page-id="${page.id}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              onDragStart={(fromIndex) => setRailDrag({ fromIndex, toIndex: fromIndex })}
              onDragMove={(clientY) =>
                setRailDrag((cur) => (cur ? { ...cur, toIndex: railIndexFromY(clientY) } : cur))
              }
              onDragEnd={(commit) => {
                const cur = railDragRef.current
                setRailDrag(null)
                if (commit && cur && group && cur.toIndex !== cur.fromIndex && cur.toIndex !== cur.fromIndex + 1) {
                  movePages([group.pages[cur.fromIndex].id], group.id, cur.toIndex)
                }
              }}
            />
          </div>
        ))}
        {railDrag && railDrag.toIndex === group.pages.length && <div className="editor-rail__indicator" />}
      </div>
      )}

      <div className="editor-center" ref={centerRef}>
        <div className="editor-center__bar">
          {/* Weergave als compacte keuzelijst (zoals "Paginaweergave" in Acrobat):
              scheelt ruimte, zodat de balk op een laptopscherm op één regel past. */}
          <select
            className="editor-center__viewselect"
            value={viewMode}
            aria-label="Paginaweergave"
            title="Hoe de pagina's worden getoond"
            onChange={(e) => {
              const v = e.target.value as 'scroll' | 'spread' | 'single'
              setViewMode(v)
              if (v !== 'scroll') setZoom(1)
            }}
          >
            <option value="scroll">Doorlopend</option>
            <option value="single">Eén pagina</option>
            <option value="spread">Twee pagina&apos;s</option>
          </select>
          {/* Paginateller zoals in Acrobat: waar ben ik, en spring ergens heen (Ctrl+G). */}
          <div className="editor-center__pages" title="Paginanummer — typ een nummer en druk op Enter (Ctrl+G)">
            <button
              type="button"
              className="pill-btn pill-btn--icon"
              disabled={currentPage === 0}
              onClick={() => goToPage(currentPage - (viewMode === 'spread' ? 2 : 1))}
              title="Vorige pagina"
            >
              <IconChevronLeft size={14} />
            </button>
            <input
              ref={pageInputRef}
              className="editor-center__pageinput"
              value={pageInput}
              inputMode="numeric"
              aria-label="Paginanummer"
              onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  goToPage(Number(pageInput) - 1)
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setPageInput(String(currentPage + 1))
                  e.currentTarget.blur()
                }
              }}
              onBlur={() => setPageInput(String(currentPage + 1))}
            />
            <span className="editor-center__pagetotal">
              {viewMode === 'spread' && group.pages.length > spreadStart + 1 ? `–${spreadStart + 2}` : ''} /{' '}
              {group.pages.length}
            </span>
            <button
              type="button"
              className="pill-btn pill-btn--icon"
              disabled={currentPage >= group.pages.length - 1}
              onClick={() => goToPage(currentPage + (viewMode === 'spread' ? 2 : 1))}
              title="Volgende pagina"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
          <div className="editor-center__zoom" title="Zoom (of Ctrl+scrollen)">
            <button
              type="button"
              className="pill-btn pill-btn--icon"
              title="Uitzoomen"
              onClick={() => setZoom((z) => Math.max(0.3, z / 1.2))}
            >
              <IconMinus size={13} />
            </button>
            <select
              className="editor-center__zoomselect"
              value={zoomChoice}
              aria-label="Zoomniveau"
              onChange={(e) => {
                const v = e.target.value
                if (v === 'fit-width') setZoom(zoomForScale(fitWidthScale))
                else if (v === 'fit-page') setZoom(zoomForScale(fitPageScale))
                else setZoom(zoomForScale(Number(v)))
              }}
            >
              <option value="fit-width">Paginabreedte</option>
              <option value="fit-page">Hele pagina</option>
              {ZOOM_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {Math.round(p * 100)}%
                </option>
              ))}
              {zoomChoice === 'custom' && <option value="custom">{Math.round(displayScale * 100)}%</option>}
            </select>
            <button
              type="button"
              className="pill-btn pill-btn--icon"
              title="Inzoomen"
              onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
            >
              <IconPlus size={13} />
            </button>
          </div>
          <button
            type="button"
            className={`pill-btn pill-btn--icon editor-center__night${nightMode ? ' pill-btn--active' : ''}`}
            onClick={() => setNightMode(!nightMode)}
            title="Nachtmodus: kleuren omkeren voor comfortabel lezen (niet in de export)"
          >
            <IconMoonStars size={14} />
          </button>
          <button
            type="button"
            className="pill-btn pill-btn--icon editor-center__present"
            onClick={() => setPresentationMode(true)}
            title="Volledig scherm / presentatiemodus (Esc om te sluiten)"
          >
            <IconExpand size={14} />
          </button>
        </div>

        <div className={`editor-pages editor-pages--${viewMode}`}>
          {visiblePages.map((page) => (
            <EditorPage
              key={page.id}
              page={page}
              pageNumber={group.pages.indexOf(page) + 1}
              source={sources.get(page.sourceId)}
              cssWidth={pageWidth}
              fallbackRatio={pageBaseSize ? pageBaseSize.height / pageBaseSize.width : undefined}
              mode={mode}
              settings={settings}
              selection={selection}
              onSelect={setSelection}
            />
          ))}
        </div>
      </div>

      {toolsCollapsed && (
        <button
          type="button"
          className="editor-tools-restore"
          title="Gereedschap tonen"
          onClick={() => setToolsCollapsed(false)}
        >
          <IconChevronLeft size={14} />
        </button>
      )}
      <aside className={`editor-tools${toolsCollapsed ? ' editor-tools--collapsed' : ''}`}>
        <div className="editor-tools__title">
          <span>Gereedschap</span>
          <button
            type="button"
            className="icon-btn icon-btn--chrome"
            title="Gereedschap inklappen"
            onClick={() => setToolsCollapsed(true)}
          >
            <IconChevronRight size={14} />
          </button>
        </div>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`editor-tools__btn tone-${m.tone}${mode === m.key ? ' editor-tools__btn--active' : ''}`}
            title={`${m.title}${MODE_KEY_LABEL[m.key] ? ` — sneltoets ${MODE_KEY_LABEL[m.key]}` : ''}`}
            onClick={() => {
              setMode((cur) => (cur === m.key && m.key !== 'view' ? 'view' : m.key))
              setSelection(null)
            }}
          >
            {m.icon}
            <span>{m.label}</span>
            {MODE_KEY_LABEL[m.key] && <kbd className="editor-tools__key">{MODE_KEY_LABEL[m.key]}</kbd>}
          </button>
        ))}

        {(showHighlight || showInk || showText || showShape || showStamp || showField) && (
          <div className="editor-tools__divider" />
        )}

        {showShape && (
          <div className="editor-tools__settings">
            <div className="editor-tools__shapes">
              {(Object.keys(SHAPE_LABELS) as ShapeKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`editbar__toggle${(shownShape?.shape ?? settings.shapeKind) === kind ? ' editbar__toggle--active' : ''}`}
                  title={SHAPE_LABELS[kind]}
                  onClick={() => {
                    setSettings((s) => ({ ...s, shapeKind: kind }))
                    if (shownShape) patchSelected({ shape: kind })
                  }}
                >
                  <ShapePreviewIcon kind={kind} />
                </button>
              ))}
            </div>
            <div className="editor-tools__swatches">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${(shownShape?.color ?? settings.shapeColor) === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  onClick={() => {
                    setSettings((s) => ({ ...s, shapeColor: color }))
                    if (shownShape) patchSelected({ color })
                  }}
                />
              ))}
            </div>
            <div className="editbar__widths">
              {INK_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  className={`editbar__width${(shownShape?.strokeWidth ?? settings.shapeWidth) === width ? ' editbar__width--active' : ''}`}
                  onClick={() => {
                    setSettings((s) => ({ ...s, shapeWidth: width }))
                    if (shownShape) patchSelected({ strokeWidth: width })
                  }}
                >
                  <span style={{ width: 4 + width * 2, height: 4 + width * 2 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {showField && (
          <div className="editor-tools__settings">
            <div className="editor-tools__fields">
              {FIELD_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`field-chip${activeFieldKind === kind ? ' field-chip--active' : ''}`}
                  title={FIELD_KIND_HINTS[kind]}
                  onClick={() => {
                    setSettings((s) => ({ ...s, fieldKind: kind }))
                    if (shownField) patchSelected({ fieldKind: kind })
                  }}
                >
                  {FIELD_KIND_ICONS[kind]}
                  <span>{FIELD_KIND_LABELS[kind]}</span>
                </button>
              ))}
            </div>
            <input
              type="text"
              className="editor-tools__input"
              placeholder={`Label (${FIELD_KIND_LABELS[activeFieldKind]})`}
              title="Het opschrift bij het veld; ook de veldnaam in de PDF"
              value={shownField ? shownField.label : settings.fieldLabel}
              onChange={(e) => {
                const label = e.target.value
                if (shownField) patchSelected({ label })
                else setSettings((s) => ({ ...s, fieldLabel: label }))
              }}
            />
            {activeFieldKind === 'radio' && (
              <input
                type="text"
                className="editor-tools__input"
                placeholder="Groepsnaam (bv. Akkoord)"
                title="Keuzerondjes met dezelfde groepsnaam sluiten elkaar uit"
                value={shownField ? (shownField.group ?? '') : settings.fieldGroup}
                onChange={(e) => {
                  const group = e.target.value
                  if (shownField) patchSelected({ group })
                  else setSettings((s) => ({ ...s, fieldGroup: group }))
                }}
              />
            )}
            {(activeFieldKind === 'dropdown' || activeFieldKind === 'radio') && (
              <input
                type="text"
                className="editor-tools__input"
                placeholder={activeFieldKind === 'radio' ? 'Waarde van dit rondje' : 'Keuzes, met komma’s'}
                title={
                  activeFieldKind === 'radio'
                    ? 'De waarde die deze keuze in de PDF krijgt'
                    : 'De keuzes in de lijst, gescheiden door komma’s'
                }
                value={shownField ? (shownField.options ?? []).join(', ') : settings.fieldOptions}
                onChange={(e) => {
                  const text = e.target.value
                  if (shownField) {
                    patchSelected({
                      options: text
                        .split(/[,;]/)
                        .map((o) => o.trim())
                        .filter(Boolean)
                    })
                  } else {
                    setSettings((s) => ({ ...s, fieldOptions: text }))
                  }
                }}
              />
            )}
            {activeFieldKind !== 'signature' && (
              <label className="editbar__checkbox" title="De ontvanger moet dit veld invullen">
                <input
                  type="checkbox"
                  checked={shownField ? Boolean(shownField.required) : settings.fieldRequired}
                  onChange={(e) => {
                    const required = e.target.checked
                    if (shownField) patchSelected({ required })
                    else setSettings((s) => ({ ...s, fieldRequired: required }))
                  }}
                />
                Verplicht invullen
              </label>
            )}
            <div className="editor-tools__hint">
              {shownField
                ? 'Sleep het vak om het te verplaatsen, of trek het hoekje groter.'
                : 'Sleep een vak op de pagina, of klik voor een veld op standaardformaat. Bij het opslaan worden dit echte invulvelden.'}
            </div>
          </div>
        )}

        {mode === 'form' && (
          <div className="editor-tools__settings">
            <label className="editbar__checkbox" title="Bij het platslaan worden de velden vaste inhoud die niet meer te wijzigen is">
              <input
                type="checkbox"
                checked={flattenForms}
                onChange={(e) => setFlattenForms(e.target.checked)}
              />
              Platslaan bij export
            </label>
            <div className="editor-tools__hint">Klik in een veld op de pagina om het in te vullen</div>
          </div>
        )}

        {showStamp && (
          <div className="editor-tools__settings">
            <div className="editor-tools__stamps">
              {STAMP_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`stamp-chip${settings.stampKey === preset.key ? ' stamp-chip--active' : ''}`}
                  style={{ ['--stamp-color' as string]: preset.color }}
                  onClick={() => setSettings((s) => ({ ...s, stampKey: preset.key }))}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="editor-tools__hint">Klik op een pagina om de stempel met datum te plaatsen</div>
          </div>
        )}

        {showHighlight && (
          <div className="editor-tools__settings">
            <div className="editor-tools__swatches">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${shownHighlightColor === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  onClick={() => {
                    setSettings((s) => ({ ...s, highlightColor: color }))
                    if (selectedAnnotation?.type === 'highlight') patchSelected({ color })
                  }}
                />
              ))}
            </div>
            <label className="editor-tools__slider">
              <input
                type="range"
                min={10}
                max={90}
                step={5}
                value={Math.round(shownHighlightOpacity * 100)}
                onChange={(e) => {
                  const opacity = Number(e.target.value) / 100
                  setSettings((s) => ({ ...s, highlightOpacity: opacity }))
                  if (selectedAnnotation?.type === 'highlight') patchSelected({ opacity })
                }}
              />
              <span>{Math.round(shownHighlightOpacity * 100)}%</span>
            </label>
          </div>
        )}

        {showInk && (
          <div className="editor-tools__settings">
            <div className="editor-tools__swatches">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${shownInkColor === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  onClick={() => {
                    setSettings((s) => ({ ...s, inkColor: color }))
                    if (selectedAnnotation?.type === 'ink') patchSelected({ color })
                  }}
                />
              ))}
            </div>
            <div className="editbar__widths">
              {INK_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  className={`editbar__width${shownInkWidth === width ? ' editbar__width--active' : ''}`}
                  onClick={() => {
                    setSettings((s) => ({ ...s, inkWidth: width }))
                    if (selectedAnnotation?.type === 'ink') patchSelected({ strokeWidth: width })
                  }}
                >
                  <span style={{ width: 4 + width * 2, height: 4 + width * 2 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {showText && (
          <div className="editor-tools__settings">
            <select
              className="editor-tools__select"
              value={shownText?.font ?? settings.textFont}
              onChange={(e) => {
                const font = e.target.value as AnnotationFont
                setSettings((s) => ({ ...s, textFont: font }))
                if (shownText) patchSelected({ font })
              }}
            >
              {(Object.keys(ANNOTATION_FONT_LABELS) as AnnotationFont[]).map((font) => (
                <option key={font} value={font}>
                  {ANNOTATION_FONT_LABELS[font]}
                </option>
              ))}
            </select>
            <div className="editor-tools__textrow">
              <input
                type="number"
                className="editbar__size"
                min={6}
                max={96}
                value={shownText?.size ?? settings.textSize}
                onChange={(e) => {
                  const size = Math.max(6, Math.min(96, Number(e.target.value) || 16))
                  setSettings((s) => ({ ...s, textSize: size }))
                  if (shownText) patchSelected({ size })
                }}
              />
              <button
                type="button"
                className={`editbar__toggle editbar__toggle--bold${(shownText?.bold ?? settings.textBold) ? ' editbar__toggle--active' : ''}`}
                title="Vet"
                onClick={() => {
                  const bold = !(shownText?.bold ?? settings.textBold)
                  setSettings((s) => ({ ...s, textBold: bold }))
                  if (shownText) patchSelected({ bold })
                }}
              >
                B
              </button>
              <button
                type="button"
                className={`editbar__toggle editbar__toggle--italic${(shownText?.italic ?? settings.textItalic) ? ' editbar__toggle--active' : ''}`}
                title="Cursief"
                onClick={() => {
                  const italic = !(shownText?.italic ?? settings.textItalic)
                  setSettings((s) => ({ ...s, textItalic: italic }))
                  if (shownText) patchSelected({ italic })
                }}
              >
                I
              </button>
              <button
                type="button"
                className={`editbar__toggle editbar__toggle--underline${(shownText?.underline ?? settings.textUnderline) ? ' editbar__toggle--active' : ''}`}
                title="Onderstrepen"
                onClick={() => {
                  const underline = !(shownText?.underline ?? settings.textUnderline)
                  setSettings((s) => ({ ...s, textUnderline: underline }))
                  if (shownText) patchSelected({ underline })
                }}
              >
                U
              </button>
              <button
                type="button"
                className={`editbar__toggle editbar__toggle--strike${(shownText?.strike ?? settings.textStrike) ? ' editbar__toggle--active' : ''}`}
                title="Streep door de tekst"
                onClick={() => {
                  const strike = !(shownText?.strike ?? settings.textStrike)
                  setSettings((s) => ({ ...s, textStrike: strike }))
                  if (shownText) patchSelected({ strike })
                }}
              >
                S
              </button>
            </div>
            <div className="editor-tools__textrow">
              {ALIGN_OPTIONS.map(({ key, label, icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`editbar__toggle${(shownText?.align ?? settings.textAlign) === key ? ' editbar__toggle--active' : ''}`}
                  title={label}
                  onClick={() => {
                    setSettings((s) => ({ ...s, textAlign: key }))
                    if (shownText) patchSelected({ align: key })
                  }}
                >
                  {icon}
                </button>
              ))}
            </div>
            <div className="editor-tools__swatches">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${(shownText?.color ?? settings.textColor) === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  title={TEXT_COLOR_LABELS[color] ?? color}
                  onClick={() => {
                    setSettings((s) => ({ ...s, textColor: color }))
                    if (shownText) patchSelected({ color })
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="editor-tools__divider" />

        {activeSignature ? (
          <div className="editor-tools__signature">
            <div className="lightbox__tray editor-tools__tray" title="Houd ingedrukt en sleep naar een pagina" {...trayDrag}>
              <img src={activeSignature.dataUrl} alt="Handtekening" draggable={false} />
              <span>Handtekening slepen</span>
              {signatureAssets.length > 1 && (
                <button
                  type="button"
                  className="icon-btn icon-btn--chrome"
                  title="Andere handtekening kiezen"
                  onClick={() => setSigPickerOpen((v) => !v)}
                >
                  <IconChevronDown size={13} />
                </button>
              )}
            </div>
            {sigPickerOpen && (
              <div className="dropdown-menu signature-menu editor-tools__sigmenu" onClick={(e) => e.stopPropagation()}>
                {signatureAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`signature-menu__item${asset.id === activeSignature.id ? ' signature-menu__item--active' : ''}`}
                    onClick={() => {
                      setActiveSignature(asset.id)
                      setSigPickerOpen(false)
                    }}
                  >
                    <img src={asset.dataUrl} alt={asset.name} draggable={false} />
                    <span className="signature-menu__name">{asset.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="editor-tools__hint editor-tools__hint--muted">
            Nog geen handtekening — laad er een via <strong>Menu → Handtekening</strong>.
          </div>
        )}

        <div className="editor-tools__divider" />
        <div className="editor-tools__section">Pagina {currentPage + 1}</div>
        <button
          type="button"
          className="editor-tools__btn tone-slate"
          title={`Roteer pagina ${currentPage + 1} een kwartslag`}
          onClick={() => {
            const page = group.pages[currentPage]
            if (page) rotatePages([page.id])
          }}
        >
          <IconRotate size={15} />
          <span>Pagina roteren</span>
        </button>
        <button
          type="button"
          className="editor-tools__btn tone-red"
          title={`Verwijder pagina ${currentPage + 1} uit dit document`}
          onClick={() => {
            const page = group.pages[currentPage]
            if (page) deletePages([page.id])
          }}
        >
          <IconTrash size={15} />
          <span>Pagina verwijderen</span>
        </button>
        <button
          type="button"
          className="editor-tools__btn tone-slate"
          title="Een lege pagina achteraan dit document toevoegen"
          onClick={() => void insertBlankPage(group.id)}
        >
          <IconPlus size={15} />
          <span>Lege pagina toevoegen</span>
        </button>

        <div className="editor-tools__spacer" />
        <div className="editor-tools__section">Document</div>
        <button
          type="button"
          className="editor-tools__btn tone-blue"
          title="Samenvoegen, splitsen en pagina's tussen documenten verplaatsen doe je in het overzicht"
          onClick={() => setActiveEditorTab(null)}
        >
          <IconGridView size={15} />
          <span>Ordenen, samenvoegen, splitsen…</span>
        </button>
        <button
          type="button"
          className="editor-tools__btn tone-blue"
          title="Titel, auteur, onderwerp en trefwoorden van dit document"
          onClick={() => setDocPropertiesOpen(group.id)}
        >
          <IconHash size={15} />
          <span>Documenteigenschappen…</span>
        </button>
      </aside>

      {trayGhost && activeSignature && (
        <img
          src={activeSignature.dataUrl}
          alt=""
          className="signature-drag-ghost"
          style={{ left: trayGhost.x, top: trayGhost.y }}
        />
      )}
    </div>
  )
}
