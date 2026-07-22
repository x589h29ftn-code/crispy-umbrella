import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Word/Office → PDF, server-side. Geport uit de desktop-app; de Electron-
// printToPDF-fallback is vervangen omdat er server-side geen Chromium is.
// Hoofdroute is LibreOffice headless (aanwezig in de Docker-image), met een
// eenvoudige tekst-fallback voor .docx als LibreOffice ontbreekt (bv. lokaal).
//
// Beveiliging: conversie draait in een eigen tempmap met een privé-profiel,
// een harde timeout en opruiming in `finally`. Netwerktoegang wordt op
// containerniveau geblokkeerd (de conversie heeft geen netwerk nodig).

export const OFFICE_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp']

export interface ConvertResult {
  ok: boolean
  data?: Uint8Array
  error?: string
}

let sofficePathCache: string | null | undefined

function findSoffice(): string | null {
  if (sofficePathCache !== undefined) return sofficePathCache
  const candidates = [
    process.env.SOFFICE_PATH,
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice'
  ].filter(Boolean) as string[]
  sofficePathCache = candidates.find((p) => existsSync(p)) ?? null
  return sofficePathCache
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, cwd, env: { ...process.env, HOME: cwd } }, (error) =>
      error ? reject(error) : resolve()
    )
  })
}

async function convertWithLibreOffice(soffice: string, name: string, data: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'ovp-office-'))
  try {
    const safeName = basename(name).replace(/[^\w.\- ]/g, '_') || `document${extname(name)}`
    const inputPath = join(dir, safeName)
    await writeFile(inputPath, Buffer.from(data))
    const profileUrl = pathToFileURL(join(dir, 'profile')).href
    await run(
      soffice,
      [
        '--headless',
        '--norestore',
        '--nolockcheck',
        `-env:UserInstallation=${profileUrl}`,
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        inputPath
      ],
      dir,
      120_000
    )
    const outPath = inputPath.replace(/\.[^.]+$/, '.pdf')
    return new Uint8Array(await readFile(outPath))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// Laatste redmiddel zonder LibreOffice: docx → platte tekst → eenvoudige PDF.
async function convertDocxTextFallback(data: Uint8Array): Promise<Uint8Array> {
  const mammoth = await import('mammoth').catch(() => null)
  if (!mammoth) throw new Error('LibreOffice ontbreekt en er is geen fallback beschikbaar.')
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) })
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const size = 11
  const margin = 56
  const pageW = 595.28
  const pageH = 841.89
  const maxWidth = pageW - margin * 2
  const words = value.replace(/\r/g, '').split(/\n/)
  let page = doc.addPage([pageW, pageH])
  let y = pageH - margin
  const writeLine = (text: string) => {
    if (y < margin) {
      page = doc.addPage([pageW, pageH])
      y = pageH - margin
    }
    page.drawText(text, { x: margin, y, size, font })
    y -= size + 4
  }
  for (const paragraph of words) {
    if (paragraph.trim() === '') {
      y -= size
      continue
    }
    // Woordwrap.
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const attempt = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(attempt, size) > maxWidth) {
        writeLine(line)
        line = word
      } else {
        line = attempt
      }
    }
    if (line) writeLine(line)
  }
  return doc.save()
}

export async function convertOfficeToPdf(name: string, data: Uint8Array): Promise<ConvertResult> {
  const ext = extname(name).slice(1).toLowerCase()
  try {
    const soffice = findSoffice()
    if (soffice) {
      return { ok: true, data: await convertWithLibreOffice(soffice, name, data) }
    }
    if (ext === 'docx') {
      return { ok: true, data: await convertDocxTextFallback(data) }
    }
    return {
      ok: false,
      error: `Voor .${ext}-bestanden is LibreOffice vereist op de server. Neem contact op met de beheerder.`
    }
  } catch (error) {
    return { ok: false, error: `Conversie mislukt: ${(error as Error).message ?? error}` }
  }
}
