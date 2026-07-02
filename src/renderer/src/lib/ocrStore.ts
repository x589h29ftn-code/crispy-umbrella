/**
 * OCR results per source page, in PDF content space (rotation-invariant, like
 * annotations). Lives outside the undo history: recognized text is derived
 * data about the source file, not an edit.
 */

export interface OcrWordContent {
  text: string
  /** Baseline-left anchor in PDF points, unrotated media-box space. */
  x: number
  y: number
  size: number
}

export interface OcrPageData {
  text: string
  words: OcrWordContent[]
}

const cache = new Map<string, OcrPageData>()

function key(sourceId: string, pageIndex: number): string {
  return `${sourceId}::${pageIndex}`
}

export function getOcr(sourceId: string, pageIndex: number): OcrPageData | null {
  return cache.get(key(sourceId, pageIndex)) ?? null
}

export function setOcr(sourceId: string, pageIndex: number, data: OcrPageData): void {
  cache.set(key(sourceId, pageIndex), data)
}

export function hasOcr(sourceId: string, pageIndex: number): boolean {
  return cache.has(key(sourceId, pageIndex))
}
