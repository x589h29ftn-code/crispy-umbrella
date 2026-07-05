import { useEffect, useMemo, useRef, useState } from 'react'
import { useStudioStore } from '../../store'
import { usePressDrag } from '../../hooks/usePressDrag'
import {
  getPageVisualSize,
  renderThumbnail,
  visualRectToSignaturePlacement
} from '../../lib/pdfEngine'
import {
  ANNOTATION_FONT_LABELS,
  HIGHLIGHT_COLORS,
  INK_WIDTHS,
  TEXT_COLORS
} from '../../lib/annotationStyle'
import { ShapePreviewIcon, SHAPE_LABELS, STAMP_PRESETS } from '../../lib/shapes'
import type { AnnotationFont, PageRef, ShapeKind, SourceFile } from '../../types'
import EditorPage, { type EditorMode, type EditorSelection, type ToolSettings } from './EditorPage'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconComment,
  IconCursor,
  IconEditText,
  IconEraser,
  IconExpand,
  IconForm,
  IconGridView,
  IconGrip,
  IconHighlighter,
  IconMinus,
  IconMoonStars,
  IconPen,
  IconPlus,
  IconRedact,
  IconRotate,
  IconShapes,
  IconStamp,
  IconTrash,
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

/** Small page thumbnail in the left rail; press-and-drag reorders the page. */
function RailThumb({
  page,
  source,
  index,
  active,
  dragging,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd
}: {
  page: PageRef
  source: SourceFile | undefined
  index: number
  active: boolean
  dragging: boolean
  onClick: () => void
  onDragStart: (index: number) => void
  onDragMove: (clientY: number) => void
  onDragEnd: (commit: boolean) => void
}): JSX.Element {
  const [thumb, setThumb] = useState<string | null>(null)
  const drag = usePressDrag({
    onStart: () => {
      onDragStart(index)
    },
    onMove: (_x, y) => onDragMove(y),
    onEnd: () => onDragEnd(true),
    onCancel: () => onDragEnd(false)
  })
  useEffect(() => {
    let cancelled = false
    if (!source) return
    renderThumbnail(source, page.sourcePageIndex, page.rotation, 180)
      .then((url) => {
        if (!cancelled) setThumb(url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page.sourcePageIndex, page.rotation])
  return (
    <button
      type="button"
      className={`editor-rail__thumb${active ? ' editor-rail__thumb--active' : ''}${dragging ? ' editor-rail__thumb--dragging' : ''}`}
      title="Klik om te tonen; sleep om de pagina te verplaatsen"
      onClick={onClick}
      {...drag}
    >
      {thumb ? <img src={thumb} alt={`Pagina ${index + 1}`} draggable={false} /> : <span className="editor-rail__ph" />}
      <span>{index + 1}</span>
    </button>
  )
}

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
  const presentationMode = useStudioStore((s) => s.presentationMode)
  const setPresentationMode = useStudioStore((s) => s.setPresentationMode)
  const nightMode = useStudioStore((s) => s.readerNightMode)
  const setNightMode = useStudioStore((s) => s.setReaderNightMode)

  const [mode, setMode] = useState<EditorMode>('view')
  const [selection, setSelection] = useState<EditorSelection | null>(null)
  const [zoom, setZoom] = useState(1)
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
    shapeKind: 'arrow',
    shapeColor: TEXT_COLORS[1],
    shapeWidth: INK_WIDTHS[1],
    stampKey: STAMP_PRESETS[0].key
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

  if (!group) return null

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

  // Single/spread fit the window like a real reader: zoom 1 = the page(s)
  // exactly fill the available space (no dead margins), zooming multiplies.
  const gap = 28
  const aspect = pageBaseSize.height / Math.max(1, pageBaseSize.width)
  const fitHeight = Math.max(200, centerHeight - 118) // minus view bar + pages padding
  const singleFit = Math.max(160, Math.min(centerWidth - gap * 2, fitHeight / aspect))
  const spreadFit = Math.max(140, Math.min((centerWidth - gap * 3) / 2, fitHeight / aspect))
  const pageWidth =
    viewMode === 'single'
      ? singleFit * zoom
      : viewMode === 'spread'
        ? spreadFit * zoom
        : Math.max(200, (centerWidth - gap * 2) * 0.92 * Math.min(zoom, 2))

  const spreadStart = currentPage - (currentPage % 2)
  const visiblePages =
    viewMode === 'single'
      ? [group.pages[currentPage]].filter(Boolean)
      : viewMode === 'spread'
        ? group.pages.slice(spreadStart, spreadStart + 2)
        : group.pages

  const MODES: { key: EditorMode; label: string; icon: JSX.Element; title: string }[] = [
    { key: 'view', label: 'Selecteren', icon: <IconCursor size={15} />, title: 'Selecteren en verplaatsen' },
    { key: 'highlight', label: 'Markeren', icon: <IconHighlighter size={15} />, title: 'Sleep een vak over de tekst' },
    { key: 'draw', label: 'Tekenen', icon: <IconPen size={15} />, title: 'Vrij tekenen of schrijven' },
    { key: 'shape', label: 'Vormen', icon: <IconShapes size={15} />, title: 'Sleep een pijl, lijn, rechthoek of ovaal' },
    { key: 'stamp', label: 'Stempel', icon: <IconStamp size={15} />, title: 'Klik op de pagina om een stempel te plaatsen' },
    { key: 'form', label: 'Formulier', icon: <IconForm size={15} />, title: 'Vul formuliervelden in dit document in' },
    { key: 'text', label: 'Tekst', icon: <IconType size={15} />, title: 'Klik op de pagina om tekst te plaatsen' },
    { key: 'edittext', label: 'Tekst bewerken', icon: <IconEditText size={15} />, title: 'Klik op een bestaande tekstregel' },
    { key: 'redact', label: 'Redigeren', icon: <IconRedact size={15} />, title: 'Zwartlakken — inhoud verdwijnt echt bij export' },
    { key: 'comment', label: 'Commentaar', icon: <IconComment size={15} />, title: 'Klik op de pagina voor een opmerking' },
    { key: 'erase', label: 'Gum', icon: <IconEraser size={15} />, title: 'Klik op een getekende lijn om te wissen' }
  ]

  return (
    <div className={`editor-view${presentationMode ? ' editor-view--presentation' : ''}`}>
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
      <div className="editor-rail">
        {group.pages.map((page, i) => (
          <div key={page.id} className="editor-rail__slot">
            {railDrag && railDrag.toIndex === i && <div className="editor-rail__indicator" />}
            <RailThumb
              page={page}
              source={sources.get(page.sourceId)}
              index={i}
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

      <div className="editor-center" ref={centerRef}>
        <div className="editor-center__bar">
          <div className="editor-center__views">
            <button
              type="button"
              className={`editbar__mode${viewMode === 'scroll' ? ' editbar__mode--active' : ''}`}
              onClick={() => setViewMode('scroll')}
              title="Doorlopend scrollen"
            >
              Doorlopend
            </button>
            <button
              type="button"
              className={`editbar__mode${viewMode === 'spread' ? ' editbar__mode--active' : ''}`}
              onClick={() => {
                setViewMode('spread')
                setZoom(1)
              }}
              title="Twee pagina's naast elkaar, passend in het venster"
            >
              Naast elkaar
            </button>
            <button
              type="button"
              className={`editbar__mode${viewMode === 'single' ? ' editbar__mode--active' : ''}`}
              onClick={() => {
                setViewMode('single')
                setZoom(1)
              }}
              title="Eén pagina, passend in het venster"
            >
              Eén pagina
            </button>
          </div>
          {(viewMode === 'single' || viewMode === 'spread') && (
            <div className="editor-center__nav">
              <button
                type="button"
                className="pill-btn pill-btn--icon"
                disabled={currentPage === 0}
                onClick={() => setCurrentPage((p) => Math.max(0, p - (viewMode === 'spread' ? 2 : 1)))}
                title="Vorige pagina (of scroll met het muiswiel)"
              >
                <IconChevronLeft size={14} />
              </button>
              <span>
                {viewMode === 'spread' && group.pages.length > spreadStart + 1
                  ? `${spreadStart + 1}–${spreadStart + 2} / ${group.pages.length}`
                  : `${currentPage + 1} / ${group.pages.length}`}
              </span>
              <button
                type="button"
                className="pill-btn pill-btn--icon"
                disabled={currentPage >= group.pages.length - (viewMode === 'spread' ? 2 : 1)}
                onClick={() =>
                  setCurrentPage((p) => Math.min(group.pages.length - 1, p + (viewMode === 'spread' ? 2 : 1)))
                }
                title="Volgende pagina (of scroll met het muiswiel)"
              >
                <IconChevronRight size={14} />
              </button>
            </div>
          )}
          <div className="editor-center__zoom" title="Zoom (of Ctrl+scrollen)">
            <button type="button" className="pill-btn pill-btn--icon" onClick={() => setZoom((z) => Math.max(0.3, z / 1.2))}>
              <IconMinus size={13} />
            </button>
            <button type="button" className="toolbar__zoom-pct" onClick={() => setZoom(1)} title="Zoom herstellen">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className="pill-btn pill-btn--icon" onClick={() => setZoom((z) => Math.min(5, z * 1.2))}>
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
              mode={mode}
              settings={settings}
              selection={selection}
              onSelect={setSelection}
            />
          ))}
        </div>
      </div>

      <aside className="editor-tools">
        <div className="editor-tools__title">Gereedschap</div>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`editor-tools__btn${mode === m.key ? ' editor-tools__btn--active' : ''}`}
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

        {(showHighlight || showInk || showText || showShape || showStamp) && <div className="editor-tools__divider" />}

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
                onClick={() => {
                  const italic = !(shownText?.italic ?? settings.textItalic)
                  setSettings((s) => ({ ...s, textItalic: italic }))
                  if (shownText) patchSelected({ italic })
                }}
              >
                I
              </button>
            </div>
            <div className="editor-tools__swatches">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${(shownText?.color ?? settings.textColor) === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
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
          <div className="editor-tools__hint">Laad een handtekening via het zijmenu om te ondertekenen</div>
        )}

        <div className="editor-tools__divider" />
        <div className="editor-tools__title">Pagina {currentPage + 1}</div>
        <button
          type="button"
          className="editor-tools__btn"
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
          className="editor-tools__btn"
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
          className="editor-tools__btn"
          title="Pagina's samenvoegen, splitsen of tussen documenten verplaatsen — dit doe je in het overzicht"
          onClick={() => setActiveEditorTab(null)}
        >
          <IconGridView size={15} />
          <span>Samenvoegen / splitsen…</span>
        </button>

        <div className="editor-tools__spacer" />
        <button
          type="button"
          className="editor-tools__btn"
          title="Samenvoegen, splitsen en pagina's verplaatsen doe je in het overzicht"
          onClick={() => setActiveEditorTab(null)}
        >
          <IconGrip size={15} />
          <span>Ordenen in overzicht</span>
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
