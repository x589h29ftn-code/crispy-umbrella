import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { randomUUID } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

// Losse vensters: een document dat naar een eigen venster is losgekoppeld. De
// payload wacht hier tot het nieuwe venster hem via 'window:consumeHandoff' ophaalt.
const documentHandoffs = new Map<string, unknown>()

// ---- Recent geopende bestanden (userData/recent.json) ----

const MAX_RECENT = 12

function recentPath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

async function readRecent(): Promise<{ path: string; name: string; openedAt: number }[]> {
  try {
    const raw = await readFile(recentPath(), 'utf-8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function rememberRecent(paths: string[]): Promise<void> {
  if (!paths.length) return
  try {
    const now = Date.now()
    let list = await readRecent()
    for (const p of paths) {
      list = list.filter((r) => r.path !== p)
      list.unshift({ path: p, name: basename(p), openedAt: now })
      app.addRecentDocument(p)
    }
    await writeFile(recentPath(), JSON.stringify(list.slice(0, MAX_RECENT)), 'utf-8')
  } catch {
    // Recente lijst is best-effort.
  }
}

// ---- Sessieherstel (userData/session) ----

function sessionDir(): string {
  return join(app.getPath('userData'), 'session')
}

function sessionSourcesDir(): string {
  return join(sessionDir(), 'sources')
}

const IMPORTABLE = ['.pdf', '.docx', '.doc', '.odt', '.rtf', '.xlsx', '.xls', '.ods', '.csv', '.pptx', '.ppt', '.odp']

function importableArgs(argv: string[]): string[] {
  return argv.filter((a) => {
    const lower = a.toLowerCase()
    return IMPORTABLE.some((ext) => lower.endsWith(ext)) && !a.startsWith('-')
  })
}

async function sendFilesToWindow(win: BrowserWindow, paths: string[]): Promise<void> {
  const files = (
    await Promise.all(
      paths.map(async (p) => {
        try {
          return { name: basename(p), data: await readFile(p), path: p }
        } catch {
          return null
        }
      })
    )
  ).filter(Boolean)
  if (files.length) {
    win.webContents.send('files:opened', files)
    void rememberRecent(paths)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141416',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const filesToOpen = importableArgs(process.argv.slice(1))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (filesToOpen.length) {
    win.webContents.once('did-finish-load', () => {
      void sendFilesToWindow(win, filesToOpen)
    })
  }
}

/**
 * Opent een los venster dat één document toont. Het document wordt via een
 * handoff-id doorgegeven; dit venster herstelt géén sessie en overschrijft de
 * gedeelde sessie niet (de renderer herkent de handoff aan de URL-hash).
 */
function createDetachedWindow(handoffId: string): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141416',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  const hash = `handoff=${handoffId}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

// Eén instantie: een tweede start (bijv. dubbelklik op een PDF wanneer de app
// al draait) stuurt de bestanden naar het bestaande venster.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', (_evt, argv) => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  const files = importableArgs(argv.slice(1))
  if (files.length) void sendFilesToWindow(mainWindow, files)
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pdfstudio.app')

  void import('./updater').then(({ initAutoUpdater }) => initAutoUpdater())

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('print:html', async (_evt, html: string) => {
    // The document is rendered to page images in the renderer; here we load
    // them into a hidden window and hand off to the native print dialog.
    const dir = await mkdtemp(join(tmpdir(), 'pdfstudio-print-'))
    const htmlPath = join(dir, 'print.html')
    await writeFile(htmlPath, html, 'utf-8')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
    try {
      await win.loadFile(htmlPath)
      return await new Promise((resolve) => {
        win.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
          resolve({ ok: success, reason: failureReason })
        })
      })
    } finally {
      win.destroy()
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  ipcMain.handle('office:convert', async (_evt, name: string, data: Uint8Array) => {
    const { convertOfficeToPdf } = await import('./officeConvert')
    return convertOfficeToPdf(name, data)
  })

  ipcMain.handle('remarkable:status', async () => {
    const { remarkableStatus } = await import('./remarkable')
    return remarkableStatus()
  })

  ipcMain.handle('remarkable:pair', async (_evt, code: string) => {
    const { remarkablePair } = await import('./remarkable')
    return remarkablePair(code)
  })

  ipcMain.handle('remarkable:unpair', async () => {
    const { remarkableUnpair } = await import('./remarkable')
    return remarkableUnpair()
  })

  ipcMain.handle('remarkable:upload', async (_evt, name: string, data: Uint8Array) => {
    const { remarkableUpload } = await import('./remarkable')
    return remarkableUpload(name, data)
  })

  ipcMain.handle('dialog:openPdfs', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'PDF- en Office-bestanden',
          extensions: ['pdf', 'docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp']
        },
        { name: 'PDF-bestanden', extensions: ['pdf'] }
      ]
    })
    if (result.canceled) return []
    void rememberRecent(result.filePaths)
    return Promise.all(
      result.filePaths.map(async (p) => ({
        name: basename(p),
        data: await readFile(p),
        path: p
      }))
    )
  })

  ipcMain.handle('recent:list', async () => {
    const list = await readRecent()
    const existing: { path: string; name: string }[] = []
    for (const entry of list) {
      try {
        await stat(entry.path)
        existing.push({ path: entry.path, name: entry.name })
      } catch {
        // Verplaatst of verwijderd — stilletjes overslaan.
      }
    }
    return existing
  })

  ipcMain.handle('recent:open', async (_evt, path: string) => {
    try {
      const data = await readFile(path)
      void rememberRecent([path])
      return { name: basename(path), data, path }
    } catch {
      return { error: 'Het bestand is verplaatst of verwijderd' }
    }
  })

  // ---- Sessieherstel ----

  ipcMain.handle('session:load', async () => {
    try {
      const raw = await readFile(join(sessionDir(), 'state.json'), 'utf-8')
      const state = JSON.parse(raw)
      const metas: { id: string; name: string; pageCount: number }[] = state.sources ?? []
      const sources = (
        await Promise.all(
          metas.map(async (meta) => {
            try {
              const data = await readFile(join(sessionSourcesDir(), `${meta.id}.bin`))
              return { id: meta.id, name: meta.name, pageCount: meta.pageCount, data }
            } catch {
              return null
            }
          })
        )
      ).filter(Boolean)
      return { state, sources }
    } catch {
      return { state: null, sources: [] }
    }
  })

  ipcMain.handle('session:save', async (_evt, stateJson: string) => {
    try {
      await mkdir(sessionSourcesDir(), { recursive: true })
      await writeFile(join(sessionDir(), 'state.json'), stateJson, 'utf-8')
      const state = JSON.parse(stateJson)
      const wanted = new Set(((state.sources ?? []) as { id: string }[]).map((m) => `${m.id}.bin`))
      const missing: string[] = []
      const present = new Set(await readdir(sessionSourcesDir()))
      for (const file of present) {
        if (!wanted.has(file)) void unlink(join(sessionSourcesDir(), file)).catch(() => undefined)
      }
      for (const meta of (state.sources ?? []) as { id: string }[]) {
        if (!present.has(`${meta.id}.bin`)) missing.push(meta.id)
      }
      return { missing }
    } catch {
      return { missing: [] }
    }
  })

  ipcMain.handle('session:saveSources', async (_evt, sources: { id: string; data: Uint8Array }[]) => {
    try {
      await mkdir(sessionSourcesDir(), { recursive: true })
      for (const source of sources) {
        await writeFile(join(sessionSourcesDir(), `${source.id}.bin`), Buffer.from(source.data))
      }
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('session:clear', async () => {
    await rm(sessionDir(), { recursive: true, force: true }).catch(() => undefined)
    return true
  })

  // ---- Documentsjablonen (userData/templates): index.json + {id}.docx ----
  const templatesDir = (): string => join(app.getPath('userData'), 'templates')
  const templatesIndexPath = (): string => join(templatesDir(), 'index.json')

  ipcMain.handle('templates:list', async () => {
    try {
      return JSON.parse(await readFile(templatesIndexPath(), 'utf-8'))
    } catch {
      return []
    }
  })

  ipcMain.handle('templates:save', async (_evt, metaJson: string, docx: Uint8Array | null) => {
    try {
      await mkdir(templatesDir(), { recursive: true })
      const meta = JSON.parse(metaJson) as { id: string }
      let list: { id: string }[] = []
      try {
        list = JSON.parse(await readFile(templatesIndexPath(), 'utf-8'))
      } catch {
        /* nog geen index */
      }
      const idx = list.findIndex((t) => t.id === meta.id)
      if (idx >= 0) list[idx] = meta
      else list.push(meta)
      await writeFile(templatesIndexPath(), JSON.stringify(list, null, 1), 'utf-8')
      if (docx) await writeFile(join(templatesDir(), `${meta.id}.docx`), Buffer.from(docx))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('templates:delete', async (_evt, id: string) => {
    try {
      let list: { id: string }[] = []
      try {
        list = JSON.parse(await readFile(templatesIndexPath(), 'utf-8'))
      } catch {
        /* geen index */
      }
      await writeFile(templatesIndexPath(), JSON.stringify(list.filter((t) => t.id !== id), null, 1), 'utf-8')
      await unlink(join(templatesDir(), `${id}.docx`)).catch(() => undefined)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('templates:loadDocx', async (_evt, id: string) => {
    try {
      return await readFile(join(templatesDir(), `${id}.docx`))
    } catch {
      return null
    }
  })

  ipcMain.handle('dialog:savePdf', async (_evt, defaultName: string, data: Uint8Array) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PDF-bestand', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  })

  // Opslaan in de lokale OneDrive-map (gesynchroniseerd door de OneDrive-app).
  ipcMain.handle('onedrive:savePdf', async (_evt, defaultName: string, data: Uint8Array) => {
    const base = process.env.OneDriveCommercial || process.env.OneDrive || process.env.OneDriveConsumer
    if (!base) return { saved: false, reason: 'Geen OneDrive-map gevonden — is de OneDrive-app ingesteld op deze pc?' }
    const result = await dialog.showSaveDialog({
      defaultPath: join(base, defaultName),
      filters: [{ name: 'PDF-bestand', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  })

  // Mail als bijlage: opent een nieuw Outlook-bericht met de PDF eraan (COM).
  // Zonder Outlook valt het terug op de Verkenner met het bestand geselecteerd.
  ipcMain.handle('mail:pdf', async (_evt, name: string, data: Uint8Array) => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfstudio-mail-'))
    const file = join(dir, name.replace(/[\\/:*?"<>|]/g, '_'))
    await writeFile(file, Buffer.from(data))
    if (process.platform === 'win32') {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `$ol = New-Object -ComObject Outlook.Application; $m = $ol.CreateItem(0); $m.Attachments.Add('${file.replace(/'/g, "''")}') | Out-Null; $m.Display()`
            ],
            (err) => (err ? reject(err) : resolve())
          )
        })
        return { ok: true }
      } catch {
        // Outlook niet beschikbaar — val terug op de Verkenner.
      }
    }
    shell.showItemInFolder(file)
    return { ok: true, fallback: true }
  })

  // Opent een bestand in de standaard-app (bv. het geëxporteerde Excel-bestand).
  ipcMain.handle('shell:openPath', async (_evt, path: string) => {
    const err = await shell.openPath(path)
    return { ok: !err, error: err || undefined }
  })

  // Overschrijft een bestaand bestand rechtstreeks (Ctrl+S → opslaan naar bron).
  ipcMain.handle('dialog:savePdfToPath', async (_evt, path: string, data: Uint8Array) => {
    try {
      await writeFile(path, Buffer.from(data))
      return { saved: true, path }
    } catch {
      return { saved: false }
    }
  })

  ipcMain.handle('ocr:recognize', async (_evt, png: Uint8Array) => {
    // Lazy import so tesseract.js only loads when OCR is actually used.
    const { recognizePng } = await import('./ocr')
    return recognizePng(png)
  })

  // ---- Losse vensters ----
  ipcMain.handle('window:openDocument', async (_evt, payload: unknown) => {
    const id = randomUUID()
    documentHandoffs.set(id, payload)
    createDetachedWindow(id)
    return { ok: true }
  })

  ipcMain.handle('window:consumeHandoff', async (_evt, id: string) => {
    const payload = documentHandoffs.get(id) ?? null
    documentHandoffs.delete(id)
    return payload
  })

  ipcMain.handle('dialog:saveZip', async (_evt, defaultName: string, data: Uint8Array) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'ZIP-archief', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle('dialog:saveFile', async (_evt, defaultName: string, data: Uint8Array, extension: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void import('./ocr').then(({ disposeOcrWorker }) => disposeOcrWorker())
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
