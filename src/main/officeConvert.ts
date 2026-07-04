import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'

/**
 * Converts Word/Excel/PowerPoint files to PDF for import.
 *
 * Primary path: LibreOffice headless (`soffice --convert-to pdf`) when it is
 * installed — best fidelity for all three formats. Fallback without
 * LibreOffice: docx via mammoth → HTML and xlsx/csv via SheetJS → HTML, both
 * printed to PDF with Chromium's printToPDF. PowerPoint has no reasonable
 * pure-JS fallback and requires LibreOffice.
 */

export const OFFICE_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp']

export interface ConvertResult {
  ok: boolean
  data?: Uint8Array
  error?: string
}

const WINDOWS_SOFFICE_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
]

let sofficePathCache: string | null | undefined

function findSoffice(): string | null {
  if (sofficePathCache !== undefined) return sofficePathCache
  const candidates =
    process.platform === 'win32'
      ? WINDOWS_SOFFICE_PATHS
      : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice',
         '/Applications/LibreOffice.app/Contents/MacOS/soffice']
  sofficePathCache = candidates.find((p) => existsSync(p)) ?? null
  return sofficePathCache
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (error) => (error ? reject(error) : resolve()))
  })
}

async function convertWithLibreOffice(soffice: string, name: string, data: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfstudio-office-'))
  try {
    const safeName = basename(name).replace(/[^\w.\- ]/g, '_') || `document${extname(name)}`
    const inputPath = join(dir, safeName)
    await writeFile(inputPath, Buffer.from(data))
    // A private user profile keeps the conversion working even while the
    // user has LibreOffice itself open (the default profile is locked then).
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
      120_000
    )
    const outPath = inputPath.replace(/\.[^.]+$/, '.pdf')
    return new Uint8Array(await readFile(outPath))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function htmlToPdf(html: string, landscape: boolean): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfstudio-html-'))
  const htmlPath = join(dir, 'input.html')
  await writeFile(htmlPath, html, 'utf-8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false }
  })
  try {
    await win.loadFile(htmlPath)
    const buffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      landscape,
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })
    return new Uint8Array(buffer)
  } finally {
    win.destroy()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const BASE_STYLE = `<style>
  body { font-family: Arial, 'Liberation Sans', sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
  table { border-collapse: collapse; margin-bottom: 12px; }
  td, th { border: 1px solid #bbb; padding: 3px 7px; font-size: 9.5pt; white-space: nowrap; }
  h1, h2, h3 { line-height: 1.25; }
  img { max-width: 100%; }
</style>`

async function convertDocxFallback(data: Uint8Array): Promise<Uint8Array> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(data) })
  return htmlToPdf(`<!doctype html><html><head><meta charset="utf-8">${BASE_STYLE}</head><body>${value}</body></html>`, false)
}

async function convertSheetFallback(data: Uint8Array): Promise<Uint8Array> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(data, { type: 'array' })
  const parts = workbook.SheetNames.map((sheetName) => {
    const table = XLSX.utils.sheet_to_html(workbook.Sheets[sheetName], { header: '', footer: '' })
    return `<h3>${sheetName}</h3>${table}`
  })
  return htmlToPdf(
    `<!doctype html><html><head><meta charset="utf-8">${BASE_STYLE}</head><body>${parts.join('')}</body></html>`,
    true
  )
}

export async function convertOfficeToPdf(name: string, data: Uint8Array): Promise<ConvertResult> {
  const ext = extname(name).slice(1).toLowerCase()
  try {
    const soffice = findSoffice()
    if (soffice) {
      return { ok: true, data: await convertWithLibreOffice(soffice, name, data) }
    }
    if (['docx', 'doc', 'odt', 'rtf'].includes(ext)) {
      if (ext !== 'docx') {
        return {
          ok: false,
          error: `Voor .${ext}-bestanden is LibreOffice nodig (gratis, libreoffice.org) — of sla het op als .docx.`
        }
      }
      return { ok: true, data: await convertDocxFallback(data) }
    }
    if (['xlsx', 'xls', 'ods', 'csv'].includes(ext)) {
      return { ok: true, data: await convertSheetFallback(data) }
    }
    return {
      ok: false,
      error:
        'Voor PowerPoint-bestanden is LibreOffice nodig (gratis te installeren via libreoffice.org); daarna werkt de import automatisch.'
    }
  } catch (error) {
    return { ok: false, error: `Conversie mislukt: ${(error as Error).message ?? error}` }
  }
}
