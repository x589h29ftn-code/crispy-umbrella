import { createImagePageSource, getPagePointSize, renderPageToCanvas } from './pdfEngine'
import type { PageRef, SourceFile } from '../types'

/** Heeft deze pagina een bruikbare tekstlaag? Dan is rasteren zonde. */
export async function hasTextLayer(source: SourceFile, page: PageRef): Promise<boolean> {
  const { getTextItems } = await import('./textLines')
  const items = await getTextItems(source, page.sourcePageIndex).catch(() => [])
  return items.reduce((n, i) => n + i.str.trim().length, 0) > 80
}

/**
 * True als een pagina vrijwel volledig wit is (nauwelijks inkt). Op 520 px
 * breed in plaats van 220: bij die lagere resolutie viel een pagina met één
 * regel tekst soms binnen de drempel en werd hij als leeg voorgesteld.
 */
export async function isBlankPage(source: SourceFile, page: PageRef): Promise<boolean> {
  const canvas = await renderPageToCanvas(source, page.sourcePageIndex, page.rotation, 520)
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let dark = 0
  const total = canvas.width * canvas.height
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    if (luma < 200) dark += 1
  }
  canvas.width = 0
  canvas.height = 0
  return dark / total < 0.0025
}

/** Schat de scheefstand (graden) via een projectieprofiel op een kleine grijswaarde-bitmap. */
function estimateSkew(gray: Uint8Array, w: number, h: number): number {
  let bestAngle = 0
  let bestScore = -1
  for (let deg = -5; deg <= 5; deg += 0.5) {
    const tan = Math.tan((deg * Math.PI) / 180)
    const rows = new Float64Array(h)
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const d = 255 - gray[y * w + x]
        if (d < 40) continue
        const ry = Math.round(y + (x - w / 2) * tan)
        if (ry >= 0 && ry < h) rows[ry] += d
      }
    }
    // Variantie van de rij-sommen: hoog = tekstregels netjes horizontaal.
    let mean = 0
    for (let i = 0; i < h; i += 1) mean += rows[i]
    mean /= h
    let variance = 0
    for (let i = 0; i < h; i += 1) variance += (rows[i] - mean) ** 2
    if (variance > bestScore) {
      bestScore = variance
      bestAngle = deg
    }
  }
  return bestAngle
}

export interface CleanupOptions {
  deskew: boolean
  contrast: boolean
}

/**
 * Schoont een gescande pagina op: rechtzetten (deskew) en achtergrond
 * witter / tekst zwarter maken. Geeft de nieuwe (afbeelding-)bron terug,
 * of null als er niets zinnigs te doen valt.
 */
export async function cleanupScannedPage(
  source: SourceFile,
  page: PageRef,
  options: CleanupOptions,
  newId: string
): Promise<{ source: SourceFile; angle: number } | null> {
  const canvas = await renderPageToCanvas(source, page.sourcePageIndex, page.rotation, 1654) // ~200 DPI op A4
  const w = canvas.width
  const h = canvas.height

  let angle = 0
  if (options.deskew) {
    // Kleine grijswaarde-bitmap voor de hoekschatting.
    const sw = 400
    const sh = Math.max(1, Math.round((h / w) * sw))
    const small = document.createElement('canvas')
    small.width = sw
    small.height = sh
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    sctx.drawImage(canvas, 0, 0, sw, sh)
    const sd = sctx.getImageData(0, 0, sw, sh).data
    const gray = new Uint8Array(sw * sh)
    for (let i = 0; i < gray.length; i += 1) {
      gray[i] = (sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114) | 0
    }
    angle = estimateSkew(gray, sw, sh)
    small.width = 0
    small.height = 0
  }

  if (!options.contrast && Math.abs(angle) < 0.25) {
    // Rechte pagina en geen contrastcorrectie gevraagd: rasteren zou alleen
    // kwaliteit en tekstlaag kosten zonder iets op te lossen.
    canvas.width = 0
    canvas.height = 0
    return null
  }

  // Werkcanvas: witte achtergrond, gedraaide pagina erop.
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d', { willReadFrequently: true })!
  octx.fillStyle = '#ffffff'
  octx.fillRect(0, 0, w, h)
  if (angle !== 0) {
    octx.translate(w / 2, h / 2)
    octx.rotate((-angle * Math.PI) / 180)
    octx.translate(-w / 2, -h / 2)
  }
  octx.drawImage(canvas, 0, 0)
  octx.setTransform(1, 0, 0, 1, 0, 0)
  canvas.width = 0
  canvas.height = 0

  if (options.contrast) {
    const img = octx.getImageData(0, 0, w, h)
    const d = img.data
    // Niveaus: onder lo → zwart, boven hi → wit, ertussen lineair. Grijswaarde.
    const lo = 120
    const hi = 205
    for (let i = 0; i < d.length; i += 4) {
      const luma = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
      let v = ((luma - lo) / (hi - lo)) * 255
      v = v < 0 ? 0 : v > 255 ? 255 : v
      d[i] = d[i + 1] = d[i + 2] = v
    }
    octx.putImageData(img, 0, 0)
  }

  const jpeg = out.toDataURL('image/jpeg', 0.85)
  out.width = 0
  out.height = 0
  const size = await getPagePointSize(source, page.sourcePageIndex, page.rotation)
  const newSource = await createImagePageSource(jpeg, size, `${source.name} (opgeschoond)`, newId)
  return { source: newSource, angle }
}
