import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTool } from '@/lib/sandbox'

// Haalt tekst uit een geüpload document voor automatische herkenning.
// Strategie: eerst de tekstlaag (snel, foutloos voor digitale PDF's zoals uit
// Visionplanner). Alleen als die (vrijwel) leeg is, valt de code terug op OCR
// (lokaal, via poppler + Tesseract in de Docker-image). Er gaat geen data naar
// buiten. We lezen maar een paar pagina's; meer is voor classificatie onnodig.

export interface ExtractResult {
  text: string
  ocrUsed: boolean
}

const MAX_PAGES = 3
const MIN_USEFUL_CHARS = 40

function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/// Tekstlaag uit een PDF halen met pdf.js (server-side, geen worker/canvas nodig).
async function pdfTextLayer(bytes: Uint8Array): Promise<string> {
  try {
    // Legacy-build draait in Node zonder aparte worker.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false
    }).promise
    const pages = Math.min(doc.numPages, MAX_PAGES)
    const parts: string[] = []
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    }
    await doc.destroy()
    return parts.join('\n')
  } catch {
    return ''
  }
}

/**
 * Zelfde behandeling als de Office-conversie: eigen werkmap als HOME, uitgeklede
 * omgeving zonder proxy of geheimen, harde tijdslimiet. Zie lib/sandbox.ts voor wat
 * dat wél en niet is.
 */
async function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  await runTool(cmd, args, { cwd, timeoutMs })
}

function findBin(candidates: string[]): string | null {
  return candidates.find((p) => existsSync(p)) ?? null
}

/// OCR-terugval: PDF -> afbeeldingen (poppler pdftoppm) -> tekst (Tesseract nld).
/// Vereist beide binaries in de container; ontbreken ze, dan wordt '' teruggegeven.
async function pdfOcr(bytes: Uint8Array): Promise<string> {
  const pdftoppm = findBin([process.env.PDFTOPPM_PATH || '', '/usr/bin/pdftoppm', '/usr/local/bin/pdftoppm'].filter(Boolean))
  const tesseract = findBin([process.env.TESSERACT_PATH || '', '/usr/bin/tesseract', '/usr/local/bin/tesseract'].filter(Boolean))
  if (!pdftoppm || !tesseract) return ''
  const dir = await mkdtemp(join(tmpdir(), 'ovp-ocr-'))
  try {
    await writeFile(join(dir, 'in.pdf'), Buffer.from(bytes))
    // Alleen de eerste pagina('s) renderen op 200 dpi.
    await run(pdftoppm, ['-png', '-r', '200', '-f', '1', '-l', String(MAX_PAGES), 'in.pdf', 'page'], dir, 120_000)
    const images = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort()
    const texts: string[] = []
    for (const img of images) {
      await run(tesseract, [img, 'out', '-l', 'nld', '--psm', '3'], dir, 120_000).catch(() => undefined)
      const out = join(dir, 'out.txt')
      if (existsSync(out)) texts.push(await readFile(out, 'utf8'))
    }
    return texts.join('\n')
  } catch {
    return ''
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/// Platte tekst uit een .docx via mammoth (voor herkenning vóór conversie).
async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth').catch(() => null)
  if (!mammoth) return ''
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    return value
  } catch {
    return ''
  }
}

/// Hoofdfunctie. `ext` is de originele extensie (pdf, docx, ...).
export async function extractText(ext: string, bytes: Uint8Array): Promise<ExtractResult> {
  if (ext === 'docx') {
    return { text: await docxText(bytes), ocrUsed: false }
  }
  if (isPdf(bytes)) {
    const layer = await pdfTextLayer(bytes)
    if (layer.replace(/\s+/g, '').length >= MIN_USEFUL_CHARS) {
      return { text: layer, ocrUsed: false }
    }
    // Weinig tot geen tekstlaag: ingescand stuk -> OCR-terugval.
    const ocr = await pdfOcr(bytes)
    if (ocr.trim()) return { text: ocr, ocrUsed: true }
    return { text: layer, ocrUsed: false }
  }
  return { text: '', ocrUsed: false }
}
