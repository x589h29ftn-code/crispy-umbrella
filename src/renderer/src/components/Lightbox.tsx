import { useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import {
  contentPointsToVisualPoints,
  getPageVisualSize,
  getPlacementVisualBox,
  renderThumbnail,
  textAnnotationBlockHeight,
  TEXT_LINE_HEIGHT,
  visualPointsToContentPoints,
  visualPointToContentPoint,
  visualRectToContentRect,
  visualRectToSignaturePlacement,
  type SignatureVisualBox
} from '../lib/pdfEngine'
import {
  ANNOTATION_FONT_CSS,
  ANNOTATION_FONT_LABELS,
  HIGHLIGHT_COLORS,
  INK_WIDTHS,
  TEXT_COLORS
} from '../lib/annotationStyle'
import { useStudioStore } from '../store'
import { usePressDrag } from '../hooks/usePressDrag'
import { useClickOutside } from '../hooks/useClickOutside'
import { getTextLineBoxes, type TextLineBox } from '../lib/textLines'
import { findSearchHitRects, type SearchHitRect } from '../lib/searchHits'
import { buildStampSub, ShapeGeometry, ShapePreviewIcon, SHAPE_LABELS, STAMP_PRESETS } from '../lib/shapes'
import type {
  Annotation,
  AnnotationFont,
  HighlightAnnotation,
  InkAnnotation,
  PageComment,
  RedactAnnotation,
  ShapeAnnotation,
  ShapeKind,
  SignaturePlacement,
  StampAnnotation,
  TextAnnotation
} from '../types'
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconComment,
  IconCursor,
  IconEditText,
  IconEraser,
  IconForm,
  IconHighlighter,
  IconMinus,
  IconPen,
  IconPlus,
  IconRedact,
  IconRotate,
  IconShapes,
  IconStamp,
  IconTrash,
  IconType
} from './icons'
import LightboxFilmstrip from './LightboxFilmstrip'
import FormLayer from './FormLayer'

const DEFAULT_SIGNATURE_WIDTH_PCT = 0.28
const MIN_HIGHLIGHT_SIZE_PX = 5
const MAX_PAGE_ZOOM = 5

type EditMode =
  | 'view'
  | 'highlight'
  | 'text'
  | 'draw'
  | 'erase'
  | 'redact'
  | 'edittext'
  | 'comment'
  | 'shape'
  | 'stamp'
  | 'form'

export function formatCommentTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

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
  /** Set when moving an ink stroke: its points (content space) at gesture start. */
  inkStartPoints?: { x: number; y: number }[]
}

interface TextEditorState {
  /** null while creating a new annotation */
  annotationId: string | null
  /** top-left of the text block in page-visual units */
  visualX: number
  visualY: number
  value: string
  /** In-place text editing: white-out box (visual units) placed over the original line on commit. */
  coverVisualRect?: { x: number; y: number; width: number; height: number }
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
  const addComment = useStudioStore((s) => s.addComment)
  const updateComment = useStudioStore((s) => s.updateComment)
  const addCommentReply = useStudioStore((s) => s.addCommentReply)
  const removeComment = useStudioStore((s) => s.removeComment)
  const focusCommentId = useStudioStore((s) => s.focusCommentId)
  const clearFocusComment = useStudioStore((s) => s.clearFocusComment)

  const [image, setImage] = useState<string | null>(null)
  const [boxes, setBoxes] = useState<Record<string, SignatureVisualBox>>({})
  const [annoBoxes, setAnnoBoxes] = useState<Record<string, SignatureVisualBox>>({})
  const [inkVisual, setInkVisual] = useState<Record<string, { x: number; y: number }[]>>({})
  const [pageVisualSize, setPageVisualSize] = useState<{ width: number; height: number } | null>(null)
  const stageImgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragOriginRef = useRef<DragTarget | null>(null)

  // Zoom & pan of the opened page itself
  const [pageZoom, setPageZoom] = useState(1)
  const [pagePan, setPagePan] = useState({ x: 0, y: 0 })
  const panDragRef = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(
    null
  )

