/**
 * pdf.js-only rendering & coordinate helpers, split out of pdfEngine so the
 * startup path (thumbnails, page geometry, source loading) doesn't have to
 * evaluate the heavy @cantoo/pdf-lib bundle. Everything here depends solely on
 * pdf.js; the pdf-lib-based assembly/export code lives in pdfEngine.ts and
 * imports the shared pieces from here.
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocument } from '@cantoo/pdf-lib'
import type { SignaturePlacement, SourceFile, TextAnnotation } from '../types'

export const A4_WIDTH = 595.28
export const A4_HEIGHT = 841.89

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type PdfJsDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>

// Gedeelde caches: pdf.js-documenten, pdf-lib-documenten (alleen als type
// aangeraakt, dus geen runtime-afhankelijkheid) en gerenderde thumbnails.
export const jsDocCache = new Map<string, Promise<PdfJsDoc>>()
export const libDocCache = new Map<string, Promise<PDFDocument>>()
export const thumbCache = new Map<string, string>()

export function cloneBytes(data: Uint8Array): Uint8Array {
  // pdf.js detaches/transfers the buffer it's given, so every consumer needs its own copy.
  return data.slice()
}

export function getPdfJsDocument(source: SourceFile): Promise<PdfJsDoc> {
  let cached = jsDocCache.get(source.id)
  if (!cached) {
    cached = pdfjsLib.getDocument({ data: cloneBytes(source.data) }).promise
    jsDocCache.set(source.id, cached)
  }
  return cached
}

export interface PdfMetadata {
  title: string | null
  author: string | null
  created: string | null
  modified: string | null
}

/** Leest de belangrijkste PDF-metadata (titel, auteur, aanmaak-/wijzigingsdatum). */
export async function getPdfMetadata(source: SourceFile): Promise<PdfMetadata> {
  const doc = await getPdfJsDocument(source)
  try {
    const { info } = (await doc.getMetadata()) as unknown as { info?: Record<string, unknown> }
    const parseDate = (raw: unknown): string | null => {
      if (typeof raw !== 'string') return null
      // PDF-datum: D:YYYYMMDDHHmmSS…  → nl-NL notatie.
      const m = raw.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/)
      if (!m) return null
      const [, y, mo, d, h, mi] = m
      const time = h ? ` ${h}:${mi ?? '00'}` : ''
      return `${d}-${mo}-${y}${time}`
    }
    return {
      title: (info?.Title as string) || null,
      author: (info?.Author as string) || null,
      created: parseDate(info?.CreationDate),
      modified: parseDate(info?.ModDate)
    }
  } catch {
    return { title: null, author: null, created: null, modified: null }
  }
}

export function forgetSource(sourceId: string): void {
  jsDocCache.delete(sourceId)
  libDocCache.delete(sourceId)
  for (const key of thumbCache.keys()) {
    if (key.startsWith(`${sourceId}::`)) {
      const url = thumbCache.get(key)
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
      thumbCache.delete(key)
    }
  }
}

/** True when pdf.js refused the file because it is password-protected. */
export function isPasswordError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'PasswordException'
}

export async function loadSourceFile(name: string, data: Uint8Array, id: string, path?: string): Promise<SourceFile> {
  const doc = await pdfjsLib.getDocument({ data: cloneBytes(data) }).promise
  const source: SourceFile = { id, name, data, pageCount: doc.numPages, path }
  jsDocCache.set(id, Promise.resolve(doc))
  return source
}

type PdfJsPage = Awaited<ReturnType<PdfJsDoc['getPage']>>

/**
 * pdf.js's `getViewport({ rotation })` treats `rotation` as the *absolute*
 * display rotation, defaulting to the page's own inherent `/Rotate` when
 * omitted — it does not add to it. Our `PageRef.rotation` only tracks the
 * extra rotation the user applied on top of that, so every viewport lookup
 * must combine the two explicitly to render correctly for source PDFs that
 * already carry their own rotation (e.g. scanned documents).
 */
export async function getPageWithTotalRotation(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number
): Promise<{ page: PdfJsPage; totalRotation: number }> {
  const doc = await getPdfJsDocument(source)
  const page = await doc.getPage(pageIndex + 1)
  return { page, totalRotation: (page.rotate + deltaRotation) % 360 }
}

export async function getScale1Viewport(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number
): Promise<ReturnType<PdfJsPage['getViewport']>> {
  const { page, totalRotation } = await getPageWithTotalRotation(source, pageIndex, deltaRotation)
  return page.getViewport({ scale: 1, rotation: totalRotation })
}

/**
 * Degrees (pdf-lib's counter-clockwise convention) that content drawn in a
 * page's native (unrotated) coordinate space must be pre-rotated by so that
 * it appears upright once a viewer applies the page's display rotation.
 * Derived from pdf.js's own viewport transform rather than a hand-derived
 * rotation matrix, so it can't disagree with how pdf.js renders the page.
 */
