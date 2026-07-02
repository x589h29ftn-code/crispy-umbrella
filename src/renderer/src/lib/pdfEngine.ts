import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib'
import type { DocGroup, PageRef, SignaturePlacement, SourceFile } from '../types'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PdfJsDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>

const jsDocCache = new Map<string, Promise<PdfJsDoc>>()
const libDocCache = new Map<string, Promise<PDFDocument>>()
const thumbCache = new Map<string, string>()

function cloneBytes(data: Uint8Array): Uint8Array {
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

export function getPdfLibDocument(source: SourceFile): Promise<PDFDocument> {
  let cached = libDocCache.get(source.id)
  if (!cached) {
    cached = PDFDocument.load(cloneBytes(source.data))
    libDocCache.set(source.id, cached)
  }
  return cached
}

export function forgetSource(sourceId: string): void {
  jsDocCache.delete(sourceId)
  libDocCache.delete(sourceId)
  for (const key of thumbCache.keys()) {
    if (key.startsWith(`${sourceId}::`)) thumbCache.delete(key)
  }
}

/** True when pdf.js refused the file because it is password-protected. */
export function isPasswordError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'PasswordException'
}

/** Encrypts PDF bytes with a user+owner password (AES), preserving all metadata. */
export async function encryptPdfBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(cloneBytes(data), { updateMetadata: false })
  doc.encrypt({ userPassword: password, ownerPassword: password })
  return doc.save()
}

/** Decrypts password-protected PDF bytes to a plain PDF. Throws on a wrong password. */
export async function decryptPdfBytes(data: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(cloneBytes(data), { password, updateMetadata: false })
  return doc.save()
}

export async function loadSourceFile(name: string, data: Uint8Array, id: string): Promise<SourceFile> {
  const doc = await pdfjsLib.getDocument({ data: cloneBytes(data) }).promise
  const source: SourceFile = { id, name, data, pageCount: doc.numPages }
  jsDocCache.set(id, Promise.resolve(doc))
  return source
}

export async function createBlankPageSource(id: string): Promise<SourceFile> {
  const doc = await PDFDocument.create()
  doc.addPage([A4_WIDTH, A4_HEIGHT])
  const data = await doc.save()
  return loadSourceFile('Lege pagina', data, id)
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
async function getPageWithTotalRotation(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number
): Promise<{ page: PdfJsPage; totalRotation: number }> {
  const doc = await getPdfJsDocument(source)
  const page = await doc.getPage(pageIndex + 1)
  return { page, totalRotation: (page.rotate + deltaRotation) % 360 }
}

async function getScale1Viewport(
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
function computeRotationCompensationDegrees(
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

/**
 * Converts a signature rectangle expressed relative to the currently
 * displayed (rotated) page image into a page-content-space rectangle that
 * stays physically anchored to the page regardless of later rotation.
 */
export async function visualRectToSignaturePlacement(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  visual: { xPct: number; yPct: number; wPct: number; hPct: number },
  imageDataUrl: string
): Promise<Omit<SignaturePlacement, 'id'>> {
  const viewport = await getScale1Viewport(source, pageIndex, rotation)
  const pivotVisualX = visual.xPct * viewport.width
  const pivotVisualY = (visual.yPct + visual.hPct) * viewport.height
  const [x, y] = viewport.convertToPdfPoint(pivotVisualX, pivotVisualY)
  return {
    imageDataUrl,
    x,
    y,
    width: visual.wPct * viewport.width,
    height: visual.hPct * viewport.height
  }
}

export interface SignatureVisualBox {
  pivotX: number
  pivotY: number
  width: number
  height: number
  rotateDeg: number
}

/** Inverse of {@link visualRectToSignaturePlacement}, recomputed live from the current rotation. */
export async function getSignatureVisualBox(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  placement: SignaturePlacement
): Promise<SignatureVisualBox> {
  const viewport = await getScale1Viewport(source, pageIndex, rotation)
  const rotateContentDeg = computeRotationCompensationDegrees(viewport)
  const rad = (rotateContentDeg * Math.PI) / 180

  const [pvx, pvy] = viewport.convertToViewportPoint(placement.x, placement.y)
  const [rvx, rvy] = viewport.convertToViewportPoint(
    placement.x + 10 * Math.cos(rad),
    placement.y + 10 * Math.sin(rad)
  )
  const rotateDeg = (Math.atan2(rvy - pvy, rvx - pvx) * 180) / Math.PI

  return { pivotX: pvx, pivotY: pvy, width: placement.width, height: placement.height, rotateDeg }
}

// Bulk imports fire a render per page at once; a bounded queue keeps the
// pdf.js worker responsive and avoids machine-dependent failures under load.
const MAX_CONCURRENT_RENDERS = 4
let activeRenders = 0
const renderWaiters: (() => void)[] = []

async function acquireRenderSlot(): Promise<void> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => renderWaiters.push(resolve))
  }
  activeRenders += 1
}

