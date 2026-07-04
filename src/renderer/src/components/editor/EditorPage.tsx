import { useEffect, useRef, useState } from 'react'
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
  type SignatureVisualBox
} from '../../lib/pdfEngine'
import { ANNOTATION_FONT_CSS } from '../../lib/annotationStyle'
import { bandTextRects, getTextLineBoxes, type TextLineBox } from '../../lib/textLines'
import { renderTextSelectionLayer, selectionLineRects, type SelectionLineRect } from '../../lib/textLayer'
import { findSearchHitRects, type SearchHitRect } from '../../lib/searchHits'
import { useStudioStore } from '../../store'
import { formatCommentTime } from '../Lightbox'
import FormLayer from '../FormLayer'
import { buildStampSub, ShapeGeometry, STAMP_PRESETS } from '../../lib/shapes'
import type {
  Annotation,
  HighlightAnnotation,
  InkAnnotation,
  PageComment,
  RedactAnnotation,
  ShapeAnnotation,
  ShapeKind,
  SignaturePlacement,
  SourceFile,
  StampAnnotation,
  TextAnnotation
} from '../../types'
import { IconCheck, IconClose, IconComment, IconCopy, IconHighlighter, IconStrike, IconTrash, IconUnderline } from '../icons'

export type EditorMode =
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

export interface ToolSettings {
  highlightColor: string
  highlightOpacity: number
  inkColor: string
  inkWidth: number
  textFont: TextAnnotation['font']
  textSize: number
  textBold: boolean
  textItalic: boolean
  textColor: string
  shapeKind: ShapeKind
  shapeColor: string
  shapeWidth: number
  stampKey: string
}

export interface EditorSelection {
  pageId: string
  annotationId: string
}

const MIN_HIGHLIGHT_SIZE_PX = 5

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
  inkStartPoints?: { x: number; y: number }[]
}

interface TextEditorState {
  annotationId: string | null
  visualX: number
  visualY: number
  value: string
  coverVisualRect?: { x: number; y: number; width: number; height: number }
  /** Vast lettertype/grootte voor in-place bewerken: de vervangende tekst
   * krijgt de maat van de originele regel, niet de tool-instelling. */
  style?: { font: TextAnnotation['font']; size: number; bold: boolean; italic: boolean; color: string }
}

interface Props {
  page: import('../../types').PageRef
  pageNumber: number
  source: SourceFile | undefined
  cssWidth: number
  mode: EditorMode
  settings: ToolSettings
  selection: EditorSelection | null
  onSelect: (selection: EditorSelection | null) => void
}

/**
 * One editable page inside the tabbed editor view: the full lightbox tool set
 * (markeren, tekenen, tekst, tekst bewerken, redigeren, commentaar, gum,
 * handtekeningen verslepen) on an inline, scrollable page.
 */