export function computeRotationCompensationDegrees(
  viewport: { convertToPdfPoint(x: number, y: number): number[] }
): number {
  const [ox, oy] = viewport.convertToPdfPoint(0, 0)
  const [rx, ry] = viewport.convertToPdfPoint(10, 0)
  return (Math.atan2(ry - oy, rx - ox) * 180) / Math.PI
}

/** The page's on-screen size (in points, i.e. CSS pixels at 100% zoom) for the given rotation. */
export async function getPageVisualSize(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number
): Promise<{ width: number; height: number }> {
  const viewport = await getScale1Viewport(source, pageIndex, deltaRotation)
  return { width: viewport.width, height: viewport.height }
}

/** Used while dragging an existing placement: keeps its size, moves its anchor point. */
export async function visualPointToContentPoint(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number,
  visualX: number,
  visualY: number
): Promise<{ x: number; y: number }> {
  const viewport = await getScale1Viewport(source, pageIndex, deltaRotation)
  const [x, y] = viewport.convertToPdfPoint(visualX, visualY)
  return { x, y }
}

/** Bulk variant of {@link visualPointToContentPoint} for freehand strokes. */
export async function visualPointsToContentPoints(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number,
  points: { x: number; y: number }[]
): Promise<{ x: number; y: number }[]> {
  const viewport = await getScale1Viewport(source, pageIndex, deltaRotation)
  return points.map((p) => {
    const [x, y] = viewport.convertToPdfPoint(p.x, p.y)
    return { x, y }
  })
}

/** Inverse of {@link visualPointsToContentPoints}: content-space points to on-screen (visual) points. */
export async function contentPointsToVisualPoints(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number,
  points: { x: number; y: number }[]
): Promise<{ x: number; y: number }[]> {
  const viewport = await getScale1Viewport(source, pageIndex, deltaRotation)
  return points.map((p) => {
    const [x, y] = viewport.convertToViewportPoint(p.x, p.y)
    return { x, y }
  })
}

/**
 * Converts a rectangle expressed relative to the currently displayed
 * (rotated) page image into a page-content-space rectangle (bottom-left
 * pivot) that stays physically anchored to the page regardless of later
 * rotation. Shared by signatures, highlights and text annotations.
 */
export async function visualRectToContentRect(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  visual: { xPct: number; yPct: number; wPct: number; hPct: number }
): Promise<{ x: number; y: number; width: number; height: number }> {
  const viewport = await getScale1Viewport(source, pageIndex, rotation)
  const pivotVisualX = visual.xPct * viewport.width
  const pivotVisualY = (visual.yPct + visual.hPct) * viewport.height
  const [x, y] = viewport.convertToPdfPoint(pivotVisualX, pivotVisualY)
  return {
    x,
    y,
    width: visual.wPct * viewport.width,
    height: visual.hPct * viewport.height
  }
}

export interface RenderedPagePreview {
  dataUrl: string
  /** Afmetingen in PDF-punten (scale 1). */
  pdfWidth: number
  pdfHeight: number
  /** Afmetingen van de gerenderde afbeelding in pixels. */
  pxWidth: number
  pxHeight: number
  pageCount: number
}

/**
 * Rendert één pagina van ruwe PDF-bytes naar een PNG-data-URL op een doelbreedte.
 * Losstaand van het store-bronmodel — gebruikt door het ondertekendashboard om
 * een voorbeeld te tonen waarop de gebruiker tekenvakken plaatst. Geeft zowel de
 * PDF-punt- als pixelafmetingen terug zodat een rechthoek exact naar
 * PDF-coördinaten (pivot linksonder) is om te rekenen.
 */
export async function renderPdfBytesPage(
  bytes: Uint8Array,
  pageIndex: number,
  targetWidthPx: number
): Promise<RenderedPagePreview> {
  const doc = await pdfjsLib.getDocument({ data: cloneBytes(bytes) }).promise
  try {
    const clampedIndex = Math.min(Math.max(0, pageIndex), doc.numPages - 1)
    const page = await doc.getPage(clampedIndex + 1)
    const base = page.getViewport({ scale: 1 })
    const scale = targetWidthPx / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Geen 2D-context')
    await page.render({ canvasContext: ctx, viewport }).promise
    return {
      dataUrl: canvas.toDataURL('image/png'),
      pdfWidth: base.width,
      pdfHeight: base.height,
      pxWidth: canvas.width,
      pxHeight: canvas.height,
      pageCount: doc.numPages
    }
  } finally {
    void doc.destroy()
  }
}

export async function visualRectToSignaturePlacement(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  visual: { xPct: number; yPct: number; wPct: number; hPct: number },
  imageDataUrl: string
): Promise<Omit<SignaturePlacement, 'id'>> {
  const rect = await visualRectToContentRect(source, pageIndex, rotation, visual)
  return { imageDataUrl, ...rect }
}

