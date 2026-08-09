import { getPdfJsDocument, getPageVisualSize } from './pdfEngine'
import { getOcr } from './ocrStore'
import type { SourceFile } from '../types'

export interface TextLineBox {
  /** Concatenated text of the line. */
  str: string
  /** Approximate font size in PDF points. */
  fontSize: number
  /** Regel staat (grotendeels) in een vet lettertype. */
  bold?: boolean
  /** Axis-aligned box around the line in visual (on-screen, y-down) units. */
  visual: { x: number; y: number; width: number; height: number }
}

interface RawItem {
  str: string
  x: number
  y: number
  width: number
  height: number
  bold?: boolean
}

/**
 * pdf.js geeft per fragment een interne lettertypenaam; de échte naam
 * (bv. "ABCDE+Arial-BoldMT") staat in commonObjs. Daaruit leiden we af of de
 * tekst vet staat — nodig om koppen te herkennen bij export naar Markdown.
 */
function boldLookup(page: { commonObjs: { has: (k: string) => boolean; get: (k: string) => unknown } }): (
  fontName: string | undefined
) => boolean {
  const cache = new Map<string, boolean>()
  return (fontName) => {
    if (!fontName) return false
    const known = cache.get(fontName)
    if (known !== undefined) return known
    let bold = false
    try {
      if (page.commonObjs.has(fontName)) {
        const font = page.commonObjs.get(fontName) as { name?: string; bold?: boolean } | null
        const name = font?.name ?? ''
        bold = Boolean(font?.bold) || /bold|black|heavy|semib|demi/i.test(name)
      }
    } catch {
      // Lettertype (nog) niet geladen — dan gewoon niet vet.
    }
    cache.set(fontName, bold)
    return bold
  }
}

/**
 * The page's native text content grouped into lines, with visual boxes for
 * hit-testing. Used by the in-place text editing mode.
 */
export async function getTextLineBoxes(
  source: SourceFile,
  pageIndex: number,
  deltaRotation: number
): Promise<TextLineBox[]> {
  const doc = await getPdfJsDocument(source)
  const page = await doc.getPage(pageIndex + 1)
  const totalRotation = (page.rotate + deltaRotation) % 360
  const viewport = page.getViewport({ scale: 1, rotation: totalRotation })
  const content = await page.getTextContent()

  const isBold = boldLookup(page)
  const items: RawItem[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const [a, b, , , e, f] = item.transform
    const fontSize = Math.hypot(a, b) || item.height || 10
    items.push({
      str: item.str,
      x: e,
      y: f,
      width: item.width || fontSize * item.str.length * 0.5,
      height: fontSize,
      bold: isBold((item as { fontName?: string }).fontName)
    })
  }

  // Geen ingebouwde tekstlaag (gescande pagina)? Val terug op OCR-resultaten,
  // die in dezelfde content-ruimte staan — zo werken zoeken, tabellen,
  // vergelijken en de privacy-scan ook op scans zodra OCR is uitgevoerd.
  if (!items.length) {
    const ocr = getOcr(source.id, pageIndex)
    if (ocr) {
      for (const w of ocr.words) {
        items.push({ str: w.text, x: w.x, y: w.y, width: w.size * w.text.length * 0.5, height: w.size })
      }
    }
  }

  // Group items that share a baseline into lines.
  items.sort((p, q) => q.y - p.y || p.x - q.x)
  const lines: RawItem[][] = []
  for (const item of items) {
    const line = lines.find((l) => Math.abs(l[0].y - item.y) < Math.max(2, l[0].height * 0.35))
    if (line) line.push(item)
    else lines.push([item])
  }

  await getPageVisualSize(source, pageIndex, deltaRotation) // warm cache; keeps callers cheap

  return lines.map((line) => {
    line.sort((p, q) => p.x - q.x)
    let str = ''
    let prevEnd: number | null = null
    for (const item of line) {
      if (prevEnd !== null && item.x - prevEnd > item.height * 0.2 && !str.endsWith(' ') && !item.str.startsWith(' ')) {
        str += ' '
      }
      str += item.str
      prevEnd = item.x + item.width
    }
    const fontSize = Math.max(...line.map((i) => i.height))
    const x0 = Math.min(...line.map((i) => i.x))
    const x1 = Math.max(...line.map((i) => i.x + i.width))
    // Content-space box around the line incl. ascenders/descenders.
    const yBottom = line[0].y - fontSize * 0.25
    const yTop = line[0].y + fontSize * 1.0
    const corners = [
      viewport.convertToViewportPoint(x0, yBottom),
      viewport.convertToViewportPoint(x1, yBottom),
      viewport.convertToViewportPoint(x0, yTop),
      viewport.convertToViewportPoint(x1, yTop)
    ]
    const xs = corners.map((c) => c[0])
    const ys = corners.map((c) => c[1])
    const visual = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    }
    // Vet als het merendeel van de tekens in een vet lettertype staat.
    const boldChars = line.filter((i) => i.bold).reduce((n, i) => n + i.str.length, 0)
    const allChars = line.reduce((n, i) => n + i.str.length, 0)
    return { str: str.trim(), fontSize, bold: allChars > 0 && boldChars / allChars > 0.6, visual }
  })
}

