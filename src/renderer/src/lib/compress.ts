import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import { forgetSource, getPagePointSize, loadSourceFile, renderPageToCanvas } from './pdfRender'
import { getTextItems } from './textLines'
import type { SourceFile } from '../types'

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} kB`
}

export interface CompressOptions {
  /** 0 = zo klein mogelijk, 100 = vrijwel originele kwaliteit. */
  quality: number
  /** Pagina's mét tekstlaag onaangeroerd laten (scherp en doorzoekbaar). */
  keepTextPages: boolean
  /** Kleur weglaten: scheelt fors bij scans van zwarte tekst. */
  grayscale: boolean
}

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = { quality: 45, keepTextPages: true, grayscale: false }

export interface CompressSettings {
  dpi: number
  jpeg: number
  label: string
}

/**
 * Vertaalt de schuifregelaar naar resolutie en JPEG-kwaliteit. De onderkant
 * (72 dpi) is leesbaar op het scherm, de bovenkant (200 dpi) is scherp genoeg
 * om te printen.
 */
export function compressSettings(quality: number): CompressSettings {
  const q = Math.min(100, Math.max(0, quality)) / 100
  const dpi = Math.round(72 + q * 128)
  const jpeg = Number((0.45 + q * 0.5).toFixed(2))
  const label =
    quality < 20 ? 'Kleinst (mailen)' : quality < 45 ? 'Klein' : quality < 70 ? 'Gemiddeld' : quality < 90 ? 'Scherp' : 'Vrijwel origineel'
  return { dpi, jpeg, label }
}

/** Eén pagina als JPEG op de gekozen resolutie. */
async function pageToJpeg(
  source: SourceFile,
  pageIndex: number,
  settings: CompressSettings,
  grayscale: boolean
): Promise<{ bytes: Uint8Array; dataUrl: string; width: number; height: number }> {
  const size = await getPagePointSize(source, pageIndex, 0)
  const target = Math.max(200, Math.round((size.width * settings.dpi) / 72))
  const canvas = await renderPageToCanvas(source, pageIndex, 0, target)
  let output = canvas
  if (grayscale) {
    const gray = document.createElement('canvas')
    gray.width = canvas.width
    gray.height = canvas.height
    const ctx = gray.getContext('2d')
    if (ctx) {
      ctx.filter = 'grayscale(1)'
      ctx.drawImage(canvas, 0, 0)
      output = gray
    }
  }
  const dataUrl = output.toDataURL('image/jpeg', settings.jpeg)
  canvas.width = 0
  canvas.height = 0
  if (output !== canvas) {
    output.width = 0
    output.height = 0
  }
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
  return { bytes, dataUrl, width: size.width, height: size.height }
}

/** Heeft deze pagina een bruikbare tekstlaag? Dan is rasteren zonde. */
async function hasTextLayer(source: SourceFile, pageIndex: number): Promise<boolean> {
  const items = await getTextItems(source, pageIndex).catch(() => [])
  return items.reduce((n, i) => n + i.str.trim().length, 0) > 80
}

/**
 * Exporteert het actieve document één keer volledig (met alle bewerkingen). Dat
 * bestand is zowel de referentiegrootte als de bron voor het comprimeren.
 */
export async function buildBaseline(): Promise<{ bytes: Uint8Array; source: SourceFile; sourceId: string; name: string }> {
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) throw new Error('Geen document')
  const { exportGroupToPdf } = await import('./pdfEngine')
  const bytes = await exportGroupToPdf(group, state.sources, {
    formValues: state.formValues,
    flattenForms: true,
    cleanMetadata: state.cleanMetadata
  })
  const sourceId = `compress-${nanoid()}`
  const source = await loadSourceFile('compress', bytes, sourceId)
  return { bytes, source, sourceId, name: group.name }
}

export function releaseBaseline(sourceId: string): void {
  forgetSource(sourceId)
}

export interface CompressEstimate {
  /** Geschatte grootte van het hele document in bytes. */
  estimatedBytes: number
  /** Voorbeeldpagina op de gekozen instelling. */
  previewUrl: string
  /** Pagina waarop het voorbeeld gebaseerd is (1-based). */
  previewPage: number
  /** Pagina's die ongemoeid blijven omdat ze tekst bevatten. */
  keptPages: number
}

/**
 * Schat de eindgrootte op basis van een paar steekproefpagina's, zodat de
 * schuifregelaar direct laat zien wat een instelling oplevert zonder het hele
 * document te verwerken.
 */
export async function estimateCompression(
  source: SourceFile,
  baselineBytes: number,
  options: CompressOptions
): Promise<CompressEstimate> {
  const settings = compressSettings(options.quality)
  const total = source.pageCount
  const sampleIndexes = [...new Set([0, Math.floor(total / 2), total - 1])].filter((i) => i >= 0 && i < total).slice(0, 3)

  let sampled = 0
  let rasterSampled = 0
  let rasterBytes = 0
  let keptSampled = 0
  let previewUrl = ''
  let previewPage = 1

  for (const index of sampleIndexes) {
    const keep = options.keepTextPages && (await hasTextLayer(source, index))
    const { bytes, dataUrl } = await pageToJpeg(source, index, settings, options.grayscale)
    if (!previewUrl) {
      previewUrl = dataUrl
      previewPage = index + 1
    }
    if (keep) {
      keptSampled += 1
    } else {
      rasterSampled += 1
      rasterBytes += bytes.length
    }
    sampled += 1
  }

  // Bewaarde pagina's houden hun aandeel in het originele bestand; alleen de
  // opnieuw opgebouwde pagina's krijgen de geschatte JPEG-grootte.
  const keptPages = sampled ? Math.round((keptSampled / sampled) * total) : 0
  const rasterPages = total - keptPages
  const perRasterPage = rasterSampled ? rasterBytes / rasterSampled : 0
  const estimatedBytes = Math.round(
    keptPages * (baselineBytes / total) + rasterPages * perRasterPage * 1.03 + (rasterPages ? 1500 : 0)
  )
  return { estimatedBytes, previewUrl, previewPage, keptPages }
}

/**
 * Bouwt de gecomprimeerde PDF. Pagina's met tekst kunnen ongemoeid blijven
 * (scherp én doorzoekbaar); de rest wordt als JPEG opnieuw opgebouwd.
 */
export async function compressDocument(
  baseline: { bytes: Uint8Array; source: SourceFile },
  options: CompressOptions,
  onProgress?: (done: number, total: number) => void
): Promise<{ bytes: Uint8Array; rasterized: number; kept: number }> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const settings = compressSettings(options.quality)
  const original = await PDFDocument.load(baseline.bytes)
  const out = await PDFDocument.create()
  const total = baseline.source.pageCount
  let rasterized = 0
  let kept = 0

  for (let i = 0; i < total; i += 1) {
    const keep = options.keepTextPages && (await hasTextLayer(baseline.source, i))
    if (keep) {
      const [copied] = await out.copyPages(original, [i])
      out.addPage(copied)
      kept += 1
    } else {
      const { bytes, width, height } = await pageToJpeg(baseline.source, i, settings, options.grayscale)
      const img = await out.embedJpg(bytes)
      const page = out.addPage([width, height])
      page.drawImage(img, { x: 0, y: 0, width, height })
      rasterized += 1
    }
    onProgress?.(i + 1, total)
  }

  out.setTitle(original.getTitle() ?? '')
  const bytes = await out.save()
  return { bytes, rasterized, kept }
}

/** Slaat het gecomprimeerde bestand op; bij geen winst wordt de gewone export bewaard. */
export async function saveCompressed(
  name: string,
  small: Uint8Array,
  full: Uint8Array
): Promise<void> {
  const state = useStudioStore.getState()
  const base = name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
  if (small.length >= full.length) {
    const result = await window.api.savePdf(`${base}.pdf`, full)
    if (result.saved) {
      state.addToast('info', `Document is al compact (${formatSize(full.length)}) — gewone export opgeslagen`)
    }
    return
  }
  const pct = Math.round((1 - small.length / full.length) * 100)
  const result = await window.api.savePdf(`${base} (klein).pdf`, small)
  if (result.saved) {
    state.addToast('success', `Gecomprimeerd: ${formatSize(full.length)} → ${formatSize(small.length)} (−${pct}%)`)
  }
}
