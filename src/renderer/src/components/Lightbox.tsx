import { useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import {
  getPageVisualSize,
  getPlacementVisualBox,
  renderThumbnail,
  textAnnotationBlockHeight,
  TEXT_LINE_HEIGHT,
  visualPointToContentPoint,
  visualRectToContentRect,
  visualRectToSignaturePlacement,
  type SignatureVisualBox
} from '../lib/pdfEngine'
import {
  ANNOTATION_FONT_CSS,
  ANNOTATION_FONT_LABELS,
  HIGHLIGHT_COLORS,
  TEXT_COLORS
} from '../lib/annotationStyle'
import { useStudioStore } from '../store'
import { usePressDrag } from '../hooks/usePressDrag'
import { useClickOutside } from '../hooks/useClickOutside'
import type { Annotation, AnnotationFont, HighlightAnnotation, SignaturePlacement, TextAnnotation } from '../types'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconCursor,
  IconHighlighter,
  IconRotate,
  IconType
} from './icons'
import LightboxFilmstrip from './LightboxFilmstrip'

const DEFAULT_SIGNATURE_WIDTH_PCT = 0.28
const MIN_HIGHLIGHT_SIZE_PX = 5

type EditMode = 'view' | 'highlight' | 'text'

interface DragTarget {
  kind: 'move' | 'resize'
  type: 'signature' | 'annotation'
  targetId: string
  startClientX: number
  startClientY: number
  startPivotVisualX: number
  startPivotVisualY: number
  startWidth: number
  startHeight: number
  rotateDeg: number
}

interface TextEditorState {
  /** null while creating a new annotation */
  annotationId: string | null
  /** top-left of the text block in page-visual units */
  visualX: number
  visualY: number
  value: string
}