  // Editing menu state
  const [mode, setMode] = useState<EditMode>('view')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0])
  const [highlightOpacity, setHighlightOpacity] = useState(0.4)
  const [inkColor, setInkColor] = useState(HIGHLIGHT_COLORS[1])
  const [inkWidth, setInkWidth] = useState(INK_WIDTHS[1])
  const [shapeKind, setShapeKind] = useState<ShapeKind>('arrow')
  const [shapeColor, setShapeColor] = useState(TEXT_COLORS[1])
  const [shapeWidth, setShapeWidth] = useState(INK_WIDTHS[1])
  const [stampKey, setStampKey] = useState(STAMP_PRESETS[0].key)
  const authorName = useStudioStore((st) => st.authorName)
  const flattenForms = useStudioStore((st) => st.flattenForms)
  const setFlattenForms = useStudioStore((st) => st.setFlattenForms)
  const [formFieldCount, setFormFieldCount] = useState<number | null>(null)
  const [textFont, setTextFont] = useState<AnnotationFont>('arial')
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
  const [liveStroke, setLiveStroke] = useState<{ x: number; y: number }[] | null>(null)
  const liveStrokeRef = useRef<{ x: number; y: number }[] | null>(null)
  const [textLines, setTextLines] = useState<TextLineBox[] | null>(null)
  const [searchHits, setSearchHits] = useState<SearchHitRect[]>([])
  const searchHighlight = useStudioStore((st) => st.searchHighlight)
  const setSearchHighlight = useStudioStore((st) => st.setSearchHighlight)
  const [commentPins, setCommentPins] = useState<Record<string, { x: number; y: number }>>({})
  const [openCommentId, setOpenCommentId] = useState<string | null>(null)
  const [newComment, setNewComment] = useState<{ visualX: number; visualY: number; value: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
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

  // Reset edit & zoom state when navigating to another page or closing.
  useEffect(() => {
    setSelectedAnnotationId(null)
    setTextEditor(null)
    setBand(null)
    setLiveStroke(null)
    liveStrokeRef.current = null
    setPageZoom(1)
    setPagePan({ x: 0, y: 0 })
    setTextLines(null)
    setOpenCommentId(null)
    setNewComment(null)
    setReplyDraft('')
    setFormFieldCount(null)
  }, [lightbox.pageId])

  // Flash de zoektreffers op de pagina na een klik in het zoekpaneel.
  useEffect(() => {
    let cancelled = false
    if (!context || !searchHighlight || searchHighlight.pageId !== context.page.id) {
      setSearchHits([])
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    findSearchHitRects(source, context.page.sourcePageIndex, context.page.rotation, searchHighlight.query)
      .then((rects) => {
        if (!cancelled) setSearchHits(rects)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [context, sources, searchHighlight])

  // A click in the comments timeline jumps straight to that thread.
  useEffect(() => {
    if (!focusCommentId || !context) return
    if (context.page.comments.some((c) => c.id === focusCommentId)) {
      setMode('view')
      setOpenCommentId(focusCommentId)
      clearFocusComment()
    }
  }, [focusCommentId, context, clearFocusComment])

  // Comment pins need their anchor converted to visual coordinates.
  useEffect(() => {
    let cancelled = false
    if (!context || context.page.comments.length === 0) {
      setCommentPins({})
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    contentPointsToVisualPoints(
      source,
      context.page.sourcePageIndex,
      context.page.rotation,
      context.page.comments.map((c) => ({ x: c.x, y: c.y }))
    )
      .then((points) => {
        if (cancelled) return
        setCommentPins(Object.fromEntries(context.page.comments.map((c, i) => [c.id, points[i]])))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [context, sources])

  // In-place text editing needs the native text line positions.
  useEffect(() => {
    let cancelled = false
    if (mode !== 'edittext' || !context) return
    const source = sources.get(context.page.sourceId)
    if (!source) return
    getTextLineBoxes(source, context.page.sourcePageIndex, context.page.rotation)
      .then((lines) => {
        if (!cancelled) setTextLines(lines)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [mode, context, sources])

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

  // Ctrl+wheel zooms the page, plain wheel pans when zoomed in.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !lightbox.open) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setPageZoom((z) => Math.min(MAX_PAGE_ZOOM, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
      } else {
        setPageZoom((z) => {
          if (z > 1) {
            e.preventDefault()
            setPagePan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
          }
          return z
        })
      }
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [lightbox.open])

  useEffect(() => {
    if (pageZoom <= 1) setPagePan({ x: 0, y: 0 })
  }, [pageZoom])

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
      setInkVisual({})
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    const boxAnnotations = context.page.annotations.filter((a) => a.type !== 'ink' && a.type !== 'shape')
    const inkAnnotations = context.page.annotations.filter(
      (a): a is InkAnnotation | ShapeAnnotation => a.type === 'ink' || a.type === 'shape'
    )
    Promise.all([
      Promise.all(
        context.page.signatures.map(async (s) => [
          s.id,
          await getPlacementVisualBox(source, context.page.sourcePageIndex, context.page.rotation, s)
        ] as const)
      ),
      Promise.all(
        boxAnnotations.map(async (a) => [
          a.id,
          await getPlacementVisualBox(source, context.page.sourcePageIndex, context.page.rotation, {
            x: (a as HighlightAnnotation | RedactAnnotation | TextAnnotation | StampAnnotation).x,
            y: (a as HighlightAnnotation | RedactAnnotation | TextAnnotation | StampAnnotation).y,
            width: a.type === 'highlight' || a.type === 'redact' || a.type === 'stamp' ? a.width : 0,
            height:
              a.type === 'highlight' || a.type === 'redact' || a.type === 'stamp'
                ? a.height
                : textAnnotationBlockHeight(a as TextAnnotation)
          })
        ] as const)
      ),
      Promise.all(
        inkAnnotations.map(async (a) => [
          a.id,
          await contentPointsToVisualPoints(source, context.page.sourcePageIndex, context.page.rotation, a.points)
        ] as const)
      )
    ])
      .then(([sigEntries, annoEntries, inkEntries]) => {
        if (cancelled) return
        setBoxes(Object.fromEntries(sigEntries))
        setAnnoBoxes(Object.fromEntries(annoEntries))
        setInkVisual(Object.fromEntries(inkEntries))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [context, sources])

  if (!lightbox.open || !context) return null

  const source = sources.get(context.page.sourceId)
  // layoutScale positions overlays *inside* the (possibly zoom-transformed)
  // page wrap; screenScale converts pointer client-coordinates to page units
  // and therefore includes the page zoom.
  const layoutScale =
    pageVisualSize && stageImgRef.current ? stageImgRef.current.clientWidth / pageVisualSize.width : 1
  const screenScale =
    pageVisualSize && stageImgRef.current
      ? stageImgRef.current.getBoundingClientRect().width / pageVisualSize.width
      : 1

  function stagePointToVisual(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!stageImgRef.current) return null
    const rect = stageImgRef.current.getBoundingClientRect()
    return { x: (clientX - rect.left) / screenScale, y: (clientY - rect.top) / screenScale }
  }

  async function placeSignatureAt(clientX: number, clientY: number): Promise<void> {
    if (!activeSignature || !source || !context || !stageImgRef.current || !pageVisualSize) return
    const rect = stageImgRef.current.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return
    const dropVisualX = (clientX - rect.left) / screenScale
    const dropVisualY = (clientY - rect.top) / screenScale
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
    e: React.PointerEvent<Element>,
    type: 'signature' | 'annotation',
    kind: 'move' | 'resize',
    targetId: string,
    box: SignatureVisualBox,
    inkStartPoints?: { x: number; y: number }[]
  ): void {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
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
      rotateDeg: box.rotateDeg,
      inkStartPoints
    }
  }

  function onOverlayPointerMove(e: React.PointerEvent<Element>): void {
    const origin = dragOriginRef.current
    if (!origin || !source || !context) return
    const dx = (e.clientX - origin.startClientX) / screenScale
    const dy = (e.clientY - origin.startClientY) / screenScale
    const pageId = context.page.id

    if (origin.kind === 'move' && origin.inkStartPoints) {
      // Translate the whole stroke: convert the pivot before/after to content
      // space and shift every point by the same content-space delta.
      const startPoints = origin.inkStartPoints
      void visualPointsToContentPoints(source, context.page.sourcePageIndex, context.page.rotation, [
        { x: origin.startPivotVisualX, y: origin.startPivotVisualY },
        { x: origin.startPivotVisualX + dx, y: origin.startPivotVisualY + dy }
      ]).then(([from, to]) => {
        const ddx = to.x - from.x
        const ddy = to.y - from.y
        updateAnnotation(pageId, origin.targetId, {
          points: startPoints.map((p) => ({ x: p.x + ddx, y: p.y + ddy }))
        })
      })
      return
    }

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

  function endDrag(e: React.PointerEvent<Element>): void {
    const el = e.currentTarget as Element
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    dragOriginRef.current = null
  }

  // --- Stage pointer handling: highlight band, freehand stroke, panning ---
  function onStagePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0 || !stageImgRef.current) return
    const rect = stageImgRef.current.getBoundingClientRect()
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom

    if ((mode === 'highlight' || mode === 'redact' || mode === 'shape') && inside) {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const point = stagePointToVisual(e.clientX, e.clientY)!
      bandRef.current = { x1: point.x, y1: point.y }
      setBand({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
      return
    }

    if (mode === 'draw' && inside) {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const point = stagePointToVisual(e.clientX, e.clientY)!
      liveStrokeRef.current = [point]
      setLiveStroke([point])
      return
    }

    if (mode === 'view' && pageZoom > 1) {
      // Pan the zoomed page by dragging empty page area.
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      panDragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: pagePan.x,
        startY: pagePan.y
      }
    }
  }

  function onStagePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (bandRef.current && pageVisualSize) {
      const point = stagePointToVisual(e.clientX, e.clientY)
      if (!point) return
      const x = Math.min(pageVisualSize.width, Math.max(0, point.x))
      const y = Math.min(pageVisualSize.height, Math.max(0, point.y))
      setBand({ x1: bandRef.current.x1, y1: bandRef.current.y1, x2: x, y2: y })
      return
    }
    if (liveStrokeRef.current && pageVisualSize) {
      const point = stagePointToVisual(e.clientX, e.clientY)
      if (!point) return
      const x = Math.min(pageVisualSize.width, Math.max(0, point.x))
      const y = Math.min(pageVisualSize.height, Math.max(0, point.y))
      const points = liveStrokeRef.current
      const last = points[points.length - 1]
      if (Math.hypot(x - last.x, y - last.y) >= 1.2) {
        liveStrokeRef.current = [...points, { x, y }]
        setLiveStroke(liveStrokeRef.current)
      }
      return
    }
    const pan = panDragRef.current
    if (pan) {
      setPagePan({ x: pan.startX + (e.clientX - pan.startClientX), y: pan.startY + (e.clientY - pan.startClientY) })
    }
  }

  function onStagePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    panDragRef.current = null

    if (bandRef.current) {
      const start = bandRef.current
      bandRef.current = null
      const finished = band
      setBand(null)
      if (!start || !finished || !source || !context || !pageVisualSize) return

      if (mode === 'shape') {
        // Keep the drag direction (matters for arrows).
        if (Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) * screenScale < 8) return
        const pageId = context.page.id
        void visualPointsToContentPoints(source, context.page.sourcePageIndex, context.page.rotation, [
          { x: finished.x1, y: finished.y1 },
          { x: finished.x2, y: finished.y2 }
        ]).then((points) => {
          const annotation: ShapeAnnotation = {
            id: nanoid(),
            type: 'shape',
            shape: shapeKind,
            points,
            color: shapeColor,
            strokeWidth: shapeWidth
          }
          addAnnotation(pageId, annotation)
          setSelectedAnnotationId(annotation.id)
        })
        return
      }

      const left = Math.min(finished.x1, finished.x2)
      const top = Math.min(finished.y1, finished.y2)
      const width = Math.abs(finished.x2 - finished.x1)
      const height = Math.abs(finished.y2 - finished.y1)
      if (width * screenScale < MIN_HIGHLIGHT_SIZE_PX || height * screenScale < MIN_HIGHLIGHT_SIZE_PX) return

      const visual = {
        xPct: left / pageVisualSize.width,
        yPct: top / pageVisualSize.height,
        wPct: width / pageVisualSize.width,
        hPct: height / pageVisualSize.height
      }
      const pageId = context.page.id
      const bandMode = mode
      void visualRectToContentRect(source, context.page.sourcePageIndex, context.page.rotation, visual).then(
        (rect) => {
          const annotation: Annotation =
            bandMode === 'redact'
              ? { id: nanoid(), type: 'redact', ...rect, fill: 'black' }
              : { id: nanoid(), type: 'highlight', ...rect, color: highlightColor, opacity: highlightOpacity }
          addAnnotation(pageId, annotation)
          setSelectedAnnotationId(annotation.id)
        }
      )
      return
    }

    if (liveStrokeRef.current) {
      const stroke = liveStrokeRef.current
      liveStrokeRef.current = null
      setLiveStroke(null)
      if (!source || !context || stroke.length < 2) return
      const pageId = context.page.id
      void visualPointsToContentPoints(source, context.page.sourcePageIndex, context.page.rotation, stroke).then(
        (points) => {
          const annotation: InkAnnotation = {
            id: nanoid(),
            type: 'ink',
            points,
            color: inkColor,
            strokeWidth: inkWidth
          }
          addAnnotation(pageId, annotation)
        }
      )
    }
  }

  // --- Text placement & editing ---
  function onStageClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (mode === 'text' && !textEditor) {
      const point = stagePointToVisual(e.clientX, e.clientY)
      if (!point) return
      setTextEditor({ annotationId: null, visualX: point.x, visualY: point.y, value: '' })
      return
    }
    if (mode === 'comment') {
      const point = stagePointToVisual(e.clientX, e.clientY)
      if (!point) return
      setOpenCommentId(null)
      setNewComment({ visualX: point.x, visualY: point.y, value: '' })
      return
    }
    if (mode === 'stamp') {
      const point = stagePointToVisual(e.clientX, e.clientY)
      if (!point || !source || !context || !pageVisualSize) return
      const preset = STAMP_PRESETS.find((p) => p.key === stampKey) ?? STAMP_PRESETS[0]
      const w = Math.min(220, Math.max(110, pageVisualSize.width * 0.26))
      const h = w * 0.34
      const pageId = context.page.id
      void visualRectToContentRect(source, context.page.sourcePageIndex, context.page.rotation, {
        xPct: (point.x - w / 2) / pageVisualSize.width,
        yPct: (point.y - h / 2) / pageVisualSize.height,
        wPct: w / pageVisualSize.width,
        hPct: h / pageVisualSize.height
      }).then((rect) => {
        const annotation: StampAnnotation = {
          id: nanoid(),
          type: 'stamp',
          ...rect,
          label: preset.label,
          sub: buildStampSub(authorName),
          color: preset.color
        }
        addAnnotation(pageId, annotation)
        setSelectedAnnotationId(annotation.id)
      })
      return
    }
    if (mode === 'view') {
      setSelectedAnnotationId(null)
      setOpenCommentId(null)
      setNewComment(null)
    }
  }

  async function commitNewComment(): Promise<void> {
    const draft = newComment
    if (!draft || !source || !context) return
    setNewComment(null)
    const text = draft.value.trim()
    if (!text) return
    const { x, y } = await visualPointToContentPoint(
      source,
      context.page.sourcePageIndex,
      context.page.rotation,
      draft.visualX,
      draft.visualY
    )
    const comment: PageComment = {
      id: nanoid(),
      x,
      y,
      text,
      createdAt: Date.now(),
      resolved: false,
      replies: []
    }
    addComment(context.page.id, comment)
    setOpenCommentId(comment.id)
  }

  async function commitTextEditor(): Promise<void> {
    const editor = textEditorRef.current
    if (!editor || !source || !context) return
    textEditorRef.current = null
    setTextEditor(null)
    const value = editor.value.replace(/\s+$/, '')
    const pageId = context.page.id

    // In-place editing: put a white-out box over the original line first. An
    // empty value means "remove this line" — then only the white-out remains.
    if (editor.coverVisualRect && pageVisualSize) {
      const cover = editor.coverVisualRect
      const rect = await visualRectToContentRect(source, context.page.sourcePageIndex, context.page.rotation, {
        xPct: cover.x / pageVisualSize.width,
        yPct: cover.y / pageVisualSize.height,
        wPct: cover.width / pageVisualSize.width,
        hPct: cover.height / pageVisualSize.height
      })
      const whiteout: RedactAnnotation = { id: nanoid(), type: 'redact', ...rect, fill: 'white' }
      addAnnotation(pageId, whiteout)
    }

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

  // In-place editing: click on a native text line → prefilled editor over it;
  // on commit a white-out covers the original and the new text is placed on top.
  function startEditLine(line: TextLineBox): void {
    const pad = 1.5
    setTextFont('arial')
    setTextSize(Math.max(6, Math.round(line.fontSize)))
    setTextBold(false)
    setTextItalic(false)
    setTextColor('#111111')
    setSelectedAnnotationId(null)
    setTextEditor({
      annotationId: null,
      visualX: line.visual.x,
      visualY: line.visual.y,
      value: line.str,
      coverVisualRect: {
        x: line.visual.x - pad,
        y: line.visual.y - pad,
        width: line.visual.width + pad * 2,
        height: line.visual.height + pad * 2
      }
    })
  }

  /** Lines already covered by a white-out shouldn't be clickable again. */
  function lineCovered(line: TextLineBox): boolean {
    if (!context) return false
    const cx = line.visual.x + line.visual.width / 2
    const cy = line.visual.y + line.visual.height / 2
    return context.page.annotations.some((a) => {
      if (a.type !== 'redact') return false
      const b = annoBoxes[a.id]
      if (!b) return false
      return cx >= b.pivotX && cx <= b.pivotX + b.width && cy >= b.pivotY - b.height && cy <= b.pivotY
    })
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

  function applyInkPatch(patch: Partial<InkAnnotation>): void {
    if (context && selectedAnnotation?.type === 'ink') {
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

  function applyShapePatch(patch: Partial<ShapeAnnotation>): void {
    if (context && selectedAnnotation?.type === 'shape') {
      markHistory()
      updateAnnotation(context.page.id, selectedAnnotation.id, patch)
    }
  }

  const shownHighlightColor = selectedAnnotation?.type === 'highlight' ? selectedAnnotation.color : highlightColor
  const shownHighlightOpacity =
    selectedAnnotation?.type === 'highlight' ? selectedAnnotation.opacity : highlightOpacity
  const shownInkColor = selectedAnnotation?.type === 'ink' ? selectedAnnotation.color : inkColor
  const shownInkWidth = selectedAnnotation?.type === 'ink' ? selectedAnnotation.strokeWidth : inkWidth
  const shownTextFont = selectedAnnotation?.type === 'text' ? selectedAnnotation.font : textFont
  const shownTextSize = selectedAnnotation?.type === 'text' ? selectedAnnotation.size : textSize
  const shownTextBold = selectedAnnotation?.type === 'text' ? selectedAnnotation.bold : textBold
  const shownTextItalic = selectedAnnotation?.type === 'text' ? selectedAnnotation.italic : textItalic
  const shownTextColor = selectedAnnotation?.type === 'text' ? selectedAnnotation.color : textColor

  const shownShapeKind = selectedAnnotation?.type === 'shape' ? selectedAnnotation.shape : shapeKind
  const shownShapeColor = selectedAnnotation?.type === 'shape' ? selectedAnnotation.color : shapeColor
  const shownShapeWidth = selectedAnnotation?.type === 'shape' ? selectedAnnotation.strokeWidth : shapeWidth

  const showHighlightControls = mode === 'highlight' || selectedAnnotation?.type === 'highlight'
  const showInkControls = mode === 'draw' || selectedAnnotation?.type === 'ink'
  const showTextControls = mode === 'text' || selectedAnnotation?.type === 'text'
  const showShapeControls = mode === 'shape' || selectedAnnotation?.type === 'shape'
  const showStampControls = mode === 'stamp'

  const overlaysPassive = mode !== 'view' && mode !== 'erase'

  function inkOverlay(annotation: InkAnnotation): JSX.Element | null {
    const points = inkVisual[annotation.id]
    if (!points || points.length < 2 || !pageVisualSize) return null
    const isSelected = annotation.id === selectedAnnotationId
    const path = points.map((p) => `${p.x},${p.y}`).join(' ')
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const bounds = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    }
    function eraseHit(e: React.PointerEvent): void {
      if (mode === 'erase' && (e.buttons & 1 || e.type === 'pointerdown')) {
        e.stopPropagation()
        removeAnnotation(context!.page.id, annotation.id)
        if (annotation.id === selectedAnnotationId) setSelectedAnnotationId(null)
      }
    }
    return (
      <svg
        key={annotation.id}
        className="ink-overlay"
        width={pageVisualSize.width * layoutScale}
        height={pageVisualSize.height * layoutScale}
        viewBox={`0 0 ${pageVisualSize.width} ${pageVisualSize.height}`}
      >
        {isSelected && (
          <rect
            x={bounds.minX - 4}
            y={bounds.minY - 4}
            width={bounds.maxX - bounds.minX + 8}
            height={bounds.maxY - bounds.minY + 8}
            className="ink-overlay__selection"
          />
        )}
        <polyline points={path} fill="none" stroke={annotation.color} strokeWidth={annotation.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        <polyline
          points={path}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(12, annotation.strokeWidth + 8)}
          className={`ink-overlay__hit${overlaysPassive ? ' ink-overlay__hit--passive' : ''}${mode === 'erase' ? ' ink-overlay__hit--erase' : ''}`}
          onPointerDown={(e) => {
            if (mode === 'erase') {
              eraseHit(e)
              return
            }
            setSelectedAnnotationId(annotation.id)
            beginDrag(
              e,
              'annotation',
              'move',
              annotation.id,
              {
                pivotX: bounds.minX,
                pivotY: bounds.maxY,
                width: bounds.maxX - bounds.minX,
                height: bounds.maxY - bounds.minY,
                rotateDeg: 0
              },
              annotation.points
            )
          }}
          onPointerEnter={eraseHit}
          onPointerMove={onOverlayPointerMove}
          onPointerUp={endDrag}
          onClick={(e) => e.stopPropagation()}
        />
      </svg>
    )
  }

  function shapeOverlay(annotation: ShapeAnnotation): JSX.Element | null {
    const points = inkVisual[annotation.id]
    if (!points || points.length < 2 || !pageVisualSize) return null
    const [p1, p2] = points
    const isSelected = annotation.id === selectedAnnotationId
    const bounds = {
      minX: Math.min(p1.x, p2.x),
      minY: Math.min(p1.y, p2.y),
      maxX: Math.max(p1.x, p2.x),
      maxY: Math.max(p1.y, p2.y)
    }
    function eraseHit(e: React.PointerEvent): void {
      if (mode === 'erase' && (e.buttons & 1 || e.type === 'pointerdown')) {
        e.stopPropagation()
        removeAnnotation(context!.page.id, annotation.id)
        if (annotation.id === selectedAnnotationId) setSelectedAnnotationId(null)
      }
    }
    const hitProps = {
      className: `ink-overlay__hit${overlaysPassive ? ' ink-overlay__hit--passive' : ''}${mode === 'erase' ? ' ink-overlay__hit--erase' : ''}`,
      onPointerDown: (e: React.PointerEvent) => {
        if (mode === 'erase') {
          eraseHit(e)
          return
        }
        setSelectedAnnotationId(annotation.id)
        beginDrag(
          e,
          'annotation',
          'move',
          annotation.id,
          {
            pivotX: bounds.minX,
            pivotY: bounds.maxY,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY,
            rotateDeg: 0
          },
          annotation.points
        )
      },
      onPointerEnter: eraseHit,
      onPointerMove: onOverlayPointerMove,
      onPointerUp: endDrag,
      onClick: (e: React.MouseEvent) => e.stopPropagation()
    }
    const hitStroke = Math.max(14, annotation.strokeWidth + 10)
    return (
      <svg
        key={annotation.id}
        className="ink-overlay"
        width={pageVisualSize.width * layoutScale}
        height={pageVisualSize.height * layoutScale}
        viewBox={`0 0 ${pageVisualSize.width} ${pageVisualSize.height}`}
      >
        {isSelected && (
          <rect
            x={bounds.minX - 6}
            y={bounds.minY - 6}
            width={bounds.maxX - bounds.minX + 12}
            height={bounds.maxY - bounds.minY + 12}
            className="ink-overlay__selection"
          />
        )}
        <ShapeGeometry shape={annotation.shape} p1={p1} p2={p2} color={annotation.color} strokeWidth={annotation.strokeWidth} />
        {annotation.shape === 'rect' || annotation.shape === 'ellipse' ? (
          <rect
            x={bounds.minX}
            y={bounds.minY}
            width={Math.max(1, bounds.maxX - bounds.minX)}
            height={Math.max(1, bounds.maxY - bounds.minY)}
            fill="transparent"
            stroke="transparent"
            strokeWidth={hitStroke}
            {...hitProps}
          />
        ) : (
          <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={hitStroke} {...hitProps} />
        )}
      </svg>
    )
  }

  function annotationOverlay(annotation: Annotation): JSX.Element | null {
    if (annotation.type === 'ink') return inkOverlay(annotation)
    if (annotation.type === 'shape') return shapeOverlay(annotation)
    const box = annoBoxes[annotation.id]
    if (!box) return null
    const isSelected = annotation.id === selectedAnnotationId
    const common = {
      left: box.pivotX * layoutScale,
      top: (box.pivotY - box.height) * layoutScale,
      transform: `rotate(${box.rotateDeg}deg)`
    }
    return (
      <div
        key={annotation.id}
        className={`annotation-overlay${isSelected ? ' annotation-overlay--selected' : ''}${
          overlaysPassive || mode === 'erase' ? ' annotation-overlay--passive' : ''
        }`}
        style={
          annotation.type === 'highlight' || annotation.type === 'redact' || annotation.type === 'stamp'
            ? { ...common, width: box.width * layoutScale, height: box.height * layoutScale }
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
        {annotation.type === 'redact' ? (
          <div
            className={`annotation-overlay__redact annotation-overlay__redact--${annotation.fill}`}
          />
        ) : annotation.type === 'stamp' ? (
          <div
            className="annotation-overlay__stamp"
            style={{ ['--stamp-color' as string]: annotation.color, ['--stamp-h' as string]: `${box.height * layoutScale}px` }}
          >
            <span className="annotation-overlay__stamp-label">{annotation.label}</span>
            {annotation.sub && <span className="annotation-overlay__stamp-sub">{annotation.sub}</span>}
          </div>
        ) : annotation.type === 'highlight' ? (
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
              fontSize: annotation.size * layoutScale,
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
            {(annotation.type === 'highlight' || annotation.type === 'redact' || annotation.type === 'stamp') && (
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

  const wrapModeClass =
    mode === 'highlight' || mode === 'redact' || mode === 'shape'
      ? ' lightbox__page-wrap--highlighting'
      : mode === 'text' || mode === 'stamp'
        ? ' lightbox__page-wrap--texting'
        : mode === 'draw'
          ? ' lightbox__page-wrap--drawing'
          : mode === 'erase'
            ? ' lightbox__page-wrap--erasing'
            : pageZoom > 1
              ? ' lightbox__page-wrap--pannable'
              : ''

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
            className={`editbar__mode${mode === 'draw' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'draw' ? 'view' : 'draw'))
              setSelectedAnnotationId(null)
            }}
            title="Tekenen: schrijf of teken vrij op de pagina"
          >
            <IconPen size={14} /> Tekenen
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'shape' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'shape' ? 'view' : 'shape'))
              setSelectedAnnotationId(null)
            }}
            title="Vormen: sleep een pijl, lijn, rechthoek of ovaal"
          >
            <IconShapes size={14} /> Vormen
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'stamp' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'stamp' ? 'view' : 'stamp'))
              setSelectedAnnotationId(null)
            }}
            title="Stempel: klik op de pagina om een stempel te plaatsen"
          >
            <IconStamp size={14} /> Stempel
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'form' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'form' ? 'view' : 'form'))
              setSelectedAnnotationId(null)
            }}
            title="Formulier: vul formuliervelden in dit document in"
          >
            <IconForm size={14} /> Formulier
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
          <button
            type="button"
            className={`editbar__mode${mode === 'edittext' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'edittext' ? 'view' : 'edittext'))
              setSelectedAnnotationId(null)
            }}
            title="Tekst bewerken: klik op een bestaande tekstregel om hem aan te passen of te verwijderen"
          >
            <IconEditText size={14} /> Tekst bewerken
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'redact' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'redact' ? 'view' : 'redact'))
              setSelectedAnnotationId(null)
            }}
            title="Redigeren: sleep een zwart vak — bij export wordt de onderliggende tekst écht verwijderd"
          >
            <IconRedact size={14} /> Redigeren
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'comment' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'comment' ? 'view' : 'comment'))
              setSelectedAnnotationId(null)
            }}
            title="Commentaar: klik op de pagina om een opmerking te plaatsen"
          >
            <IconComment size={14} /> Commentaar
          </button>
          <button
            type="button"
            className={`editbar__mode${mode === 'erase' ? ' editbar__mode--active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'erase' ? 'view' : 'erase'))
              setSelectedAnnotationId(null)
            }}
            title="Gum: klik op een getekende lijn om hem te verwijderen"
          >
            <IconEraser size={14} /> Gum
          </button>
        </div>

        {mode === 'redact' && (
          <div className="editbar__group">
            <span className="editbar__note">Sleep een vak — bij export verdwijnt de onderliggende inhoud echt</span>
          </div>
        )}
        {mode === 'form' && (
          <div className="editbar__group">
            {formFieldCount === 0 && <span className="editbar__note">Geen formuliervelden op deze pagina</span>}
            <label className="editbar__checkbox" title="Bij het platslaan worden de velden vaste inhoud die niet meer te wijzigen is">
              <input type="checkbox" checked={flattenForms} onChange={(e) => setFlattenForms(e.target.checked)} />
              Platslaan bij export
            </label>
          </div>
        )}
        {mode === 'edittext' && textLines && textLines.length === 0 && (
          <div className="editbar__group">
            <span className="editbar__note">Geen tekstlaag op deze pagina — gebruik Tekst of voer eerst OCR uit</span>
          </div>
        )}

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

        {showInkControls && (
          <div className="editbar__group">
            <div className="editbar__swatches">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${shownInkColor === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  title={color}
                  onClick={() => {
                    setInkColor(color)
                    applyInkPatch({ color })
                  }}
                />
              ))}
            </div>
            <div className="editbar__widths" title="Lijndikte">
              {INK_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  className={`editbar__width${shownInkWidth === width ? ' editbar__width--active' : ''}`}
                  onClick={() => {
                    setInkWidth(width)
                    applyInkPatch({ strokeWidth: width })
                  }}
                >
                  <span style={{ width: 4 + width * 2, height: 4 + width * 2 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {showShapeControls && (
          <div className="editbar__group">
            <div className="editbar__shapes">
              {(Object.keys(SHAPE_LABELS) as ShapeKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`editbar__toggle${shownShapeKind === kind ? ' editbar__toggle--active' : ''}`}
                  title={SHAPE_LABELS[kind]}
                  onClick={() => {
                    setShapeKind(kind)
                    applyShapePatch({ shape: kind })
                  }}
                >
                  <ShapePreviewIcon kind={kind} />
                </button>
              ))}
            </div>
            <div className="editbar__swatches">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`editbar__swatch${shownShapeColor === color ? ' editbar__swatch--active' : ''}`}
                  style={{ background: color }}
                  title={color}
                  onClick={() => {
                    setShapeColor(color)
                    applyShapePatch({ color })
                  }}
                />
              ))}
            </div>
            <div className="editbar__widths" title="Lijndikte">
              {INK_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  className={`editbar__width${shownShapeWidth === width ? ' editbar__width--active' : ''}`}
                  onClick={() => {
                    setShapeWidth(width)
                    applyShapePatch({ strokeWidth: width })
                  }}
                >
                  <span style={{ width: 4 + width * 2, height: 4 + width * 2 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {showStampControls && (
          <div className="editbar__group">
            <div className="editbar__stamps">
              {STAMP_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`stamp-chip${stampKey === preset.key ? ' stamp-chip--active' : ''}`}
                  style={{ ['--stamp-color' as string]: preset.color }}
                  onClick={() => setStampKey(preset.key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <span className="editbar__note">Klik op de pagina — met datum{authorName.trim() ? ' en naam' : ''}</span>
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

        <div className="editbar__group editbar__zoom" title="Zoom op de pagina (of Ctrl+scrollen)">
          <button
            type="button"
            className="editbar__toggle"
            onClick={() => setPageZoom((z) => Math.max(1, z / 1.25))}
            title="Uitzoomen op pagina"
          >
            <IconMinus size={13} />
          </button>
          <button
            type="button"
            className="editbar__zoom-pct"
            onClick={() => setPageZoom(1)}
            title="Zoom herstellen"
          >
            {Math.round(pageZoom * 100)}%
          </button>
          <button
            type="button"
            className="editbar__toggle"
            onClick={() => setPageZoom((z) => Math.min(MAX_PAGE_ZOOM, z * 1.25))}
            title="Inzoomen op pagina"
          >
            <IconPlus size={13} />
          </button>
        </div>

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

      <div className="lightbox__stage" ref={stageRef} onClick={(e) => e.stopPropagation()}>
        {image ? (
          <div
            className="lightbox__zoomframe"
            style={{ transform: `translate(${pagePan.x}px, ${pagePan.y}px) scale(${pageZoom})` }}
          >
            <div
              key={context.page.id}
              className={`lightbox__page-wrap lightbox__page-wrap--enter${wrapModeClass}`}
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
                    className={`signature-overlay${overlaysPassive || mode === 'erase' ? ' annotation-overlay--passive' : ''}`}
                    style={{
                      left: box.pivotX * layoutScale,
                      top: (box.pivotY - box.height) * layoutScale,
                      width: box.width * layoutScale,
                      height: box.height * layoutScale,
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
              {searchHits.map((rect, i) => (
                <div
                  key={i}
                  className="search-hit-flash"
                  style={{
                    left: rect.x * layoutScale,
                    top: rect.y * layoutScale,
                    width: rect.width * layoutScale,
                    height: rect.height * layoutScale
                  }}
                />
              ))}
              {searchHits.length > 0 && (
                <div className="search-hit-chip" onPointerDown={(e) => e.stopPropagation()}>
                  {searchHits.length} {searchHits.length === 1 ? 'treffer' : 'treffers'}
                  <button type="button" className="icon-btn icon-btn--chrome" onClick={() => setSearchHighlight(null)}>
                    <IconClose size={11} />
                  </button>
                </div>
              )}
              {band && mode === 'shape' && pageVisualSize && (
                <svg
                  className="ink-overlay ink-overlay--live"
                  width={pageVisualSize.width * layoutScale}
                  height={pageVisualSize.height * layoutScale}
                  viewBox={`0 0 ${pageVisualSize.width} ${pageVisualSize.height}`}
                >
                  <ShapeGeometry
                    shape={shapeKind}
                    p1={{ x: band.x1, y: band.y1 }}
                    p2={{ x: band.x2, y: band.y2 }}
                    color={shapeColor}
                    strokeWidth={shapeWidth}
                  />
                </svg>
              )}
              {band && mode !== 'shape' && (
                <div
                  className="highlight-band"
                  style={{
                    left: Math.min(band.x1, band.x2) * layoutScale,
                    top: Math.min(band.y1, band.y2) * layoutScale,
                    width: Math.abs(band.x2 - band.x1) * layoutScale,
                    height: Math.abs(band.y2 - band.y1) * layoutScale,
                    background: mode === 'redact' ? '#000' : shownHighlightColor,
                    opacity: mode === 'redact' ? 0.85 : shownHighlightOpacity
                  }}
                />
              )}
              {mode === 'edittext' &&
                textLines &&
                textLines
                  .filter((line) => !lineCovered(line))
                  .map((line, idx) => (
                    <div
                      key={idx}
                      className="text-line-target"
                      title="Klik om deze tekstregel te bewerken"
                      style={{
                        left: line.visual.x * layoutScale,
                        top: line.visual.y * layoutScale,
                        width: line.visual.width * layoutScale,
                        height: line.visual.height * layoutScale
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        startEditLine(line)
                      }}
                    />
                  ))}
              {liveStroke && liveStroke.length >= 2 && pageVisualSize && (
                <svg
                  className="ink-overlay ink-overlay--live"
                  width={pageVisualSize.width * layoutScale}
                  height={pageVisualSize.height * layoutScale}
                  viewBox={`0 0 ${pageVisualSize.width} ${pageVisualSize.height}`}
                >
                  <polyline
                    points={liveStroke.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={inkColor}
                    strokeWidth={inkWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {source && (
                <FormLayer
                  source={source}
                  pageIndex={context.page.sourcePageIndex}
                  rotation={context.page.rotation}
                  scale={layoutScale}
                  active={mode === 'form'}
                  onFieldCount={setFormFieldCount}
                />
              )}
              {context.page.comments.map((comment) => {
                const pin = commentPins[comment.id]
                if (!pin) return null
                return (
                  <button
                    key={comment.id}
                    type="button"
                    className={`comment-pin${comment.resolved ? ' comment-pin--resolved' : ''}${
                      comment.id === openCommentId ? ' comment-pin--open' : ''
                    }`}
                    style={{ left: pin.x * layoutScale, top: pin.y * layoutScale }}
                    title={comment.text}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setNewComment(null)
                      setOpenCommentId((v) => (v === comment.id ? null : comment.id))
                      setReplyDraft('')
                    }}
                  >
                    {comment.resolved ? <IconCheck size={11} /> : <IconComment size={11} />}
                  </button>
                )
              })}
              {(() => {
                const comment = context.page.comments.find((c) => c.id === openCommentId)
                const pin = comment && commentPins[comment.id]
                if (!comment || !pin) return null
                return (
                  <div
                    className="comment-thread"
                    style={{ left: pin.x * layoutScale + 14, top: pin.y * layoutScale + 6 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="comment-thread__head">
                      <span className="comment-thread__time">
                        {comment.author && <strong className="comment-thread__author">{comment.author} · </strong>}
                        {formatCommentTime(comment.createdAt)}
                      </span>
                      <label className="comment-thread__resolve" title="Markeer als afgehandeld">
                        <input
                          type="checkbox"
                          checked={comment.resolved}
                          onChange={(e) => updateComment(context.page.id, comment.id, { resolved: e.target.checked })}
                        />
                        Afgehandeld
                      </label>
                      <button
                        type="button"
                        className="icon-btn icon-btn--chrome icon-btn--danger"
                        title="Opmerking verwijderen"
                        onClick={() => {
                          removeComment(context.page.id, comment.id)
                          setOpenCommentId(null)
                        }}
                      >
                        <IconTrash size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--chrome"
                        title="Sluiten"
                        onClick={() => setOpenCommentId(null)}
                      >
                        <IconClose size={12} />
                      </button>
                    </div>
                    <div className="comment-thread__text">{comment.text}</div>
                    {comment.replies.map((reply) => (
                      <div key={reply.id} className="comment-thread__reply">
                        <span className="comment-thread__time">
                          {reply.author && <strong className="comment-thread__author">{reply.author} · </strong>}
                          {formatCommentTime(reply.createdAt)}
                        </span>
                        <div>{reply.text}</div>
                      </div>
                    ))}
                    <input
                      type="text"
                      className="comment-thread__input"
                      placeholder="Beantwoorden…"
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && replyDraft.trim()) {
                          addCommentReply(context.page.id, comment.id, replyDraft.trim())
                          setReplyDraft('')
                        }
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setOpenCommentId(null)
                        }
                      }}
                    />
                  </div>
                )
              })()}
              {newComment && (
                <div
                  className="comment-thread"
                  style={{ left: newComment.visualX * layoutScale + 14, top: newComment.visualY * layoutScale + 6 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="comment-thread__head">
                    <span className="comment-thread__time">Nieuwe opmerking</span>
                    <button
                      type="button"
                      className="icon-btn icon-btn--chrome"
                      title="Annuleren"
                      onClick={() => setNewComment(null)}
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                  <textarea
                    autoFocus
                    className="comment-thread__textarea"
                    placeholder="Typ je opmerking…"
                    value={newComment.value}
                    onChange={(e) => setNewComment({ ...newComment, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void commitNewComment()
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setNewComment(null)
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="pill-btn pill-btn--primary comment-thread__submit"
                    disabled={!newComment.value.trim()}
                    onClick={() => void commitNewComment()}
                  >
                    Plaatsen
                  </button>
                </div>
              )}
              {textEditor && (
                <div
                  className="text-editor"
                  style={{ left: textEditor.visualX * layoutScale, top: textEditor.visualY * layoutScale }}
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
                      fontSize: shownTextSize * layoutScale,
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