export default function EditorPage({
  page,
  pageNumber,
  source,
  cssWidth,
  mode,
  settings,
  selection,
  onSelect
}: Props): JSX.Element {
  const markHistory = useStudioStore((s) => s.markHistory)
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
  const authorName = useStudioStore((s) => s.authorName)

  const [image, setImage] = useState<string | null>(null)
  const [pageVisualSize, setPageVisualSize] = useState<{ width: number; height: number } | null>(null)
  const [boxes, setBoxes] = useState<Record<string, SignatureVisualBox>>({})
  const [annoBoxes, setAnnoBoxes] = useState<Record<string, SignatureVisualBox>>({})
  const [inkVisual, setInkVisual] = useState<Record<string, { x: number; y: number }[]>>({})
  const [commentPins, setCommentPins] = useState<Record<string, { x: number; y: number }>>({})
  const [textLines, setTextLines] = useState<TextLineBox[] | null>(null)
  const [band, setBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const bandRef = useRef<{ x1: number; y1: number } | null>(null)
  const [liveStroke, setLiveStroke] = useState<{ x: number; y: number }[] | null>(null)
  const liveStrokeRef = useRef<{ x: number; y: number }[] | null>(null)
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null)
  const textEditorRef = useRef<TextEditorState | null>(null)
  textEditorRef.current = textEditor
  const [openCommentId, setOpenCommentId] = useState<string | null>(null)
  const [newComment, setNewComment] = useState<{ visualX: number; visualY: number; value: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const searchHighlight = useStudioStore((st) => st.searchHighlight)
  const setSearchHighlight = useStudioStore((st) => st.setSearchHighlight)
  const [searchHits, setSearchHits] = useState<SearchHitRect[]>([])
  const imgRef = useRef<HTMLImageElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [selPopup, setSelPopup] = useState<{ x: number; y: number; text: string; rects: SelectionLineRect[] } | null>(
    null
  )
  const dragOriginRef = useRef<DragTarget | null>(null)

  const scale = pageVisualSize ? cssWidth / pageVisualSize.width : 1
  const selectedAnnotationId = selection?.pageId === page.id ? selection.annotationId : null

  // Render the page at a resolution quantized to the display width.
  const renderWidth = Math.min(2800, Math.ceil((cssWidth * (window.devicePixelRatio || 1) * 1.3) / 200) * 200)
  useEffect(() => {
    let cancelled = false
    if (!source) return
    renderThumbnail(source, page.sourcePageIndex, page.rotation, renderWidth)
      .then((url) => {
        if (!cancelled) setImage(url)
      })
      .catch(() => undefined)
    getPageVisualSize(source, page.sourcePageIndex, page.rotation)
      .then((size) => {
        if (!cancelled) setPageVisualSize(size)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page.sourcePageIndex, page.rotation, renderWidth])

  useEffect(() => {
    let cancelled = false
    if (!source) return
    const boxAnnotations = page.annotations.filter((a) => a.type !== 'ink' && a.type !== 'shape')
    const inkAnnotations = page.annotations.filter(
      (a): a is InkAnnotation | ShapeAnnotation => a.type === 'ink' || a.type === 'shape'
    )
    Promise.all([
      Promise.all(
        page.signatures.map(async (s) => [
          s.id,
          await getPlacementVisualBox(source, page.sourcePageIndex, page.rotation, s)
        ] as const)
      ),
      Promise.all(
        boxAnnotations.map(async (a) => [
          a.id,
          await getPlacementVisualBox(source, page.sourcePageIndex, page.rotation, {
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
          await contentPointsToVisualPoints(source, page.sourcePageIndex, page.rotation, a.points)
        ] as const)
      ),
      contentPointsToVisualPoints(
        source,
        page.sourcePageIndex,
        page.rotation,
        page.comments.map((c) => ({ x: c.x, y: c.y }))
      )
    ])
      .then(([sigEntries, annoEntries, inkEntries, pinPoints]) => {
        if (cancelled) return
        setBoxes(Object.fromEntries(sigEntries))
        setAnnoBoxes(Object.fromEntries(annoEntries))
        setInkVisual(Object.fromEntries(inkEntries))
        setCommentPins(Object.fromEntries(page.comments.map((c, i) => [c.id, pinPoints[i]])))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page])

  // Zolang een zoekterm actief is, worden alle treffers op elke pagina geel
  // gemarkeerd; de aangeklikte/huidige treffer-pagina scrollt in beeld.
  useEffect(() => {
    let cancelled = false
    if (!source || !searchHighlight?.query) {
      setSearchHits([])
      return
    }
    findSearchHitRects(source, page.sourcePageIndex, page.rotation, searchHighlight.query)
      .then((rects) => {
        if (!cancelled) {
          setSearchHits(rects)
          if (searchHighlight.pageId === page.id) imgRef.current?.scrollIntoView({ block: 'center' })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source, page.id, page.sourcePageIndex, page.rotation, searchHighlight])

  // Selectable text layer (kopiëren + tekst-volgend markeren) in view mode.
  useEffect(() => {
    const el = textLayerRef.current
    if (!el || !source || !image) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      renderTextSelectionLayer(el, source, page.sourcePageIndex, page.rotation, scale).catch(() => undefined)
    }, 150)
    return () => {
      cancelled = true
      void cancelled
      window.clearTimeout(timer)
    }
  }, [source, image, page.sourcePageIndex, page.rotation, scale])

  useEffect(() => {
    let cancelled = false
    // Text lines drive in-place editing AND text-snapping for markeren/redigeren.
    if ((mode !== 'edittext' && mode !== 'highlight' && mode !== 'redact') || !source) return
    getTextLineBoxes(source, page.sourcePageIndex, page.rotation)
      .then((lines) => {
        if (!cancelled) setTextLines(lines)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [mode, source, page.sourcePageIndex, page.rotation])

  // A timeline click can target a comment on this page.
  useEffect(() => {
    if (!focusCommentId) return
    if (page.comments.some((c) => c.id === focusCommentId)) {
      setOpenCommentId(focusCommentId)
      clearFocusComment()
      imgRef.current?.scrollIntoView({ block: 'center' })
    }
  }, [focusCommentId, page.comments, clearFocusComment])

  function pointToVisual(clientX: number, clientY: number): { x: number; y: number } | null {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
  }

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
    markHistory()
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
    if (!origin || !source) return
    const dx = (e.clientX - origin.startClientX) / scale
    const dy = (e.clientY - origin.startClientY) / scale

    if (origin.kind === 'move' && origin.inkStartPoints) {
      const startPoints = origin.inkStartPoints
      void visualPointsToContentPoints(source, page.sourcePageIndex, page.rotation, [
        { x: origin.startPivotVisualX, y: origin.startPivotVisualY },
        { x: origin.startPivotVisualX + dx, y: origin.startPivotVisualY + dy }
      ]).then(([from, to]) => {
        const ddx = to.x - from.x
        const ddy = to.y - from.y
        updateAnnotation(page.id, origin.targetId, {
          points: startPoints.map((p) => ({ x: p.x + ddx, y: p.y + ddy }))
        })
      })
      return
    }

    if (origin.kind === 'move') {
      void visualPointToContentPoint(
        source,
        page.sourcePageIndex,
        page.rotation,
        origin.startPivotVisualX + dx,
        origin.startPivotVisualY + dy
      ).then(({ x, y }) => {
        if (origin.type === 'signature') updateSignaturePlacement(page.id, origin.targetId, { x, y })
        else updateAnnotation(page.id, origin.targetId, { x, y })
      })
    } else {
      const theta = (origin.rotateDeg * Math.PI) / 180
      const dxLocal = Math.cos(theta) * dx + Math.sin(theta) * dy
      const dyLocal = -Math.sin(theta) * dx + Math.cos(theta) * dy
      const patch = {
        width: Math.max(20, origin.startWidth + dxLocal),
        height: Math.max(origin.type === 'signature' ? 20 : 8, origin.startHeight + dyLocal)
      }
      if (origin.type === 'signature') updateSignaturePlacement(page.id, origin.targetId, patch)
      else updateAnnotation(page.id, origin.targetId, patch)
    }
  }

  function endDrag(e: React.PointerEvent<Element>): void {
    const el = e.currentTarget as Element
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    dragOriginRef.current = null
  }

  // --- Stage interactions ---
  function onStagePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const point = pointToVisual(e.clientX, e.clientY)
    if (!point) return

    if (mode === 'highlight' || mode === 'redact' || mode === 'shape') {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      bandRef.current = { x1: point.x, y1: point.y }
      setBand({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
    } else if (mode === 'draw') {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      liveStrokeRef.current = [point]
      setLiveStroke([point])
    }
  }

  function onStagePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!pageVisualSize) return
    const point = pointToVisual(e.clientX, e.clientY)
    if (!point) return
    const x = Math.min(pageVisualSize.width, Math.max(0, point.x))
    const y = Math.min(pageVisualSize.height, Math.max(0, point.y))
    if (bandRef.current) {
      setBand({ x1: bandRef.current.x1, y1: bandRef.current.y1, x2: x, y2: y })
    } else if (liveStrokeRef.current) {
      const points = liveStrokeRef.current
      const last = points[points.length - 1]
      if (Math.hypot(x - last.x, y - last.y) >= 1.2) {
        liveStrokeRef.current = [...points, { x, y }]
        setLiveStroke(liveStrokeRef.current)
      }
    }
  }

  function onStagePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)

    if (bandRef.current && band && source && pageVisualSize) {
      bandRef.current = null
      const finished = band
      setBand(null)

      if (mode === 'shape') {
        // Keep the drag direction (matters for arrows).
        if (Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) * scale < 8) return
        void visualPointsToContentPoints(source, page.sourcePageIndex, page.rotation, [
          { x: finished.x1, y: finished.y1 },
          { x: finished.x2, y: finished.y2 }
        ]).then((points) => {
          const annotation: ShapeAnnotation = {
            id: nanoid(),
            type: 'shape',
            shape: settings.shapeKind,
            points,
            color: settings.shapeColor,
            strokeWidth: settings.shapeWidth
          }
          addAnnotation(page.id, annotation)
          onSelect({ pageId: page.id, annotationId: annotation.id })
        })
        return
      }

      const left = Math.min(finished.x1, finished.x2)
      const top = Math.min(finished.y1, finished.y2)
      const width = Math.abs(finished.x2 - finished.x1)
      const height = Math.abs(finished.y2 - finished.y1)
      if (width * scale < MIN_HIGHLIGHT_SIZE_PX || height * scale < MIN_HIGHLIGHT_SIZE_PX) return
      const bandMode = mode

      // Tekst onder de sleep? Dan volgen markering/redigeren de tekstregels;
      // zonder tekst (scans, marges) blijft het een gewone rechthoek.
      const pad = bandMode === 'redact' ? 1.5 : 0.5
      const lineRects = bandTextRects(finished, textLines).map((r) => ({
        x: r.x - pad,
        y: r.y - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2
      }))
      const targets = lineRects.length
        ? lineRects
        : [{ x: left, y: top, width, height }]
      void (async () => {
        let lastId: string | null = null
        for (const target of targets) {
          const rect = await visualRectToContentRect(source, page.sourcePageIndex, page.rotation, {
            xPct: target.x / pageVisualSize.width,
            yPct: target.y / pageVisualSize.height,
            wPct: target.width / pageVisualSize.width,
            hPct: target.height / pageVisualSize.height
          })
          const annotation: Annotation =
            bandMode === 'redact'
              ? { id: nanoid(), type: 'redact', ...rect, fill: 'black' }
              : {
                  id: nanoid(),
                  type: 'highlight',
                  ...rect,
                  color: settings.highlightColor,
                  opacity: settings.highlightOpacity
                }
          addAnnotation(page.id, annotation)
          lastId = annotation.id
        }
        if (lastId) onSelect({ pageId: page.id, annotationId: lastId })
      })()
      return
    }
    bandRef.current = null

    if (liveStrokeRef.current) {
      const stroke = liveStrokeRef.current
      liveStrokeRef.current = null
      setLiveStroke(null)
      if (!source || stroke.length < 2) return
      void visualPointsToContentPoints(source, page.sourcePageIndex, page.rotation, stroke).then((points) => {
        addAnnotation(page.id, {
          id: nanoid(),
          type: 'ink',
          points,
          color: settings.inkColor,
          strokeWidth: settings.inkWidth
        })
      })
    }
  }

  function onStageClick(e: React.MouseEvent<HTMLDivElement>): void {
    const point = pointToVisual(e.clientX, e.clientY)
    if (!point) return
    if (mode === 'text' && !textEditor) {
      setTextEditor({ annotationId: null, visualX: point.x, visualY: point.y, value: '' })
    } else if (mode === 'comment') {
      setOpenCommentId(null)
      setNewComment({ visualX: point.x, visualY: point.y, value: '' })
    } else if (mode === 'stamp') {
      if (!source || !pageVisualSize) return
      const preset = STAMP_PRESETS.find((p) => p.key === settings.stampKey) ?? STAMP_PRESETS[0]
      const w = Math.min(220, Math.max(110, pageVisualSize.width * 0.26))
      const h = w * 0.34
      void visualRectToContentRect(source, page.sourcePageIndex, page.rotation, {
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
        addAnnotation(page.id, annotation)
        onSelect({ pageId: page.id, annotationId: annotation.id })
      })
    } else if (mode === 'view') {
      onSelect(null)
      setOpenCommentId(null)
      setNewComment(null)
    }
  }

  async function commitTextEditor(): Promise<void> {
    const editor = textEditorRef.current
    if (!editor || !source) return
    textEditorRef.current = null
    setTextEditor(null)
    const value = editor.value.replace(/\s+$/, '')

    if (editor.coverVisualRect && pageVisualSize) {
      const cover = editor.coverVisualRect
      const rect = await visualRectToContentRect(source, page.sourcePageIndex, page.rotation, {
        xPct: cover.x / pageVisualSize.width,
        yPct: cover.y / pageVisualSize.height,
        wPct: cover.width / pageVisualSize.width,
        hPct: cover.height / pageVisualSize.height
      })
      addAnnotation(page.id, { id: nanoid(), type: 'redact', ...rect, fill: 'white' })
    }

    if (editor.annotationId) {
      const existing = page.annotations.find(
        (a): a is TextAnnotation => a.id === editor.annotationId && a.type === 'text'
      )
      if (!existing) return
      if (!value.trim()) {
        removeAnnotation(page.id, existing.id)
        onSelect(null)
        return
      }
      const lines = value.split('\n').length
      const newHeight = lines * existing.size * TEXT_LINE_HEIGHT
      const { x, y } = await visualPointToContentPoint(
        source,
        page.sourcePageIndex,
        page.rotation,
        editor.visualX,
        editor.visualY + newHeight
      )
      markHistory()
      updateAnnotation(page.id, existing.id, { text: value, x, y })
      return
    }

    if (!value.trim()) return
    const style = editor.style ?? {
      font: settings.textFont,
      size: settings.textSize,
      bold: settings.textBold,
      italic: settings.textItalic,
      color: settings.textColor
    }
    const lines = value.split('\n').length
    const height = lines * style.size * TEXT_LINE_HEIGHT
    const { x, y } = await visualPointToContentPoint(
      source,
      page.sourcePageIndex,
      page.rotation,
      editor.visualX,
      editor.visualY + height
    )
    const annotation: TextAnnotation = {
      id: nanoid(),
      type: 'text',
      x,
      y,
      text: value,
      font: style.font,
      size: style.size,
      bold: style.bold,
      italic: style.italic,
      color: style.color
    }
    addAnnotation(page.id, annotation)
    onSelect({ pageId: page.id, annotationId: annotation.id })
  }

  function startEditLine(line: TextLineBox): void {
    const pad = 1.5
    onSelect(null)
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
      },
      style: {
        font: 'arial',
        size: Math.max(6, Math.round(line.fontSize)),
        bold: false,
        italic: false,
        color: '#111111'
      }
    })
  }

  function lineCovered(line: TextLineBox): boolean {
    const cx = line.visual.x + line.visual.width / 2
    const cy = line.visual.y + line.visual.height / 2
    return page.annotations.some((a) => {
      if (a.type !== 'redact') return false
      const b = annoBoxes[a.id]
      if (!b) return false
      return cx >= b.pivotX && cx <= b.pivotX + b.width && cy >= b.pivotY - b.height && cy <= b.pivotY
    })
  }

  async function commitNewComment(): Promise<void> {
    const draft = newComment
    if (!draft || !source) return
    setNewComment(null)
    const text = draft.value.trim()
    if (!text) return
    const { x, y } = await visualPointToContentPoint(
      source,
      page.sourcePageIndex,
      page.rotation,
      draft.visualX,
      draft.visualY
    )
    const comment: PageComment = { id: nanoid(), x, y, text, createdAt: Date.now(), resolved: false, replies: [] }
    addComment(page.id, comment)
    setOpenCommentId(comment.id)
  }

  function onSurfaceMouseUp(): void {
    if (mode !== 'view') return
    // Wait a tick so the browser finalizes the selection.
    window.setTimeout(() => {
      const img = imgRef.current
      if (!img) return
      const found = selectionLineRects(img.parentElement as HTMLElement)
      if (!found) {
        setSelPopup(null)
        return
      }
      const first = found.rects[0]
      setSelPopup({ x: first.x, y: Math.max(0, first.y - 40), text: found.text, rects: found.rects })
    }, 10)
  }

  async function annotateSelection(style: 'fill' | 'underline' | 'strike'): Promise<void> {
    const popup = selPopup
    if (!popup || !source || !pageVisualSize) return
    setSelPopup(null)
    window.getSelection()?.removeAllRanges()
    for (const rect of popup.rects) {
      const contentRect = await visualRectToContentRect(source, page.sourcePageIndex, page.rotation, {
        xPct: rect.x / scale / pageVisualSize.width,
        yPct: rect.y / scale / pageVisualSize.height,
        wPct: rect.width / scale / pageVisualSize.width,
        hPct: rect.height / scale / pageVisualSize.height
      })
      addAnnotation(page.id, {
        id: nanoid(),
        type: 'highlight',
        ...contentRect,
        color: settings.highlightColor,
        opacity: style === 'fill' ? settings.highlightOpacity : 0.9,
        style
      })
    }
  }

  const overlaysPassive = mode !== 'view' && mode !== 'erase'

  function inkOverlay(annotation: InkAnnotation): JSX.Element | null {
    const points = inkVisual[annotation.id]
    if (!points || points.length < 2 || !pageVisualSize) return null
    const isSelected = annotation.id === selectedAnnotationId
    const path = points.map((p) => `${p.x},${p.y}`).join(' ')
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    function eraseHit(e: React.PointerEvent): void {
      if (mode === 'erase' && (e.buttons & 1 || e.type === 'pointerdown')) {
        e.stopPropagation()
        removeAnnotation(page.id, annotation.id)
        if (isSelected) onSelect(null)
      }
    }
    return (
      <svg
        key={annotation.id}
        className="ink-overlay"
        width={pageVisualSize.width * scale}
        height={pageVisualSize.height * scale}
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
        <polyline
          points={path}
          fill="none"
          stroke={annotation.color}
          strokeWidth={annotation.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
            onSelect({ pageId: page.id, annotationId: annotation.id })
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
        removeAnnotation(page.id, annotation.id)
        if (isSelected) onSelect(null)
      }
    }
    const hitProps = {
      className: `ink-overlay__hit${overlaysPassive ? ' ink-overlay__hit--passive' : ''}${mode === 'erase' ? ' ink-overlay__hit--erase' : ''}`,
      onPointerDown: (e: React.PointerEvent) => {
        if (mode === 'erase') {
          eraseHit(e)
          return
        }
        onSelect({ pageId: page.id, annotationId: annotation.id })
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
        width={pageVisualSize.width * scale}
        height={pageVisualSize.height * scale}
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
      left: box.pivotX * scale,
      top: (box.pivotY - box.height) * scale,
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
            ? { ...common, width: box.width * scale, height: box.height * scale }
            : common
        }
        onPointerDown={(e) => {
          onSelect({ pageId: page.id, annotationId: annotation.id })
          beginDrag(e, 'annotation', 'move', annotation.id, box)
        }}
        onPointerMove={onOverlayPointerMove}
        onPointerUp={endDrag}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (annotation.type === 'text') {
            const b = annoBoxes[annotation.id]
            if (b)
              setTextEditor({
                annotationId: annotation.id,
                visualX: b.pivotX,
                visualY: b.pivotY - textAnnotationBlockHeight(annotation),
                value: annotation.text
              })
          }
        }}
      >
        {annotation.type === 'redact' ? (
          <div className={`annotation-overlay__redact annotation-overlay__redact--${annotation.fill}`} />
        ) : annotation.type === 'stamp' ? (
          <div
            className="annotation-overlay__stamp"
            style={{ ['--stamp-color' as string]: annotation.color, ['--stamp-h' as string]: `${box.height * scale}px` }}
          >
            <span className="annotation-overlay__stamp-label">{annotation.label}</span>
            {annotation.sub && <span className="annotation-overlay__stamp-sub">{annotation.sub}</span>}
          </div>
        ) : annotation.type === 'highlight' ? (
          <div
            className={`annotation-overlay__fill annotation-overlay__fill--${annotation.style ?? 'fill'}`}
            style={{
              background: (annotation.style ?? 'fill') === 'fill' ? annotation.color : 'transparent',
              opacity: annotation.opacity,
              ['--hl-color' as string]: annotation.color
            }}
          />
        ) : (
          <div
            className="annotation-overlay__text"
            style={{
              color: annotation.color,
              fontFamily: ANNOTATION_FONT_CSS[annotation.font],
              fontSize: annotation.size * scale,
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
                removeAnnotation(page.id, annotation.id)
                onSelect(null)
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

  const modeClass =
    mode === 'highlight' || mode === 'redact' || mode === 'shape'
      ? ' lightbox__page-wrap--highlighting'
      : mode === 'text' || mode === 'stamp'
        ? ' lightbox__page-wrap--texting'
        : mode === 'draw'
          ? ' lightbox__page-wrap--drawing'
          : mode === 'erase'
            ? ' lightbox__page-wrap--erasing'
            : ''

  const openComment = page.comments.find((c) => c.id === openCommentId)
  const openPin = openComment ? commentPins[openComment.id] : null

  return (
    <div className="editor-page" data-page-id={page.id} style={{ width: cssWidth }}>
      <div
        className={`editor-page__surface${modeClass}`}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onClick={onStageClick}
      >
        {image ? (
          <img ref={imgRef} src={image} alt={`Pagina ${pageNumber}`} draggable={false} />
        ) : (
          <div className="editor-page__loading" style={{ height: cssWidth * 1.35 }} />
        )}
        <div
          ref={textLayerRef}
          className={`text-select-layer${mode === 'view' ? '' : ' text-select-layer--passive'}`}
          onMouseUp={onSurfaceMouseUp}
        />
        {source && (
          <FormLayer
            source={source}
            pageIndex={page.sourcePageIndex}
            rotation={page.rotation}
            scale={scale}
            active={mode === 'form'}
          />
        )}
        {selPopup && mode === 'view' && (
          <div
            className="selection-popup"
            style={{ left: selPopup.x, top: selPopup.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="selection-popup__btn"
              title="Kopiëren"
              onClick={() => {
                void navigator.clipboard.writeText(selPopup.text)
                window.getSelection()?.removeAllRanges()
                setSelPopup(null)
              }}
            >
              <IconCopy size={14} />
            </button>
            <button type="button" className="selection-popup__btn" title="Markeren" onClick={() => void annotateSelection('fill')}>
              <IconHighlighter size={14} />
            </button>
            <button
              type="button"
              className="selection-popup__btn"
              title="Onderstrepen"
              onClick={() => void annotateSelection('underline')}
            >
              <IconUnderline size={14} />
            </button>
            <button type="button" className="selection-popup__btn" title="Doorhalen" onClick={() => void annotateSelection('strike')}>
              <IconStrike size={14} />
            </button>
          </div>
        )}
        {page.annotations.map((annotation) => annotationOverlay(annotation))}
        {page.signatures.map((placement: SignaturePlacement) => {
          const box = boxes[placement.id]
          if (!box) return null
          return (
            <div
              key={placement.id}
              className={`signature-overlay${overlaysPassive || mode === 'erase' ? ' annotation-overlay--passive' : ''}`}
              style={{
                left: box.pivotX * scale,
                top: (box.pivotY - box.height) * scale,
                width: box.width * scale,
                height: box.height * scale,
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
                  removeSignaturePlacement(page.id, placement.id)
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
              left: rect.x * scale,
              top: rect.y * scale,
              width: rect.width * scale,
              height: rect.height * scale
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
            width={pageVisualSize.width * scale}
            height={pageVisualSize.height * scale}
            viewBox={`0 0 ${pageVisualSize.width} ${pageVisualSize.height}`}
          >
            <ShapeGeometry
              shape={settings.shapeKind}
              p1={{ x: band.x1, y: band.y1 }}
              p2={{ x: band.x2, y: band.y2 }}
              color={settings.shapeColor}
              strokeWidth={settings.shapeWidth}
            />
          </svg>
        )}
        {band && mode !== 'shape' && (
          <div
            className="highlight-band"
            style={{
              left: Math.min(band.x1, band.x2) * scale,
              top: Math.min(band.y1, band.y2) * scale,
              width: Math.abs(band.x2 - band.x1) * scale,
              height: Math.abs(band.y2 - band.y1) * scale,
              background: mode === 'redact' ? '#000' : settings.highlightColor,
              opacity: mode === 'redact' ? 0.85 : settings.highlightOpacity
            }}
          />
        )}
        {liveStroke && liveStroke.length >= 2 && pageVisualSize && (
          <svg
            className="ink-overlay ink-overlay--live"
            width={pageVisualSize.width * scale}
            height={pageVisualSize.height * scale}
            viewBox={`0 0 ${pageVisualSize.width} ${pageVisualSize.height}`}
          >
            <polyline
              points={liveStroke.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={settings.inkColor}
              strokeWidth={settings.inkWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
                  left: line.visual.x * scale,
                  top: line.visual.y * scale,
                  width: line.visual.width * scale,
                  height: line.visual.height * scale
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  startEditLine(line)
                }}
              />
            ))}
        {page.comments.map((comment) => {
          const pin = commentPins[comment.id]
          if (!pin) return null
          return (
            <button
              key={comment.id}
              type="button"
              className={`comment-pin${comment.resolved ? ' comment-pin--resolved' : ''}${
                comment.id === openCommentId ? ' comment-pin--open' : ''
              }`}
              style={{ left: pin.x * scale, top: pin.y * scale }}
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
        {openComment && openPin && (
          <div
            className="comment-thread"
            style={{ left: openPin.x * scale + 14, top: openPin.y * scale + 6 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="comment-thread__head">
              <span className="comment-thread__time">
                {openComment.author && <strong className="comment-thread__author">{openComment.author} · </strong>}
                {formatCommentTime(openComment.createdAt)}
              </span>
              <label className="comment-thread__resolve" title="Markeer als afgehandeld">
                <input
                  type="checkbox"
                  checked={openComment.resolved}
                  onChange={(e) => updateComment(page.id, openComment.id, { resolved: e.target.checked })}
                />
                Afgehandeld
              </label>
              <button
                type="button"
                className="icon-btn icon-btn--chrome icon-btn--danger"
                title="Opmerking verwijderen"
                onClick={() => {
                  removeComment(page.id, openComment.id)
                  setOpenCommentId(null)
                }}
              >
                <IconTrash size={12} />
              </button>
              <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setOpenCommentId(null)}>
                <IconClose size={12} />
              </button>
            </div>
            <div className="comment-thread__text">{openComment.text}</div>
            {openComment.replies.map((reply) => (
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
                  addCommentReply(page.id, openComment.id, replyDraft.trim())
                  setReplyDraft('')
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setOpenCommentId(null)
                }
              }}
            />
          </div>
        )}
        {newComment && (
          <div
            className="comment-thread"
            style={{ left: newComment.visualX * scale + 14, top: newComment.visualY * scale + 6 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="comment-thread__head">
              <span className="comment-thread__time">Nieuwe opmerking</span>
              <button type="button" className="icon-btn icon-btn--chrome" title="Annuleren" onClick={() => setNewComment(null)}>
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
            style={{ left: textEditor.visualX * scale, top: textEditor.visualY * scale }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              autoFocus
              value={textEditor.value}
              placeholder="Typ tekst…"
              style={{
                color: textEditor.style?.color ?? settings.textColor,
                fontFamily: ANNOTATION_FONT_CSS[textEditor.style?.font ?? settings.textFont],
                fontSize: (textEditor.style?.size ?? settings.textSize) * scale,
                lineHeight: TEXT_LINE_HEIGHT,
                fontWeight: (textEditor.style?.bold ?? settings.textBold) ? 700 : 400,
                fontStyle: (textEditor.style?.italic ?? settings.textItalic) ? 'italic' : 'normal'
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
      <div className="editor-page__number">{pageNumber}</div>
    </div>
  )
}
