import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  BlendMode,
  LineCapStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFImage,
  PDFName,
  PDFPage,
  PDFRef,
  PDFString,
  StandardFonts,
  degrees,
  rgb
} from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import arialRegularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url'
import arialBoldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import arialItalicUrl from '../assets/fonts/LiberationSans-Italic.ttf?url'
import arialBoldItalicUrl from '../assets/fonts/LiberationSans-BoldItalic.ttf?url'
import openSansRegularUrl from '../assets/fonts/OpenSans-Regular.ttf?url'
import openSansBoldUrl from '../assets/fonts/OpenSans-Bold.ttf?url'
import openSansItalicUrl from '../assets/fonts/OpenSans-Italic.ttf?url'
import openSansBoldItalicUrl from '../assets/fonts/OpenSans-BoldItalic.ttf?url'
import { getOcr } from './ocrStore'
import { arrowHeadPoints } from './shapes'
import type {
  AnnotationFont,
  DocGroup,
  PageComment,
  PageRef,
  RedactAnnotation,
  SignaturePlacement,
  SourceFile,
  TextAnnotation
} from '../types'

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

export interface ExportPermissions {
  /** Afdrukken toestaan. */
  printing: boolean
  /** Tekst/afbeeldingen kopiëren toestaan. */
  copying: boolean
  /** Inhoud wijzigen toestaan. */
  modifying: boolean
}

/**
 * Encrypts PDF bytes (AES), preserving all metadata. With a user password the
 * document asks for it on open; permission restrictions are enforced via an
 * owner password (so the reader can open freely but e.g. not print/copy).
 */