export default function Lightbox(): JSX.Element | null {
  const lightbox = useStudioStore((s) => s.lightbox)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const closeLightbox = useStudioStore((s) => s.closeLightbox)
  const stepLightbox = useStudioStore((s) => s.stepLightbox)
  const rotatePages = useStudioStore((s) => s.rotatePages)
  const markHistory = useStudioStore((s) => s.markHistory)
  const signatureAssets = useStudioStore((s) => s.signatureAssets)
  const activeSignatureId = useStudioStore((s) => s.activeSignatureId)
  const setActiveSignature = useStudioStore((s) => s.setActiveSignature)
  const addSignaturePlacement = useStudioStore((s) => s.addSignaturePlacement)
  const updateSignaturePlacement = useStudioStore((s) => s.updateSignaturePlacement)
  const removeSignaturePlacement = useStudioStore((s) => s.removeSignaturePlacement)
  const addAnnotation = useStudioStore((s) => s.addAnnotation)
  const updateAnnotation = useStudioStore((s) => s.updateAnnotation)
  const removeAnnotation = useStudioStore((s) => s.removeAnnotation)

  const [image, setImage] = useState<string | null>(null)
  const [boxes, setBoxes] = useState<Record<string, SignatureVisualBox>>({})
  const [annoBoxes, setAnnoBoxes] = useState<Record<string, SignatureVisualBox>>({})
  const [pageVisualSize, setPageVisualSize] = useState<{ width: number; height: number } | null>(null)
  const stageImgRef = useRef<HTMLImageElement>(null)
  const dragOriginRef = useRef<DragTarget | null>(null)

  // Editing menu state
  const [mode, setMode] = useState<EditMode>('view')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0])
  const [highlightOpacity, setHighlightOpacity] = useState(0.4)
  const [textFont, setTextFont] = useState<AnnotationFont>('helvetica')
  const [textSize, setTextSize] = useState(16)
  const [textBold, setTextBold] = useState(false)
  const [textItalic, setTextItalic] = useState(false)
  const [textColor, setTextColor] = useState(TEXT_COLORS[0])
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null)
  // Mirror of textEditor that commit reads & clears synchronously, so the blur
  // that follows an Enter-commit can't commit the same editor twice.
  const textEditorRef = useRef<TextEditorState | null>(null)
  textEditorRef.current = textEditor
  const [band, setBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const bandRef = useRef<{ x1: number; y1: number } | null>(null)
  const [sigPickerOpen, setSigPickerOpen] = useState(false)
  const sigPickerRef = useRef<HTMLDivElement>(null)
  useClickOutside(sigPickerRef, sigPickerOpen, () => setSigPickerOpen(false))

  const activeSignature = signatureAssets.find((a) => a.id === activeSignatureId) ?? signatureAssets[0] ?? null

  // Dragging the signature out of the tray onto the page, with pointer events
  // and a live ghost (HTML5 drag was unreliable in Electron).
  const [trayGhost, setTrayGhost] = useState<{ x: number; y: number } | null>(null)
  const trayPosRef = useRef<{ x: number; y: number } | null>(null)
  const placeSignatureAtRef = useRef<((x: number, y: number) => Promise<void>) | null>(null)
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
      if (pos) void placeSignatureAtRef.current?.(pos.x, pos.y)
    },
    onCancel: () => setTrayGhost(null)
  })

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

  const selectedAnnotation =
    (selectedAnnotationId && context?.page.annotations.find((a) => a.id === selectedAnnotationId)) || null

  // Reset edit state when navigating to another page or closing.
  useEffect(() => {
    setSelectedAnnotationId(null)
    setTextEditor(null)
    setBand(null)
  }, [lightbox.pageId])

  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (textEditor) setTextEditor(null)
        else if (mode !== 'view') setMode('view')
        else if (selectedAnnotationId) setSelectedAnnotationId(null)
        else closeLightbox()
        return
      }
      if (isTyping(e.target)) return
      if (e.key === 'ArrowRight') stepLightbox(1)
      if (e.key === 'ArrowLeft') stepLightbox(-1)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId && context) {
        removeAnnotation(context.page.id, selectedAnnotationId)
        setSelectedAnnotationId(null)
      }
    }
    if (lightbox.open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox.open, closeLightbox, stepLightbox, mode, textEditor, selectedAnnotationId, context, removeAnnotation])

  useEffect(() => {
    let cancelled = false
    if (!context) {
      setImage(null)
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    const targetWidth = Math.round(Math.min(window.innerWidth * 0.8, 1400) * (window.devicePixelRatio || 1))
    renderThumbnail(source, context.page.sourcePageIndex, context.page.rotation, targetWidth)
      .then((url) => {
        if (!cancelled) setImage(url)
      })
      .catch(() => undefined)
    getPageVisualSize(source, context.page.sourcePageIndex, context.page.rotation)
      .then((size) => {
        if (!cancelled) setPageVisualSize(size)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [context, sources])

  useEffect(() => {
    let cancelled = false
    if (!context) {
      setBoxes({})
      setAnnoBoxes({})
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    Promise.all([
      Promise.all(
        context.page.signatures.map(async (s) => [
          s.id,
          await getPlacementVisualBox(source, context.page.sourcePageIndex, context.page.rotation, s)
        ] as const)
      ),
      Promise.all(
        context.page.annotations.map(async (a) => [
          a.id,
          await getPlacementVisualBox(source, context.page.sourcePageIndex, context.page.rotation, {
            x: a.x,
            y: a.y,
            width: a.type === 'highlight' ? a.width : 0,
            height: a.type === 'highlight' ? a.height : textAnnotationBlockHeight(a)
          })
        ] as const)
      )
    ])
      .then(([sigEntries, annoEntries]) => {
        if (cancelled) return
        setBoxes(Object.fromEntries(sigEntries))
        setAnnoBoxes(Object.fromEntries(annoEntries))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [context, sources])

  if (!lightbox.open || !context) return null

  const source = sources.get(context.page.sourceId)
  const cssScale =
    pageVisualSize && stageImgRef.current ? stageImgRef.current.clientWidth / pageVisualSize.width : 1

  function stagePointToVisual(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!stageImgRef.current) return null
    const rect = stageImgRef.current.getBoundingClientRect()
    return { x: (clientX - rect.left) / cssScale, y: (clientY - rect.top) / cssScale }
  }

  async function placeSignatureAt(clientX: number, clientY: number): Promise<void> {
    if (!activeSignature || !source || !context || !stageImgRef.current || !pageVisualSize) return
    const rect = stageImgRef.current.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return
    const dropVisualX = (clientX - rect.left) / cssScale
    const dropVisualY = (clientY - rect.top) / cssScale
    const wPct = DEFAULT_SIGNATURE_WIDTH_PCT
    const aspect = activeSignature.naturalHeight / activeSignature.naturalWidth
    const hPct = (wPct * pageVisualSize.width * aspect) / pageVisualSize.height
    const xPct = dropVisualX / pageVisualSize.width - wPct / 2
    const yPct = dropVisualY / pageVisualSize.height - hPct / 2

    const placement = await visualRectToSignaturePlacement(
      source,
      context.page.sourcePageIndex,
      context.page.rotation,
      { xPct, yPct, wPct, hPct },
      activeSignature.dataUrl
    )
    addSignaturePlacement(context.page.id, placement)
  }
  placeSignatureAtRef.current = placeSignatureAt

  // Signature/annotation drag & resize use pointer capture on the element itself
  // rather than window-level listeners, so a mid-drag unmount can never leave a
  // dangling global listener behind — the browser releases capture automatically.
  function beginDrag(
    e: React.PointerEvent<HTMLDivElement>,
    type: 'signature' | 'annotation',
    kind: 'move' | 'resize',
    targetId: string,
    box: SignatureVisualBox
  ): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    markHistory() // one undo step per gesture, not per pointermove
    dragOriginRef.current = {
      kind,
      type,
      targetId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPivotVisualX: box.pivotX,
      startPivotVisualY: box.pivotY,
      startWidth: box.width,
      startHeight: box.height,
      rotateDeg: box.rotateDeg
    }
  }

  function onOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const origin = dragOriginRef.current
    if (!origin || !source || !context) return
    const dx = (e.clientX - origin.startClientX) / cssScale
    const dy = (e.clientY - origin.startClientY) / cssScale
    const pageId = context.page.id

    if (origin.kind === 'move') {
      void visualPointToContentPoint(
        source,
        context.page.sourcePageIndex,
        context.page.rotation,
        origin.startPivotVisualX + dx,
        origin.startPivotVisualY + dy
      ).then(({ x, y }) => {
        if (origin.type === 'signature') updateSignaturePlacement(pageId, origin.targetId, { x, y })
        else updateAnnotation(pageId, origin.targetId, { x, y })
      })
    } else {
      const theta = (origin.rotateDeg * Math.PI) / 180
      const dxLocal = Math.cos(theta) * dx + Math.sin(theta) * dy
      const dyLocal = -Math.sin(theta) * dx + Math.cos(theta) * dy
      const patch = {
        width: Math.max(20, origin.startWidth + dxLocal),
        height: Math.max(origin.type === 'signature' ? 20 : 8, origin.startHeight + dyLocal)
      }
      if (origin.type === 'signature') updateSignaturePlacement(pageId, origin.targetId, patch)
      else updateAnnotation(pageId, origin.targetId, patch)
    }
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragOriginRef.current = null
  }

  // --- Highlight rubber band ---
  function onStagePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (mode !== 'highlight' || e.button !== 0) return
    if (!stageImgRef.current) return
    const rect = stageImgRef.current.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    bandRef.current = { x1: x, y1: y }
    setBand({ x1: x, y1: y, x2: x, y2: y })
  }

  function onStagePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!bandRef.current || !stageImgRef.current) return
    const rect = stageImgRef.current.getBoundingClientRect()
    const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left))
    const y = Math.min(rect.height, Math.max(0, e.clientY - rect.top))
    setBand({ x1: bandRef.current.x1, y1: bandRef.current.y1, x2: x, y2: y })
  }

  function onStagePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const start = bandRef.current
    bandRef.current = null
    if (!start || !band || !source || !context || !pageVisualSize) {
      setBand(null)
      return
    }
    const left = Math.min(band.x1, band.x2)
    const top = Math.min(band.y1, band.y2)
    const width = Math.abs(band.x2 - band.x1)
    const height = Math.abs(band.y2 - band.y1)
    setBand(null)
    if (width < MIN_HIGHLIGHT_SIZE_PX || height < MIN_HIGHLIGHT_SIZE_PX) return

    const visual = {
      xPct: left / cssScale / pageVisualSize.width,
      yPct: top / cssScale / pageVisualSize.height,
      wPct: width / cssScale / pageVisualSize.width,
      hPct: height / cssScale / pageVisualSize.height
    }
    const pageId = context.page.id
    void visualRectToContentRect(source, context.page.sourcePageIndex, context.page.rotation, visual).then(
      (rect) => {
        const annotation: HighlightAnnotation = {
          id: nanoid(),
          type: 'highlight',
          ...rect,
          color: highlightColor,
          opacity: highlightOpacity
        }
        addAnnotation(pageId, annotation)
        setSelectedAnnotationId(annotation.id)
      }
    )
  }

  // --- Text placement & editing ---
  function onStageClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (mode === 'text' && !textEditor) {
      const point = stagePointToVisual(e.clientX, e.clientY)
      if (!point) return
      setTextEditor({ annotationId: null, visualX: point.x, visualY: point.y, value: '' })
      return
    }
    if (mode === 'view') setSelectedAnnotationId(null)
  }

  async function commitTextEditor(): Promise<void> {
    const editor = textEditorRef.current
    if (!editor || !source || !context) return
    textEditorRef.current = null
    setTextEditor(null)
    const value = editor.value.replace(/\s+$/, '')
    const pageId = context.page.id

    if (editor.annotationId) {
      const existing = context.page.annotations.find(
        (a): a is TextAnnotation => a.id === editor.annotationId && a.type === 'text'
      )
      if (!existing) return
      if (!value.trim()) {
        removeAnnotation(pageId, existing.id)
        setSelectedAnnotationId(null)
        return
      }
      // Keep the block's top-left where it was; the bottom pivot shifts if the
      // number of lines changed.
      const lines = value.split('\n').length
      const newHeight = lines * existing.size * TEXT_LINE_HEIGHT
      const { x, y } = await visualPointToContentPoint(
        source,
        context.page.sourcePageIndex,
        context.page.rotation,
        editor.visualX,
        editor.visualY + newHeight
      )
      markHistory()
      updateAnnotation(pageId, existing.id, { text: value, x, y })
      return
    }

    if (!value.trim()) return
    const lines = value.split('\n').length
    const height = lines * textSize * TEXT_LINE_HEIGHT
    const { x, y } = await visualPointToContentPoint(
      source,
      context.page.sourcePageIndex,
      context.page.rotation,
      editor.visualX,
      editor.visualY + height
    )
    const annotation: TextAnnotation = {
      id: nanoid(),
      type: 'text',
      x,
      y,
      text: value,
      font: textFont,
      size: textSize,
      bold: textBold,
      italic: textItalic,
      color: textColor
    }
    addAnnotation(context.page.id, annotation)
    setSelectedAnnotationId(annotation.id)
  }

  function openTextEditorFor(annotation: TextAnnotation): void {
    const box = annoBoxes[annotation.id]
    if (!box) return
    setTextEditor({
      annotationId: annotation.id,
      visualX: box.pivotX,
      visualY: box.pivotY - textAnnotationBlockHeight(annotation),
      value: annotation.text
    })
  }

  // --- Toolbar control handlers: edit the selected annotation, or set defaults ---
  function applyHighlightPatch(patch: Partial<HighlightAnnotation>): void {
    if (context && selectedAnnotation?.type === 'highlight') {
      markHistory()
      updateAnnotation(context.page.id, selectedAnnotation.id, patch)
    }
  }

  function applyTextPatch(patch: Partial<TextAnnotation>): void {
    if (context && selectedAnnotation?.type === 'text') {
      markHistory()
      updateAnnotation(context.page.id, selectedAnnotation.id, patch)
    }
  }

  const shownHighlightColor = selectedAnnotation?.type === 'highlight' ? selectedAnnotation.color : highlightColor
  const shownHighlightOpacity =
    selectedAnnotation?.type === 'highlight' ? selectedAnnotation.opacity : highlightOpacity
  const shownTextFont = selectedAnnotation?.type === 'text' ? selectedAnnotation.font : textFont
  const shownTextSize = selectedAnnotation?.type === 'text' ? selectedAnnotation.size : textSize
  const shownTextBold = selectedAnnotation?.type === 'text' ? selectedAnnotation.bold : textBold
  const shownTextItalic = selectedAnnotation?.type === 'text' ? selectedAnnotation.italic : textItalic
  const shownTextColor = selectedAnnotation?.type === 'text' ? selectedAnnotation.color : textColor

  const showHighlightControls = mode === 'highlight' || selectedAnnotation?.type === 'highlight'
  const showTextControls = mode === 'text' || selectedAnnotation?.type === 'text'

  function annotationOverlay(annotation: Annotation): JSX.Element | null {
    const box = annoBoxes[annotation.id]
    if (!box) return null
    const isSelected = annotation.id === selectedAnnotationId
    const common = {
      left: box.pivotX * cssScale,
      top: (box.pivotY - box.height) * cssScale,
      transform: `rotate(${box.rotateDeg}deg)`
    }
    return (
      <div
        key={annotation.id}
        className={`annotation-overlay${isSelected ? ' annotation-overlay--selected' : ''}${
          mode !== 'view' ? ' annotation-overlay--passive' : ''
        }`}
        style={
          annotation.type === 'highlight'
            ? { ...common, width: box.width * cssScale, height: box.height * cssScale }
            : common
        }
        onPointerDown={(e) => {
          setSelectedAnnotationId(annotation.id)
          beginDrag(e, 'annotation', 'move', annotation.id, box)
        }}
        onPointerMove={onOverlayPointerMove}
        onPointerUp={endDrag}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (annotation.type === 'text') openTextEditorFor(annotation)
        }}
      >
        {annotation.type === 'highlight' ? (
          <div
            className="annotation-overlay__fill"
            style={{ background: annotation.color, opacity: annotation.opacity }}
          />
        ) : (
          <div
            className="annotation-overlay__text"
            style={{
              color: annotation.color,
              fontFamily: ANNOTATION_FONT_CSS[annotation.font],
              fontSize: annotation.size * cssScale,
              lineHeight: TEXT_LINE_HEIGHT,
              fontWeight: annotation.bold ? 700 : 400,
              fontStyle: annotation.italic ? 'italic' : 'normal'
            }}
          >
            {annotation.text}
          </div>
        )}
        {isSelected && (
          <>
            <button
              type="button"
              className="icon-btn icon-btn--danger annotation-overlay__remove"
              title="Verwijderen"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                removeAnnotation(context!.page.id, annotation.id)
                setSelectedAnnotationId(null)
              }}
            >
              <IconClose size={11} />
            </button>
            {annotation.type === 'highlight' && (
              <div
                className="signature-overlay__resize"
                onPointerDown={(e) => beginDrag(e, 'annotation', 'resize', annotation.id, box)}
                onPointerMove={onOverlayPointerMove}
                onPointerUp={endDrag}
              />
            )}
          </>
        )}
      </div>
    )
  }

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
        <button type="button" className="icon-btn" onClick={() => rotatePages([context.page.id])} title="Roteer">
          <IconRotate size={14} />
        </button>
        <button type="button" className="icon-btn" onClick={closeLightbox} title="Sluiten (Esc)">
          <IconClose size={14} />
        </button>
      </div>

      <div className="editbar" onClick={(e) => e.stopPropagation()}>
        <div className="editbar__modes">
          <button
            type="button"
            className={`editbar__mode${mode === 'view' ? ' editbar__mode--active' : ''}`}
            onClick={() => setMode('view')}
            title="Selecteren en verplaatsen"
          >
            <IconCursor size={14} /> Selecteren
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'highlight' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'highlight' ? 'view' : 'highlight'))
              setSelectedAnnotationId(null)
            }}
            title="Markeren: sleep een vak over de tekst"
          >
            <IconHighlighter size={14} /> Markeren
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'text' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'text' ? 'view' : 'text'))
              setSelectedAnnotationId(null)
            }}
            title="Tekst toevoegen: klik op de pagina"
          >
            <IconType size={14} /> Tekst
          </button>
        </div>

        {showHighlightControls && (
          <div className="editbar__group">
            <div className="editbar__swatches">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${shownHighlightColor === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  title={color}
                  onClick={() => {
                    setHighlightColor(color)
                    applyHighlightPatch({ color })
                  }}
                />
              ))}
            </div>
            <label className="editbar__slider" title="Doorzichtigheid van de markering">
              <input
                type="range"
                min={10}
                max={90}
                step={5}
                value={Math.round(shownHighlightOpacity * 100)}
                onChange={(e) => {
                  const opacity = Number(e.target.value) / 100
                  setHighlightOpacity(opacity)
                  applyHighlightPatch({ opacity })
                }}
              />
              <span>{Math.round(shownHighlightOpacity * 100)}%</span>
            </label>
          </div>
        )}

        {showTextControls && (
          <div className="editbar__group">
            <select
              className="editbar__select"
              value={shownTextFont}
              title="Lettertype"
              onChange={(e) => {
                const font = e.target.value as AnnotationFont
                setTextFont(font)
                applyTextPatch({ font })
              }}
            >
              {(Object.keys(ANNOTATION_FONT_LABELS) as AnnotationFont[]).map((font) => (
                <option key={font} value={font}>
                  {ANNOTATION_FONT_LABELS[font]}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="editbar__size"
              min={6}
              max={96}
              value={shownTextSize}
              title="Tekstgrootte (pt)"
              onChange={(e) => {
                const size = Math.max(6, Math.min(96, Number(e.target.value) || 16))
                setTextSize(size)
                applyTextPatch({ size })
              }}
            />
            <button
              type="button"
              className={`editbar__toggle editbar__toggle--bold${shownTextBold ? ' editbar__toggle--active' : ''}`}
              title="Vet"
              onClick={() => {
                setTextBold(!shownTextBold)
                applyTextPatch({ bold: !shownTextBold })
              }}
            >
              B
            </button>
            <button
              type="button"
              className={`editbar__toggle editbar__toggle--italic${shownTextItalic ? ' editbar__toggle--active' : ''}`}
              title="Cursief"
              onClick={() => {
                setTextItalic(!shownTextItalic)
                applyTextPatch({ italic: !shownTextItalic })
              }}
            >
              I
            </button>
            <div className="editbar__swatches">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${shownTextColor === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  title={color}
                  onClick={() => {
                    setTextColor(color)
                    applyTextPatch({ color })
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="editbar__spacer" />

        {activeSignature ? (
          <div className="editbar__signature" ref={sigPickerRef}>
            <div className="lightbox__tray" title="Houd ingedrukt en sleep naar de pagina om te plaatsen" {...trayDrag}>
              <img src={activeSignature.dataUrl} alt="Handtekening" draggable={false} />
              <span>Sleep om te plaatsen</span>
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
              <div className="dropdown-menu signature-menu signature-menu--lightbox" onClick={(e) => e.stopPropagation()}>
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
          <span className="editbar__hint">Laad een handtekening via het menu links om te ondertekenen</span>
        )}
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
        <IconChevronLeft size={22} />
      </button>

      <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {image ? (
          <div
            key={context.page.id}
            className={`lightbox__page-wrap lightbox__page-wrap--enter${
              mode === 'highlight' ? ' lightbox__page-wrap--highlighting' : ''
            }${mode === 'text' ? ' lightbox__page-wrap--texting' : ''}`}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onClick={onStageClick}
          >
            <img ref={stageImgRef} src={image} alt={context.group.name} draggable={false} />
            {context.page.annotations.map((annotation) => annotationOverlay(annotation))}
            {context.page.signatures.map((placement: SignaturePlacement) => {
              const box = boxes[placement.id]
              if (!box) return null
              return (
                <div
                  key={placement.id}
                  className={`signature-overlay${mode !== 'view' ? ' annotation-overlay--passive' : ''}`}
                  style={{
                    left: box.pivotX * cssScale,
                    top: (box.pivotY - box.height) * cssScale,
                    width: box.width * cssScale,
                    height: box.height * cssScale,
                    transform: `rotate(${box.rotateDeg}deg)`
                  }}
                  onPointerDown={(e) => beginDrag(e, 'signature', 'move', placement.id, box)}
                  onPointerMove={onOverlayPointerMove}
                  onPointerUp={endDrag}
                >
                  <img src={placement.imageDataUrl} alt="Handtekening" draggable={false} />
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger signature-overlay__remove"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSignaturePlacement(context.page.id, placement.id)
                    }}
                  >
                    <IconClose size={11} />
                  </button>
                  <div
                    className="signature-overlay__resize"
                    onPointerDown={(e) => beginDrag(e, 'signature', 'resize', placement.id, box)}
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={endDrag}
                  />
                </div>
              )
            })}
            {band && (
              <div
                className="highlight-band"
                style={{
                  left: Math.min(band.x1, band.x2),
                  top: Math.min(band.y1, band.y2),
                  width: Math.abs(band.x2 - band.x1),
                  height: Math.abs(band.y2 - band.y1),
                  background: shownHighlightColor,
                  opacity: shownHighlightOpacity
                }}
              />
            )}
            {textEditor && (
              <div
                className="text-editor"
                style={{ left: textEditor.visualX * cssScale, top: textEditor.visualY * cssScale }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <textarea
                  autoFocus
                  value={textEditor.value}
                  placeholder="Typ tekst…"
                  style={{
                    color: shownTextColor,
                    fontFamily: ANNOTATION_FONT_CSS[shownTextFont],
                    fontSize: shownTextSize * cssScale,
                    lineHeight: TEXT_LINE_HEIGHT,
                    fontWeight: shownTextBold ? 700 : 400,
                    fontStyle: shownTextItalic ? 'italic' : 'normal'
                  }}
                  onChange={(e) => setTextEditor({ ...textEditor, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void commitTextEditor()
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setTextEditor(null)
                    }
                  }}
                  onBlur={() => void commitTextEditor()}
                />
                <div className="text-editor__hint">Enter = plaatsen · Shift+Enter = nieuwe regel</div>
              </div>
            )}
          </div>
        ) : (
          <div className="lightbox__loading" />
        )}
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
        <IconChevronRight size={22} />
      </button>

      <LightboxFilmstrip />

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
