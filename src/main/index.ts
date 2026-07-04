import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

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
          return { name: basename(p), data: await readFile(p) }
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
        data: await readFile(p)
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
      return { name: basename(path), data }
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

  ipcMain.handle('dialog:savePdf', async (_evt, defaultName: string, data: Uint8Array) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PDF-bestand', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle('ocr:recognize', async (_evt, png: Uint8Array) => {
    // Lazy import so tesseract.js only loads when OCR is actually used.
    const { recognizePng } = await import('./ocr')
    return recognizePng(png)
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
