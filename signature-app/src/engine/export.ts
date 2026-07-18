import type { SignatureRender } from '../types'

export const INK = '#1a1a2e'

/** Bouwt een zelfstandige SVG-string. Alleen paden — geen fonts nodig bij de
 *  ontvanger, dus het bestand ziet er overal identiek uit. */
export function toSvgString(render: SignatureRender, ink = INK, background?: string): string {
  const { x, y, w, h } = render.viewBox
  const bg = background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${background}"/>` : ''
  const paths = render.paths
    .map((p) => {
      const fill = p.fill === 'currentColor' ? ink : (p.fill ?? 'none')
      const stroke = p.stroke === 'currentColor' ? ink : p.stroke
      const strokeAttrs = stroke
        ? ` stroke="${stroke}" stroke-width="${p.strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round"`
        : ''
      return `<path d="${p.d}" fill="${fill}"${strokeAttrs}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}">${bg}${paths}</svg>`
}

/** Rastert de SVG naar PNG via een canvas (4× voor scherpte). */
export async function toPngBlob(
  render: SignatureRender,
  opts: { background?: string; scale?: number; ink?: string } = {}
): Promise<Blob> {
  const scale = opts.scale ?? 4
  const svg = toSvgString(render, opts.ink ?? INK, opts.background)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('SVG kon niet worden geladen'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(render.viewBox.w * scale))
    canvas.height = Math.max(1, Math.round(render.viewBox.h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas niet beschikbaar')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG-export mislukt'))), 'image/png')
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadSvg(render: SignatureRender, filename: string, ink?: string): void {
  downloadBlob(new Blob([toSvgString(render, ink ?? INK)], { type: 'image/svg+xml' }), filename)
}

export async function downloadPng(
  render: SignatureRender,
  filename: string,
  background?: string,
  ink?: string
): Promise<void> {
  downloadBlob(await toPngBlob(render, { background, ink }), filename)
}

export function clipboardSupported(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
}

/** Kopieert de handtekening als PNG (witte achtergrond: transparantie wordt in
 *  veel plak-doelen zwart weergegeven). */
export async function copyPng(render: SignatureRender, ink?: string): Promise<void> {
  const blob = await toPngBlob(render, { background: '#ffffff', ink })
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** Bestandsnaam-veilige variant van de handtekeningtekst. */
export function safeFilename(text: string, suffix: string): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'handtekening'
  return `handtekening-${base}${suffix}`
}