function releaseRenderSlot(): void {
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
  const dataUrl = canvas.toDataURL('image/png')
  canvas.width = 0
  canvas.height = 0
  return dataUrl
}

function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error('Ongeldige data-URL')
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return { mime: match[1], bytes }
}

async function buildPdf(group: DocGroup, sources: Map<string, SourceFile>): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const byDoc = new Map<string, number[]>()
  const order: { sourceId: string; localIndex: number; page: PageRef }[] = []

  group.pages.forEach((page) => {
    const list = byDoc.get(page.sourceId) ?? []
    list.push(page.sourcePageIndex)
    byDoc.set(page.sourceId, list)
    order.push({ sourceId: page.sourceId, localIndex: list.length - 1, page })
  })

  const copiedByDoc = new Map<string, Awaited<ReturnType<PDFDocument['copyPages']>>>()
  for (const [sourceId, indices] of byDoc) {
    const src = sources.get(sourceId)
    if (!src) continue
    const libDoc = await getPdfLibDocument(src)
    const copied = await out.copyPages(libDoc, indices)
    copiedByDoc.set(sourceId, copied)
  }

  const font = group.watermark || group.pageNumbers ? await out.embedFont(StandardFonts.Helvetica) : null
  const embeddedImages = new Map<string, PDFImage>()
  const total = order.length

  for (let i = 0; i < order.length; i += 1) {
    const { sourceId, localIndex, page } = order[i]
    const copied = copiedByDoc.get(sourceId)
    const src = sources.get(sourceId)
    if (!copied || !src) continue
    const copiedPage = copied[localIndex]
    const totalRotation = (copiedPage.getRotation().angle + page.rotation) % 360
    copiedPage.setRotation(degrees(totalRotation))

    for (const signature of page.signatures) {
      let embedded = embeddedImages.get(signature.imageDataUrl)
      if (!embedded) {
        const { mime, bytes } = dataUrlToBytes(signature.imageDataUrl)
        embedded = mime === 'image/jpeg' || mime === 'image/jpg' ? await out.embedJpg(bytes) : await out.embedPng(bytes)
        embeddedImages.set(signature.imageDataUrl, embedded)
      }
      const viewport = await getScale1Viewport(src, page.sourcePageIndex, page.rotation)
      const rotateDeg = computeRotationCompensationDegrees(viewport)
      copiedPage.drawImage(embedded, {
        x: signature.x,
        y: signature.y,
        width: signature.width,
        height: signature.height,
        rotate: degrees(rotateDeg)
      })
    }

    if (group.watermark && font) {
      drawWatermark(copiedPage, group.watermark.text, group.watermark.opacity, font)
    }
    if (group.pageNumbers && font) {
      drawPageNumber(copiedPage, i + 1, total, font)
    }

    out.addPage(copiedPage)
  }

  out.setTitle(group.name)
  if (group.documentDate) {
    // Parse the ISO date at local noon so timezone offsets can't shift it a day.
    const [year, month, day] = group.documentDate.split('-').map(Number)
    const date = new Date(year, month - 1, day, 12, 0, 0)
    if (!Number.isNaN(date.getTime())) {
      out.setCreationDate(date)
      out.setModificationDate(date)
    }
  }

  return out.save()
}

function drawWatermark(page: PDFPage, text: string, opacity: number, font: PDFFont): void {
  const { width, height } = page.getSize()
  const size = Math.min(width, height) / Math.max(8, text.length * 0.6)
  const textWidth = font.widthOfTextAtSize(text, size)
  page.drawText(text, {
    x: width / 2 - textWidth / 2,
    y: height / 2,
    size,
    font,
    color: rgb(0.5, 0.5, 0.5),
    opacity: Math.max(0, Math.min(1, opacity)),
    rotate: degrees(45)
  })
}

function drawPageNumber(page: PDFPage, pageNumber: number, total: number, font: PDFFont): void {
  const { width } = page.getSize()
  const label = `${pageNumber} / ${total}`
  const size = 9
  const textWidth = font.widthOfTextAtSize(label, size)
  page.drawText(label, {
    x: width / 2 - textWidth / 2,
    y: 18,
    size,
    font,
    color: rgb(0.35, 0.35, 0.35)
  })
}

export async function exportGroupToPdf(group: DocGroup, sources: Map<string, SourceFile>): Promise<Uint8Array> {
  return buildPdf(group, sources)
}