export interface SignatureVisualBox {
  pivotX: number
  pivotY: number
  width: number
  height: number
  rotateDeg: number
}

/** Inverse of {@link visualRectToContentRect}, recomputed live from the current rotation. */
export async function getPlacementVisualBox(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  rect: { x: number; y: number; width: number; height: number }
): Promise<SignatureVisualBox> {
  const viewport = await getScale1Viewport(source, pageIndex, rotation)
  const rotateContentDeg = computeRotationCompensationDegrees(viewport)
  const rad = (rotateContentDeg * Math.PI) / 180

  const [pvx, pvy] = viewport.convertToViewportPoint(rect.x, rect.y)
  const [rvx, rvy] = viewport.convertToViewportPoint(rect.x + 10 * Math.cos(rad), rect.y + 10 * Math.sin(rad))
  const rotateDeg = (Math.atan2(rvy - pvy, rvx - pvx) * 180) / Math.PI

  return { pivotX: pvx, pivotY: pvy, width: rect.width, height: rect.height, rotateDeg }
}

export async function getSignatureVisualBox(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  placement: SignaturePlacement
): Promise<SignatureVisualBox> {
  return getPlacementVisualBox(source, pageIndex, rotation, placement)
}

// Bulk imports fire a render per page at once; a bounded queue keeps the
// pdf.js worker responsive and avoids machine-dependent failures under load.
const MAX_CONCURRENT_RENDERS = 4
let activeRenders = 0
const renderWaiters: (() => void)[] = []

export async function acquireRenderSlot(): Promise<void> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => renderWaiters.push(resolve))
  }
  activeRenders += 1
}

export function releaseRenderSlot(): void {
  activeRenders -= 1
  renderWaiters.shift()?.()
}

export async function renderThumbnail(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number,
  targetWidth: number
): Promise<string> {
  const cacheKey = `${source.id}::${pageIndex}::${deltaRotation}::${targetWidth}`
  const cached = thumbCache.get(cacheKey)
  if (cached) return cached

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt))
    await acquireRenderSlot()
    try {
      const dataUrl = await renderThumbnailOnce(source, pageIndex, deltaRotation, targetWidth)
      thumbCache.set(cacheKey, dataUrl)
      return dataUrl
    } catch (error) {
      lastError = error
    } finally {
      releaseRenderSlot()
    }
  }
  throw lastError
}

async function renderThumbnailOnce(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number,
  targetWidth: number
): Promise<string> {
  const { page, totalRotation } = await getPageWithTotalRotation(source, pageIndex, deltaRotation)
  const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation })
  const scale = targetWidth / baseViewport.width
  const viewport = page.getViewport({ scale, rotation: totalRotation })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  await page.render({ canvasContext: ctx, viewport }).promise
  // Blob-URL i.p.v. base64 data-URL: geen (blokkerende) base64-encode op de
  // hoofdthread, kleiner in geheugen en sneller te decoderen bij het scrollen.
  const url = await new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob))
      else reject(new Error('Canvas toBlob mislukt'))
    }, 'image/png')
  })
  canvas.width = 0
  canvas.height = 0
  return url
}

/**
 * Renders a page to an offscreen canvas at the given width and returns it, for
 * pixel-level work (lege-pagina-detectie en scans opschonen). The caller owns
 * the canvas and should drop the reference when done.
 */
export async function renderPageToCanvas(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number,
  targetWidth: number
): Promise<HTMLCanvasElement> {
  await acquireRenderSlot()
  try {
    const { page, totalRotation } = await getPageWithTotalRotation(source, pageIndex, deltaRotation)
    const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation })
    const scale = targetWidth / baseViewport.width
    const viewport = page.getViewport({ scale, rotation: totalRotation })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas
  } finally {
    releaseRenderSlot()
  }
}

/** Media-box grootte (punten) van een bronpagina, inclusief de extra rotatie. */
export async function getPagePointSize(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number
): Promise<{ width: number; height: number }> {
  const { page, totalRotation } = await getPageWithTotalRotation(source, pageIndex, deltaRotation)
  const vp = page.getViewport({ scale: 1, rotation: totalRotation })
  return { width: vp.width, height: vp.height }
}

/** Shared text-annotation metrics so the on-screen overlay and the exported PDF line up. */
export const TEXT_LINE_HEIGHT = 1.2
/** Baseline offset above the bottom of each line box, as a fraction of the font size. */
export const TEXT_BASELINE_FACTOR = 0.25

export function textAnnotationLines(annotation: TextAnnotation): string[] {
  return annotation.text.split('\n')
}

export function textAnnotationBlockHeight(annotation: TextAnnotation): number {
  return textAnnotationLines(annotation).length * annotation.size * TEXT_LINE_HEIGHT
}
