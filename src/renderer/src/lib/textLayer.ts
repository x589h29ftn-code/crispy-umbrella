import * as pdfjsLib from 'pdfjs-dist'
import { getPdfJsDocument } from './pdfRender'
import type { SourceFile } from '../types'

/**
 * Renders pdf.js's selectable text layer (transparent glyph spans) into the
 * given container, sized for the current display scale. Enables native text
 * selection and copying on top of the rendered page image.
 */
export async function renderTextSelectionLayer(
  container: HTMLDivElement,
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number,
  scale: number
): Promise<void> {
  const doc = await getPdfJsDocument(source)
  const page = await doc.getPage(pageIndex + 1)
  const totalRotation = (page.rotate + deltaRotation) % 360
  const viewport = page.getViewport({ scale, rotation: totalRotation })
  container.replaceChildren()
  container.style.setProperty('--scale-factor', String(viewport.scale))
  const layer = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport
  })
  await layer.render()
}

export interface SelectionLineRect {
  /** Relative to the page image, CSS pixels. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * The current browser text selection as merged per-line rectangles relative
 * to `pageEl`, or null when the selection is empty or outside that element.
 */
export function selectionLineRects(pageEl: HTMLElement): { text: string; rects: SelectionLineRect[] } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!pageEl.contains(range.commonAncestorContainer)) return null
  const pageRect = pageEl.getBoundingClientRect()
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 1 || rect.height < 1) continue
    const box = {
      x1: rect.left - pageRect.left,
      y1: rect.top - pageRect.top,
      x2: rect.right - pageRect.left,
      y2: rect.bottom - pageRect.top
    }
    const line = lines.find((l) => Math.abs((l.y1 + l.y2) / 2 - (box.y1 + box.y2) / 2) < rect.height * 0.6)
    if (line) {
      line.x1 = Math.min(line.x1, box.x1)
      line.x2 = Math.max(line.x2, box.x2)
      line.y1 = Math.min(line.y1, box.y1)
      line.y2 = Math.max(line.y2, box.y2)
    } else {
      lines.push(box)
    }
  }
  if (!lines.length) return null
  return {
    text: selection.toString(),
    rects: lines.map((l) => ({ x: l.x1, y: l.y1, width: l.x2 - l.x1, height: l.y2 - l.y1 }))
  }
}