export async function encryptPdfBytes(
  data: Uint8Array,
  password: string,
  permissions?: ExportPermissions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(cloneBytes(data), { updateMetadata: false })
  const restricted = permissions && (!permissions.printing || !permissions.copying || !permissions.modifying)
  if (restricted) {
    doc.encrypt({
      userPassword: password || undefined,
      // Zonder open-wachtwoord toch een eigenaarswachtwoord, anders zijn de
      // permissies niet afdwingbaar; willekeurig want we hoeven het niet te onthouden.
      ownerPassword: password || `pdfstudio-${crypto.randomUUID()}`,
      permissions: {
        printing: permissions!.printing ? 'highResolution' : undefined,
        copying: permissions!.copying,
        modifying: permissions!.modifying,
        annotating: permissions!.modifying,
        fillingForms: true,
        contentAccessibility: true,
        documentAssembly: permissions!.modifying
      }
    })
  } else {
    doc.encrypt({ userPassword: password, ownerPassword: password })
  }
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

/**
 * Bouwt een PDF van één pagina uit een (opgeschoonde) afbeelding, op de
 * opgegeven puntgrootte, en laadt hem als nieuwe bron. Wordt gebruikt om een
 * gescande pagina te vervangen door de opgeschoonde versie.
 */
export async function createImagePageSource(
  jpegDataUrl: string,
  pointSize: { width: number; height: number },
  name: string,
  id: string
): Promise<SourceFile> {
  const { bytes } = dataUrlToBytes(jpegDataUrl)
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(bytes)
  const page = doc.addPage([pointSize.width, pointSize.height])
  page.drawImage(img, { x: 0, y: 0, width: pointSize.width, height: pointSize.height })
  const out = await doc.save()
  return loadSourceFile(name, out, id)
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

/**
 * Font source per family: PDF standard-14 names, or TTF asset URLs for the
 * embedded families (Arial ships as Liberation Sans — metrically identical,
 * SIL-licensed — and Open Sans as itself). [regular, bold, italic, bold-italic],
 * indexed by bold + 2*italic.
 */
type FontVariants = [string, string, string, string]
const FONT_VARIANTS: Record<AnnotationFont, { kind: 'standard' | 'embedded'; variants: FontVariants }> = {
  arial: {
    kind: 'embedded',
    variants: [arialRegularUrl, arialBoldUrl, arialItalicUrl, arialBoldItalicUrl]
  },
  opensans: {
    kind: 'embedded',
    variants: [openSansRegularUrl, openSansBoldUrl, openSansItalicUrl, openSansBoldItalicUrl]
  },
  helvetica: {
    kind: 'standard',
    variants: [
      StandardFonts.Helvetica,
      StandardFonts.HelveticaBold,
      StandardFonts.HelveticaOblique,
      StandardFonts.HelveticaBoldOblique
    ]
  },
  times: {
    kind: 'standard',
    variants: [
      StandardFonts.TimesRoman,
      StandardFonts.TimesRomanBold,
      StandardFonts.TimesRomanItalic,
      StandardFonts.TimesRomanBoldItalic
    ]
  },
  courier: {
    kind: 'standard',
    variants: [
      StandardFonts.Courier,
      StandardFonts.CourierBold,
      StandardFonts.CourierOblique,
      StandardFonts.CourierBoldOblique
    ]
  }
}

function annotationFontSource(annotation: TextAnnotation): { kind: 'standard' | 'embedded'; ref: string } {
  const family = FONT_VARIANTS[annotation.font]
  return { kind: family.kind, ref: family.variants[(annotation.bold ? 1 : 0) + (annotation.italic ? 2 : 0)] }
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  let v = hex.replace('#', '')
  if (v.length === 3) v = v.split('').map((c) => c + c).join('')
  const n = Number.parseInt(v, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error('Ongeldige data-URL')
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return { mime: match[1], bytes }
}

/** True if content-space point (px, py) lies inside the redaction box (whose local frame is rotated by rotateDeg). */
function insideRedaction(px: number, py: number, redaction: RedactAnnotation, rotateDeg: number): boolean {
  const rad = (rotateDeg * Math.PI) / 180
  const dx = px - redaction.x
  const dy = py - redaction.y
  const u = dx * Math.cos(rad) + dy * Math.sin(rad)
  const v = -dx * Math.sin(rad) + dy * Math.cos(rad)
  return u >= -1 && u <= redaction.width + 1 && v >= -1 && v <= redaction.height + 1
}

const REDACT_RASTER_SCALE = 200 / 72 // ~200 DPI

/**
 * True redaction: the page is re-rendered to an image with the redaction
 * boxes burned into the pixels, and the original content (including the
 * covered text) is dropped entirely. Native text outside the boxes is
 * re-embedded as an invisible layer so the page stays searchable.
 * Returns the freshly added page plus the media-box offset that all further
 * content-space drawing on this page must subtract.
 */
async function rasterizeRedactedPage(
  out: PDFDocument,
  src: SourceFile,
  pageRef: PageRef,
  redactions: RedactAnnotation[],
  invisibleFont: PDFFont
): Promise<{ page: PDFPage; offsetX: number; offsetY: number }> {
  const doc = await getPdfJsDocument(src)
  const pdfJsPage = await doc.getPage(pageRef.sourcePageIndex + 1)
  const totalRotation = (pdfJsPage.rotate + pageRef.rotation) % 360
  const rasterViewport = pdfJsPage.getViewport({ scale: REDACT_RASTER_SCALE, rotation: 0 })
  const compViewport = pdfJsPage.getViewport({ scale: 1, rotation: totalRotation })
  const rotateDeg = computeRotationCompensationDegrees(compViewport)
  const rad = (rotateDeg * Math.PI) / 180

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rasterViewport.width))
  canvas.height = Math.max(1, Math.round(rasterViewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await pdfJsPage.render({ canvasContext: ctx, viewport: rasterViewport }).promise

  // Burn the boxes into the pixels — after this the covered content is gone.
  for (const redaction of redactions) {
    const corners: [number, number][] = [
      [redaction.x, redaction.y],
      [redaction.x + redaction.width * Math.cos(rad), redaction.y + redaction.width * Math.sin(rad)],
      [
        redaction.x + redaction.width * Math.cos(rad) - redaction.height * Math.sin(rad),
        redaction.y + redaction.width * Math.sin(rad) + redaction.height * Math.cos(rad)
      ],
      [redaction.x - redaction.height * Math.sin(rad), redaction.y + redaction.height * Math.cos(rad)]
    ]
    ctx.fillStyle = redaction.fill === 'white' ? '#ffffff' : '#000000'
    ctx.beginPath()
    corners.forEach(([cx, cy], idx) => {
      const [px, py] = rasterViewport.convertToViewportPoint(cx, cy)
      if (idx === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.closePath()
    ctx.fill()
  }

  const { bytes } = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.9))
  canvas.width = 0
  canvas.height = 0
  const image = await out.embedJpg(bytes)

  const [x0, y0, x1, y1] = pdfJsPage.view
  const width = x1 - x0
  const height = y1 - y0
  const newPage = out.addPage([width, height])
  newPage.setRotation(degrees(totalRotation))
  newPage.drawImage(image, { x: 0, y: 0, width, height })

  // Keep the page searchable: re-embed the native text invisibly, except
  // where it was redacted.
  const content = await pdfJsPage.getTextContent()
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const [a, b, , , e, f] = item.transform
    const size = Math.hypot(a, b) || 10
    const itemWidth = item.width || size * item.str.length * 0.5
    const samples: [number, number][] = [
      [e, f],
      [e + itemWidth / 2, f + size * 0.4],
      [e + itemWidth, f]
    ]
    const redacted = samples.some(([px, py]) => redactions.some((r) => insideRedaction(px, py, r, rotateDeg)))
    if (redacted) continue
    try {
      newPage.drawText(item.str, {
        x: e - x0,
        y: f - y0,
        size,
        font: invisibleFont,
        opacity: 0,
        rotate: degrees((Math.atan2(b, a) * 180) / Math.PI)
      })
    } catch {
      // Glyphs outside the standard encoding — skip.
    }
  }

  return { page: newPage, offsetX: x0, offsetY: y0 }
}

/**
 * Writes the page's comments as real PDF text annotations (sticky notes):
 * replies become /IRT-linked annotations and a checked-off comment gets a
 * Review/Completed state annotation, so Acrobat & co show the full thread.
 */
/**
 * Removes sticky-note annotations (Subtype /Text) and their popups from a
 * copied page. Imported comments live in our own model and are re-emitted by
 * addCommentAnnotations — leaving the originals in would duplicate every note.
 */
function stripCommentAnnotations(out: PDFDocument, page: PDFPage): void {
  const annotsRaw = page.node.get(PDFName.of('Annots'))
  if (!(annotsRaw instanceof PDFArray)) return
  const kept = out.context.obj([]) as PDFArray
  for (let i = 0; i < annotsRaw.size(); i += 1) {
    const entry = annotsRaw.get(i)
    const dict = entry instanceof PDFRef ? out.context.lookup(entry) : entry
    if (dict instanceof PDFDict) {
      const subtype = String(dict.get(PDFName.of('Subtype')))
      if (subtype === '/Text' || subtype === '/Popup') continue
    }
    kept.push(entry)
  }
  page.node.set(PDFName.of('Annots'), kept)
}

function addCommentAnnotations(out: PDFDocument, page: PDFPage, comments: PageComment[], ox: number, oy: number): void {
  if (!comments.length) return
  const context = out.context
  const refs: ReturnType<typeof context.register>[] = []
  for (const comment of comments) {
    const rect = [comment.x - ox, comment.y - oy, comment.x - ox + 20, comment.y - oy + 20]
    const parent = context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: rect,
      Contents: PDFHexString.fromText(comment.text),
      T: PDFHexString.fromText(comment.author ?? 'PDF Studio'),
      M: PDFString.fromDate(new Date(comment.createdAt)),
      Name: 'Comment',
      F: 4,
      Open: false
    })
    const parentRef = context.register(parent)
    refs.push(parentRef)
    for (const reply of comment.replies) {
      const replyDict = context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: rect,
        Contents: PDFHexString.fromText(reply.text),
        T: PDFHexString.fromText(reply.author ?? 'PDF Studio'),
        M: PDFString.fromDate(new Date(reply.createdAt)),
        Name: 'Comment',
        F: 4,
        IRT: parentRef,
        Open: false
      })
      refs.push(context.register(replyDict))
    }
    if (comment.resolved) {
      const stateDict = context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: rect,
        Contents: PDFHexString.fromText('Afgehandeld'),
        T: PDFHexString.fromText('PDF Studio'),
        M: PDFString.fromDate(new Date()),
        F: 4,
        IRT: parentRef,
        State: PDFString.of('Completed'),
        StateModel: PDFString.of('Review')
      })
      refs.push(context.register(stateDict))
    }
  }
  const existing = page.node.get(PDFName.of('Annots'))
  if (existing instanceof PDFArray) {
    for (const ref of refs) existing.push(ref)
  } else {
    page.node.set(PDFName.of('Annots'), context.obj(refs))
  }
}

