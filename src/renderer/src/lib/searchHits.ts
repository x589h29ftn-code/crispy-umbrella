import { getTextLineBoxes } from './textLines'
import { getOcr } from './ocrStore'
import { contentPointsToVisualPoints } from './pdfRender'
import type { SourceFile } from '../types'

export interface SearchHitRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Approximate visual rectangles (page units) for every occurrence of `query`
 * on the page: per matching text line a sub-box proportional to the character
 * positions; for OCR'd scans a box around each matching word.
 */
export async function findSearchHitRects(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  query: string
): Promise<SearchHitRect[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const rects: SearchHitRect[] = []

  const lines = await getTextLineBoxes(source, pageIndex, rotation).catch(() => [])
  for (const line of lines) {
    const hay = line.str.toLowerCase()
    let idx = hay.indexOf(needle)
    while (idx !== -1) {
      const startFrac = idx / Math.max(1, hay.length)
      const widthFrac = needle.length / Math.max(1, hay.length)
      rects.push({
        x: line.visual.x + line.visual.width * startFrac,
        y: line.visual.y,
        width: Math.max(6, line.visual.width * widthFrac),
        height: line.visual.height
      })
      idx = hay.indexOf(needle, idx + needle.length)
    }
  }

  // OCR words (scans): word-level boxes for single-word queries.
  const ocr = getOcr(source.id, pageIndex)
  if (ocr && rects.length === 0) {
    const matching = ocr.words.filter((w) => w.text.toLowerCase().includes(needle))
    if (matching.length) {
      const points = await contentPointsToVisualPoints(
        source,
        pageIndex,
        rotation,
        matching.map((w) => ({ x: w.x, y: w.y }))
      )
      matching.forEach((w, i) => {
        rects.push({
          x: points[i].x,
          y: points[i].y - w.size * 1.1,
          width: Math.max(10, w.text.length * w.size * 0.5),
          height: w.size * 1.35
        })
      })
    }
  }

  return rects
}