export interface TextItem {
  str: string
  /** Content-space (PDF-punten): x = links, y = baseline, breedte in punten. */
  x: number
  y: number
  width: number
  height: number
  /** Fragment staat in een vet lettertype. */
  bold?: boolean
}

/**
 * Losse tekstfragmenten met hun positie (content-space), voor tabelherkenning
 * en het vergelijken van getallen op dezelfde plek. Ongegroepeerd, zodat
 * kolommen en losse cijfers herkenbaar blijven.
 */
export async function getTextItems(source: SourceFile, pageIndex: number): Promise<TextItem[]> {
  const doc = await getPdfJsDocument(source)
  const page = await doc.getPage(pageIndex + 1)
  const content = await page.getTextContent()
  const isBold = boldLookup(page)
  const items: TextItem[] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const [a, b, , , e, f] = item.transform
    const fontSize = Math.hypot(a, b) || item.height || 10
    items.push({
      str: item.str,
      x: e,
      y: f,
      width: item.width || fontSize * item.str.length * 0.5,
      height: fontSize,
      bold: isBold((item as { fontName?: string }).fontName)
    })
  }
  // Terugval op OCR bij een gescande pagina zonder tekstlaag.
  if (!items.length) {
    const ocr = getOcr(source.id, pageIndex)
    if (ocr) for (const w of ocr.words) items.push({ str: w.text, x: w.x, y: w.y, width: w.size * w.text.length * 0.5, height: w.size })
  }
  return items
}

/**
 * Intersections of a dragged band with the page's text lines, one rect per
 * line (visual units). Lets markeren/redigeren volg de tekst in plaats van
 * een losse rechthoek: sleep over de tekst en elke regel krijgt zijn eigen vak.
 */
export function bandTextRects(
  band: { x1: number; y1: number; x2: number; y2: number },
  lines: TextLineBox[] | null
): { x: number; y: number; width: number; height: number }[] {
  if (!lines || !lines.length) return []
  const left = Math.min(band.x1, band.x2)
  const right = Math.max(band.x1, band.x2)
  const top = Math.min(band.y1, band.y2)
  const bottom = Math.max(band.y1, band.y2)
  const rects: { x: number; y: number; width: number; height: number }[] = []
  for (const line of lines) {
    const v = line.visual
    const cy = v.y + v.height / 2
    if (cy < top || cy > bottom) continue
    const x0 = Math.max(left, v.x)
    const x1 = Math.min(right, v.x + v.width)
    if (x1 - x0 < 2) continue
    rects.push({ x: x0, y: v.y, width: x1 - x0, height: v.height })
  }
  return rects
}