export interface ExportOptions {
  /** Ingevulde formulierwaarden per bron (sourceId → veldnaam → waarde). */
  formValues?: Record<string, Record<string, string | boolean>>
  /** Velden platslaan: waarden worden vaste pagina-inhoud. */
  flattenForms?: boolean
}

async function buildPdf(group: DocGroup, sources: Map<string, SourceFile>, options: ExportOptions = {}): Promise<Uint8Array> {
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
    let libDoc = await getPdfLibDocument(src)
    const values = options.formValues?.[sourceId]
    if (values && Object.keys(values).length) {
      // Fill a fresh copy (never the shared cached document) so the values —
      // and optionally the flattening — travel with the copied pages.
      libDoc = await PDFDocument.load(src.data.slice(), { ignoreEncryption: true })
      const { applyFormValues } = await import('./forms')
      applyFormValues(libDoc, values)
      if (options.flattenForms) {
        try {
          libDoc.getForm().flatten()
        } catch {
          // Flattening can fail on exotic appearance streams; keep the filled form.
        }
      }
    }
    const copied = await out.copyPages(libDoc, indices)
    copiedByDoc.set(sourceId, copied)
  }

  const fontCache = new Map<string, Promise<PDFFont>>()
  let fontkitRegistered = false
  function getFont(source: { kind: 'standard' | 'embedded'; ref: string }): Promise<PDFFont> {
    let cached = fontCache.get(source.ref)
    if (!cached) {
      if (source.kind === 'standard') {
        cached = out.embedFont(source.ref as StandardFonts)
      } else {
        if (!fontkitRegistered) {
          out.registerFontkit(fontkit)
          fontkitRegistered = true
        }
        cached = fetch(source.ref)
          .then((res) => res.arrayBuffer())
          .then((bytes) => out.embedFont(bytes, { subset: true }))
      }
      fontCache.set(source.ref, cached)
    }
    return cached
  }
  const font =
    group.watermark || group.pageNumbers
      ? await getFont({ kind: 'standard', ref: StandardFonts.Helvetica })
      : null
  const embeddedImages = new Map<string, PDFImage>()
  const total = order.length
  // Export page index per order entry (skipped entries leave gaps).
  const placedAt = new Map<number, number>()

  for (let i = 0; i < order.length; i += 1) {
    const { sourceId, localIndex, page } = order[i]
    const copied = copiedByDoc.get(sourceId)
    const src = sources.get(sourceId)
    if (!copied || !src) continue
    const copiedPage = copied[localIndex]
    const totalRotation = (copiedPage.getRotation().angle + page.rotation) % 360
    copiedPage.setRotation(degrees(totalRotation))
    // Sticky notes from the source were imported into our comment model and are
    // re-emitted below; drop the copied originals so they don't show up twice.
    stripCommentAnnotations(out, copiedPage)

    // Pages with redactions are rebuilt from a rendered image (with the boxes
    // burned in), so the covered content is truly removed from the file. All
    // remaining content-space drawing then shifts by the media-box origin.
    const redactions = page.annotations.filter((a): a is RedactAnnotation => a.type === 'redact')
    let targetPage = copiedPage
    let ox = 0
    let oy = 0
    if (redactions.length) {
      const invisibleFont = await getFont({ kind: 'standard', ref: StandardFonts.Helvetica })
      const flattened = await rasterizeRedactedPage(out, src, page, redactions, invisibleFont)
      targetPage = flattened.page
      ox = flattened.offsetX
      oy = flattened.offsetY
    }

    for (const signature of page.signatures) {
      let embedded = embeddedImages.get(signature.imageDataUrl)
      if (!embedded) {
        const { mime, bytes } = dataUrlToBytes(signature.imageDataUrl)
        embedded = mime === 'image/jpeg' || mime === 'image/jpg' ? await out.embedJpg(bytes) : await out.embedPng(bytes)
        embeddedImages.set(signature.imageDataUrl, embedded)
      }
      const viewport = await getScale1Viewport(src, page.sourcePageIndex, page.rotation)
      const rotateDeg = computeRotationCompensationDegrees(viewport)
      targetPage.drawImage(embedded, {
        x: signature.x - ox,
        y: signature.y - oy,
        width: signature.width,
        height: signature.height,
        rotate: degrees(rotateDeg)
      })
    }

    for (const annotation of page.annotations) {
      if (annotation.type === 'redact') continue // burned into the raster above
      const viewport = await getScale1Viewport(src, page.sourcePageIndex, page.rotation)
      const rotateDeg = computeRotationCompensationDegrees(viewport)
      if (annotation.type === 'highlight') {
        const style = annotation.style ?? 'fill'
        if (style === 'fill') {
          // Multiply blend keeps the underlying text readable, like a real highlighter.
          targetPage.drawRectangle({
            x: annotation.x - ox,
            y: annotation.y - oy,
            width: annotation.width,
            height: annotation.height,
            color: hexToRgb(annotation.color),
            opacity: Math.max(0, Math.min(1, annotation.opacity)),
            rotate: degrees(rotateDeg),
            blendMode: BlendMode.Multiply
          })
        } else {
          // Underline sits at the bottom of the box, strike through the middle:
          // a thin bar shifted along the box's local "up" axis.
          const bar = Math.max(0.8, annotation.height * 0.08)
          const offset = style === 'underline' ? 0 : annotation.height / 2 - bar / 2
          const theta = (rotateDeg * Math.PI) / 180
          targetPage.drawRectangle({
            x: annotation.x - ox - Math.sin(theta) * offset,
            y: annotation.y - oy + Math.cos(theta) * offset,
            width: annotation.width,
            height: bar,
            color: hexToRgb(annotation.color),
            opacity: Math.max(0, Math.min(1, annotation.opacity)),
            rotate: degrees(rotateDeg)
          })
        }
      } else if (annotation.type === 'ink') {
        if (annotation.points.length >= 2) {
          // Points are stored in content space, so the stroke is anchored to the
          // page physically — no rotation compensation needed. drawSvgPath maps
          // SVG y-down onto page y-up, hence the negated y coordinates.
          const d = annotation.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - ox},${-(p.y - oy)}`)
            .join(' ')
          targetPage.drawSvgPath(d, {
            x: 0,
            y: 0,
            borderColor: hexToRgb(annotation.color),
            borderWidth: annotation.strokeWidth,
            borderLineCap: LineCapStyle.Round
          })
        }
      } else if (annotation.type === 'shape') {
        if (annotation.points.length >= 2) {
          // Endpoints live in content space (like ink), so shapes stay glued to
          // the page content whatever the page rotation is.
          const color = hexToRgb(annotation.color)
          const thickness = annotation.strokeWidth
          const a = { x: annotation.points[0].x - ox, y: annotation.points[0].y - oy }
          const b = { x: annotation.points[1].x - ox, y: annotation.points[1].y - oy }
          if (annotation.shape === 'rect') {
            targetPage.drawRectangle({
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              width: Math.abs(b.x - a.x),
              height: Math.abs(b.y - a.y),
              borderColor: color,
              borderWidth: thickness
            })
          } else if (annotation.shape === 'ellipse') {
            targetPage.drawEllipse({
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
              xScale: Math.abs(b.x - a.x) / 2,
              yScale: Math.abs(b.y - a.y) / 2,
              borderColor: color,
              borderWidth: thickness
            })
          } else {
            targetPage.drawLine({ start: a, end: b, color, thickness, lineCap: LineCapStyle.Round })
            if (annotation.shape === 'arrow') {
              for (const tip of arrowHeadPoints(a, b, thickness)) {
                targetPage.drawLine({ start: b, end: tip, color, thickness, lineCap: LineCapStyle.Round })
              }
            }
          }
        }
      } else if (annotation.type === 'stamp') {
        // Border + centered label + sub line, in the box's local (possibly
        // rotation-compensated) frame anchored at the bottom-left pivot.
        const color = hexToRgb(annotation.color)
        const stampFont = await getFont({ kind: 'embedded', ref: FONT_VARIANTS.arial.variants[1] })
        const theta = (rotateDeg * Math.PI) / 180
        const local = (dx: number, dy: number): { x: number; y: number } => ({
          x: annotation.x - ox + Math.cos(theta) * dx - Math.sin(theta) * dy,
          y: annotation.y - oy + Math.sin(theta) * dx + Math.cos(theta) * dy
        })
        targetPage.drawRectangle({
          x: annotation.x - ox,
          y: annotation.y - oy,
          width: annotation.width,
          height: annotation.height,
          borderColor: color,
          borderWidth: Math.max(1.2, annotation.height * 0.045),
          rotate: degrees(rotateDeg)
        })
        const padX = annotation.width * 0.07
        const hasSub = Boolean(annotation.sub.trim())
        let labelSize = annotation.height * (hasSub ? 0.4 : 0.5)
        labelSize = Math.min(labelSize, (annotation.width - padX * 2) / Math.max(0.01, stampFont.widthOfTextAtSize(annotation.label, 1)))
        const labelWidth = stampFont.widthOfTextAtSize(annotation.label, labelSize)
        const labelBase = hasSub ? annotation.height * 0.42 : (annotation.height - labelSize * 0.7) / 2
        const labelPos = local((annotation.width - labelWidth) / 2, labelBase)
        targetPage.drawText(annotation.label, {
          x: labelPos.x,
          y: labelPos.y,
          size: labelSize,
          font: stampFont,
          color,
          rotate: degrees(rotateDeg)
        })
        if (hasSub) {
          let subSize = annotation.height * 0.19
          subSize = Math.min(subSize, (annotation.width - padX * 2) / Math.max(0.01, stampFont.widthOfTextAtSize(annotation.sub, 1)))
          const subWidth = stampFont.widthOfTextAtSize(annotation.sub, subSize)
          const subPos = local((annotation.width - subWidth) / 2, annotation.height * 0.14)
          targetPage.drawText(annotation.sub, {
            x: subPos.x,
            y: subPos.y,
            size: subSize,
            font: stampFont,
            color,
            rotate: degrees(rotateDeg)
          })
        }
      } else {
        const textFont = await getFont(annotationFontSource(annotation))
        const lines = textAnnotationLines(annotation)
        const lineHeight = annotation.size * TEXT_LINE_HEIGHT
        // (annotation.x, annotation.y) is the block's bottom-left pivot in content
        // space; each line's baseline sits along the block's local "up" axis.
        const theta = (rotateDeg * Math.PI) / 180
        const upX = -Math.sin(theta)
        const upY = Math.cos(theta)
        for (let line = 0; line < lines.length; line += 1) {
          if (!lines[line]) continue
          const offset = (lines.length - 1 - line) * lineHeight + annotation.size * TEXT_BASELINE_FACTOR
          targetPage.drawText(lines[line], {
            x: annotation.x - ox + upX * offset,
            y: annotation.y - oy + upY * offset,
            size: annotation.size,
            font: textFont,
            color: hexToRgb(annotation.color),
            rotate: degrees(rotateDeg)
          })
        }
      }
    }

    // Recognized (OCR) text is written as an invisible layer at the word
    // positions, so exported scans become selectable and searchable.
    const ocr = getOcr(page.sourceId, page.sourcePageIndex)
    if (ocr && ocr.words.length) {
      const invisibleFont = await getFont({ kind: 'standard', ref: StandardFonts.Helvetica })
      const viewport = await getScale1Viewport(src, page.sourcePageIndex, page.rotation)
      const rotateDeg = computeRotationCompensationDegrees(viewport)
      for (const word of ocr.words) {
        if (redactions.some((r) => insideRedaction(word.x, word.y, r, rotateDeg))) continue
        try {
          targetPage.drawText(word.text, {
            x: word.x - ox,
            y: word.y - oy,
            size: word.size,
            font: invisibleFont,
            opacity: 0,
            rotate: degrees(rotateDeg)
          })
        } catch {
          // Word contains glyphs outside the standard encoding — skip it.
        }
      }
    }

    if (group.watermark && font) {
      drawWatermark(targetPage, group.watermark.text, group.watermark.opacity, font)
    }
    if (group.pageNumbers && font) {
      drawPageNumber(targetPage, i + 1, total, font)
    }

    addCommentAnnotations(out, targetPage, page.comments, ox, oy)

    if (!redactions.length) out.addPage(copiedPage)
    placedAt.set(i, out.getPageCount() - 1)
  }

  if (!options.flattenForms) rebuildAcroForm(out)

  await writeExportOutline(out, sources, order, placedAt)

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

interface ExportOutlineNode {
  title: string
  exportPageIndex: number
  children: ExportOutlineNode[]
}

/**
 * Writes the export's bookmark tree (inhoudsopgave): the source documents'
 * own bookmarks remapped to the exported pages, and — when the document mixes
 * multiple sources — a top-level bookmark per source file.
 */
async function writeExportOutline(
  out: PDFDocument,
  sources: Map<string, SourceFile>,
  order: { sourceId: string; localIndex: number; page: PageRef }[],
  placedAt: Map<number, number>
): Promise<void> {
  const { getSourceOutline } = await import('./bookmarks')

  const exportIndexFor = new Map<string, number>()
  order.forEach((entry, i) => {
    const key = `${entry.sourceId}:${entry.page.sourcePageIndex}`
    const placed = placedAt.get(i)
    if (placed !== undefined && !exportIndexFor.has(key)) exportIndexFor.set(key, placed)
  })
  const seenSources: string[] = []
  order.forEach((e) => {
    if (!seenSources.includes(e.sourceId)) seenSources.push(e.sourceId)
  })
  const multi = seenSources.length > 1

  const roots: ExportOutlineNode[] = []
  for (const sourceId of seenSources) {
    const src = sources.get(sourceId)
    if (!src) continue
    const outline = await getSourceOutline(src)
    const remap = (nodes: { title: string; pageIndex: number; children: unknown[] }[]): ExportOutlineNode[] =>
      nodes.flatMap((node) => {
        const idx = node.pageIndex >= 0 ? exportIndexFor.get(`${sourceId}:${node.pageIndex}`) : undefined
        const children = remap(node.children as typeof nodes)
        // A bookmark whose page isn't in this document: promote its children.
        if (idx === undefined) return children
        return [{ title: node.title, exportPageIndex: idx, children }]
      })
    const children = remap(outline)
    if (multi) {
      let firstIdx: number | undefined
      for (let i = 0; i < order.length; i += 1) {
        if (order[i].sourceId === sourceId && placedAt.has(i)) {
          firstIdx = placedAt.get(i)
          break
        }
      }
      if (firstIdx !== undefined) {
        roots.push({ title: src.name.replace(/\.pdf$/i, ''), exportPageIndex: firstIdx, children })
      }
    } else {
      roots.push(...children)
    }
  }
  if (!roots.length) return

  const context = out.context
  const pages = out.getPages()
  const countAll = (nodes: ExportOutlineNode[]): number =>
    nodes.reduce((n, node) => n + 1 + countAll(node.children), 0)

  const outlinesRef = context.nextRef()
  function emit(nodes: ExportOutlineNode[], parentRef: PDFRef): { first: PDFRef; last: PDFRef } {
    const refs = nodes.map(() => context.nextRef())
    nodes.forEach((node, i) => {
      const page = pages[Math.min(node.exportPageIndex, pages.length - 1)]
      const dict = context.obj({
        Title: PDFHexString.fromText(node.title),
        Parent: parentRef,
        Dest: [page.ref, 'XYZ', null, null, null]
      }) as PDFDict
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
      if (i < refs.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
      if (node.children.length) {
        const sub = emit(node.children, refs[i])
        dict.set(PDFName.of('First'), sub.first)
        dict.set(PDFName.of('Last'), sub.last)
        dict.set(PDFName.of('Count'), context.obj(countAll(node.children)))
      }
      context.assign(refs[i], dict)
    })
    return { first: refs[0], last: refs[refs.length - 1] }
  }
  const top = emit(roots, outlinesRef)
  const outlines = context.obj({ Type: 'Outlines', Count: countAll(roots) }) as PDFDict
  outlines.set(PDFName.of('First'), top.first)
  outlines.set(PDFName.of('Last'), top.last)
  context.assign(outlinesRef, outlines)
  out.catalog.set(PDFName.of('Outlines'), outlinesRef)
}

/**
 * copyPages drops the document-level /AcroForm, which would leave copied form
 * widgets orphaned. Re-register every copied field (walking widget → root
 * parent) in a fresh AcroForm so the merged PDF keeps a working form.
 */
function rebuildAcroForm(out: PDFDocument): void {
  const fieldRefs = new Set<PDFRef>()
  for (const page of out.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = 0; i < annots.size(); i += 1) {
      const entry = annots.get(i)
      if (!(entry instanceof PDFRef)) continue
      const dict = out.context.lookup(entry)
      if (!(dict instanceof PDFDict)) continue
      if (String(dict.get(PDFName.of('Subtype'))) !== '/Widget') continue
      let fieldRef = entry
      let fieldDict = dict
      for (;;) {
        const parent = fieldDict.get(PDFName.of('Parent'))
        const parentDict = parent instanceof PDFRef ? out.context.lookup(parent) : null
        if (parent instanceof PDFRef && parentDict instanceof PDFDict) {
          fieldRef = parent
          fieldDict = parentDict
        } else {
          break
        }
      }
      fieldRefs.add(fieldRef)
    }
  }
  if (!fieldRefs.size) return
  const acroForm = out.context.obj({ Fields: [...fieldRefs], NeedAppearances: true })
  out.catalog.set(PDFName.of('AcroForm'), out.context.register(acroForm))
}

export async function exportGroupToPdf(
  group: DocGroup,
  sources: Map<string, SourceFile>,
  options: ExportOptions = {}
): Promise<Uint8Array> {
  return buildPdf(group, sources, options)
}
