import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { join, basename } from 'path'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises'
import { readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { randomUUID } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

// Losse vensters: een document dat naar een eigen venster is losgekoppeld. De
// payload wacht hier tot het nieuwe venster hem via 'window:consumeHandoff' ophaalt.
const documentHandoffs = new Map<string, unknown>()

// ---- Venster-voorkeuren (userData/window.json) ----
//
// Grootte, positie en het gekozen thema worden onthouden. Het thema staat hier
// óók (de renderer bewaart het in localStorage) zodat het venster meteen in de
// juiste kleur opent en je bij het opstarten geen donkere flits ziet.

interface WindowPrefs {
  bounds?: { x: number; y: number; width: number; height: number }
  maximized?: boolean
  theme?: 'dark' | 'light'
}

const WINDOW_BACKGROUNDS = { dark: '#141416', light: '#eef0f4' } as const

let windowPrefs: WindowPrefs = {}

function windowPrefsPath(): string {
  return join(app.getPath('userData'), 'window.json')
}

/** Leest de voorkeuren synchroon: het venster wordt er direct mee opgebouwd. */
function loadWindowPrefs(): void {
  try {
    const parsed = JSON.parse(readFileSync(windowPrefsPath(), 'utf-8'))
    if (parsed && typeof parsed === 'object') windowPrefs = parsed as WindowPrefs
  } catch {
    // Geen (of kapotte) voorkeuren: standaardafmetingen.
  }
}

function saveWindowPrefs(): void {
  try {
    writeFileSync(windowPrefsPath(), JSON.stringify(windowPrefs), 'utf-8')
  } catch {
    // Best-effort.
  }
}

/** Alleen hergebruiken als het venster nog (deels) op een aangesloten scherm valt. */
function usableBounds(): WindowPrefs['bounds'] | null {
  const b = windowPrefs.bounds
  if (!b || [b.x, b.y, b.width, b.height].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
  if (b.width < 400 || b.height < 300) return null
  const visible = screen.getAllDisplays().some((display) => {
    const a = display.workArea
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
  return visible ? b : null
}

function rememberBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  windowPrefs.maximized = win.isMaximized()
  if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
    windowPrefs.bounds = win.getNormalBounds()
  }
  saveWindowPrefs()
}

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

/**
 * Bevestiging bij afsluiten. De renderer meldt of er nog niet-opgeslagen werk
 * openstaat (per venster); zo ja, dan vragen we het na met een echt
 * Windows-venster in plaats van de app zonder waarschuwing te laten verdwijnen.
 */
const closeGuards = new Map<number, boolean>()
/** Vensters die na een bevestigd "Afsluiten" alsnog dicht mogen. */
const closeConfirmed = new Set<number>()

function attachCloseGuard(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (closeConfirmed.has(win.id) || !closeGuards.get(win.id)) return
    event.preventDefault()
    void dialog
      .showMessageBox(win, {
        type: 'question',
        buttons: ['Afsluiten', 'Annuleren'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'PDF Studio afsluiten',
        message: 'Weet je zeker dat je PDF Studio wilt afsluiten?',
        detail:
          'Er zijn bewerkingen die nog niet zijn opgeslagen. Als je nu afsluit gaan die verloren. ' +
          'Annuleer en gebruik Ctrl+S (of Opslaan als PDF) om je werk te bewaren.'
      })
      .then(({ response }) => {
        if (response !== 0) return
        closeConfirmed.add(win.id)
        closeGuards.delete(win.id)
        win.close()
      })
  })
  win.on('closed', () => {
    closeGuards.delete(win.id)
    closeConfirmed.delete(win.id)
  })
}

function createWindow(): void {
  const saved = usableBounds()
  const win = new BrowserWindow({
    ...(saved ? saved : { width: 1280, height: 820 }),
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: WINDOW_BACKGROUNDS[windowPrefs.theme === 'light' ? 'light' : 'dark'],
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win

  if (windowPrefs.maximized) win.maximize()

  win.on('ready-to-show', () => {
    win.show()
  })

  // Grootte/positie onthouden; tijdens het slepen niet bij elke pixel schrijven.
  let boundsTimer: NodeJS.Timeout | null = null
  const scheduleRemember = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => rememberBounds(win), 400)
  }
  win.on('resize', scheduleRemember)
  win.on('move', scheduleRemember)
  win.on('maximize', scheduleRemember)
  win.on('unmaximize', scheduleRemember)
  win.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    rememberBounds(win)
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  attachCloseGuard(win)

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
    backgroundColor: WINDOW_BACKGROUNDS[windowPrefs.theme === 'light' ? 'light' : 'dark'],
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.on('ready-to-show', () => win.show())
  attachCloseGuard(win)
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
  loadWindowPrefs()

  // De updater doet meteen een netwerkcheck; die wachten we af tot het venster
  // er staat, zodat het opstarten er niet door vertraagd wordt.
  setTimeout(() => {
    void import('./updater').then(({ initAutoUpdater }) => initAutoUpdater())
  }, 8000)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // De renderer meldt het gekozen thema zodat het volgende venster meteen in
  // de juiste kleur opent.
  ipcMain.on('prefs:theme', (_evt, theme: 'dark' | 'light') => {
    if (theme !== 'dark' && theme !== 'light') return
    if (windowPrefs.theme === theme) return
    windowPrefs.theme = theme
    saveWindowPrefs()
  })

  // De renderer meldt of er nog niet-opgeslagen bewerkingen zijn; op basis
  // daarvan vraagt het venster bij afsluiten om bevestiging.
  ipcMain.on('window:closeGuard', (evt, dirty: boolean) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return
    if (dirty) closeGuards.set(win.id, true)
    else closeGuards.delete(win.id)
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
          name: 'PDF-, Office- en afbeeldingsbestanden',
          extensions: [
            'pdf',
            'docx',
            'doc',
            'odt',
            'rtf',
            'xlsx',
            'xls',
            'ods',
            'csv',
            'pptx',
            'ppt',
            'odp',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'gif',
            'bmp'
          ]
        },
        { name: 'PDF-bestanden', extensions: ['pdf'] },
        { name: 'Afbeeldingen', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
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
    const existing: { path: string; name: string; openedAt?: number }[] = []
    for (const entry of list) {
      try {
        await stat(entry.path)
        existing.push({ path: entry.path, name: entry.name, openedAt: entry.openedAt })
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

  // ---- Documentsjablonen: index.json + {id}.docx in de bibliotheekmap ----
  // Standaard userData/templates; de beheerder kan een (gedeelde netwerk-)map
  // kiezen — die keuze staat in userData/templates-config.json.
  const templatesConfigPath = (): string => join(app.getPath('userData'), 'templates-config.json')
  const defaultTemplatesDir = (): string => join(app.getPath('userData'), 'templates')

  async function templatesDirAsync(): Promise<string> {
    try {
      const cfg = JSON.parse(await readFile(templatesConfigPath(), 'utf-8')) as { dir?: string }
      if (cfg.dir) return cfg.dir
    } catch {
      /* geen config → standaardmap */
    }
    return defaultTemplatesDir()
  }

  const templatesIndexPathIn = (dir: string): string => join(dir, 'index.json')

  ipcMain.handle('templates:getDir', async () => {
    const dir = await templatesDirAsync()
    return { dir, isDefault: dir === defaultTemplatesDir() }
  })

  ipcMain.handle('templates:chooseDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Kies de map voor de sjablonenbibliotheek',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false }
    const newDir = result.filePaths[0]
    const oldDir = await templatesDirAsync()
    try {
      await mkdir(newDir, { recursive: true })
      // Bestaande bibliotheek meenemen wanneer de nieuwe map nog leeg is.
      const targetHasIndex = await readFile(templatesIndexPathIn(newDir), 'utf-8').then(() => true).catch(() => false)
      if (!targetHasIndex && oldDir !== newDir) {
        const names = await readdir(oldDir).catch(() => [] as string[])
        for (const name of names) {
          if (name === 'index.json' || name.endsWith('.docx') || name.endsWith('.json')) {
            const data = await readFile(join(oldDir, name)).catch(() => null)
            if (data) await writeFile(join(newDir, name), data)
          }
        }
      }
      await writeFile(templatesConfigPath(), JSON.stringify({ dir: newDir }), 'utf-8')
      return { ok: true, dir: newDir }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  // Kleine JSON-bijlagen in de bibliotheekmap (pakketten, kantoorgegevens) —
  // zo deelt het hele kantoor dezelfde gegevens via de gedeelde map.
  ipcMain.handle('templates:readAux', async (_evt, name: string) => {
    if (!/^[\w-]+\.json$/.test(name)) return null
    try {
      return await readFile(join(await templatesDirAsync(), name), 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('templates:writeAux', async (_evt, name: string, json: string) => {
    if (!/^[\w-]+\.json$/.test(name)) return { ok: false }
    try {
      const dir = await templatesDirAsync()
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, name), json, 'utf-8')
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // De lijst wordt bij elke aanroep vers van schijf gelezen — nieuwe sjablonen
  // die een collega in de gedeelde map zette verschijnen dus automatisch.
  ipcMain.handle('templates:list', async () => {
    try {
      return JSON.parse(await readFile(templatesIndexPathIn(await templatesDirAsync()), 'utf-8'))
    } catch {
      return []
    }
  })

  ipcMain.handle('templates:save', async (_evt, metaJson: string, docx: Uint8Array | null) => {
    try {
      const dir = await templatesDirAsync()
      await mkdir(dir, { recursive: true })
      const meta = JSON.parse(metaJson) as { id: string }
      let list: { id: string }[] = []
      try {
        list = JSON.parse(await readFile(templatesIndexPathIn(dir), 'utf-8'))
      } catch {
        /* nog geen index */
      }
      const idx = list.findIndex((t) => t.id === meta.id)
      if (idx >= 0) list[idx] = meta
      else list.push(meta)
      await writeFile(templatesIndexPathIn(dir), JSON.stringify(list, null, 1), 'utf-8')
      if (docx) await writeFile(join(dir, `${meta.id}.docx`), Buffer.from(docx))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('templates:delete', async (_evt, id: string) => {
    try {
      const dir = await templatesDirAsync()
      let list: { id: string }[] = []
      try {
        list = JSON.parse(await readFile(templatesIndexPathIn(dir), 'utf-8'))
      } catch {
        /* geen index */
      }
      await writeFile(templatesIndexPathIn(dir), JSON.stringify(list.filter((t) => t.id !== id), null, 1), 'utf-8')
      await unlink(join(dir, `${id}.docx`)).catch(() => undefined)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('templates:loadDocx', async (_evt, id: string) => {
    try {
      return await readFile(join(await templatesDirAsync(), `${id}.docx`))
    } catch {
      return null
    }
  })

  // ---- Ondertekendossiers: dossiers.json + {id}.{orig|signed}.pdf ----
  // Alles in een 'signing'-submap van de sjablonenbibliotheek, zodat het hele
  // kantoor hetzelfde ondertekendashboard deelt (net als de sjablonen).
  const signingSubdirAsync = async (): Promise<string> => join(await templatesDirAsync(), 'signing')
  const signingIndexPathAsync = async (): Promise<string> => join(await signingSubdirAsync(), 'dossiers.json')

  ipcMain.handle('signing:list', async () => {
    try {
      return JSON.parse(await readFile(await signingIndexPathAsync(), 'utf-8'))
    } catch {
      return []
    }
  })

  ipcMain.handle('signing:saveDossier', async (_evt, metaJson: string) => {
    try {
      const dir = await signingSubdirAsync()
      await mkdir(dir, { recursive: true })
      const meta = JSON.parse(metaJson) as { id: string }
      let list: { id: string }[] = []
      try {
        list = JSON.parse(await readFile(await signingIndexPathAsync(), 'utf-8'))
      } catch {
        /* nog geen index */
      }
      const idx = list.findIndex((d) => d.id === meta.id)
      if (idx >= 0) list[idx] = meta
      else list.unshift(meta)
      await writeFile(await signingIndexPathAsync(), JSON.stringify(list, null, 1), 'utf-8')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('signing:deleteDossier', async (_evt, id: string) => {
    try {
      let list: { id: string }[] = []
      try {
        list = JSON.parse(await readFile(await signingIndexPathAsync(), 'utf-8'))
      } catch {
        /* geen index */
      }
      await writeFile(await signingIndexPathAsync(), JSON.stringify(list.filter((d) => d.id !== id), null, 1), 'utf-8')
      const dir = await signingSubdirAsync()
      await unlink(join(dir, `${id}.orig.pdf`)).catch(() => undefined)
      await unlink(join(dir, `${id}.signed.pdf`)).catch(() => undefined)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('signing:saveDoc', async (_evt, id: string, kind: string, data: Uint8Array) => {
    if (kind !== 'orig' && kind !== 'signed') return { ok: false }
    try {
      const dir = await signingSubdirAsync()
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${id}.${kind}.pdf`), Buffer.from(data))
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('signing:loadDoc', async (_evt, id: string, kind: string) => {
    if (kind !== 'orig' && kind !== 'signed') return null
    try {
      return await readFile(join(await signingSubdirAsync(), `${id}.${kind}.pdf`))
    } catch {
      return null
    }
  })

  // Certificaatbeheer + PAdES-ondertekening (lazy import: node-forge/@signpdf
  // laden pas wanneer er echt ondertekend wordt).
  ipcMain.handle('signing:certStatus', async () => (await import('./signing')).certStatus())
  ipcMain.handle('signing:createSelfCert', async (_evt, name: string, org?: string) =>
    (await import('./signing')).createSelfCert(name, org)
  )
  ipcMain.handle('signing:importP12', async (_evt, data: Uint8Array, passphrase: string) =>
    (await import('./signing')).importP12(data, passphrase)
  )
  ipcMain.handle('signing:signPades', async (_evt, data: Uint8Array, opts: unknown) =>
    (await import('./signing')).signPades(data, (opts as Record<string, string>) ?? {})
  )

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
  // Optioneel worden ontvanger, onderwerp en tekst vooraf ingevuld (gebruikt
  // door het ondertekendashboard voor verzendingen en herinneringen).
  // Zonder Outlook valt het terug op de Verkenner met het bestand geselecteerd.
  ipcMain.handle(
    'mail:pdf',
    async (_evt, name: string, data: Uint8Array, opts?: { to?: string; subject?: string; body?: string }) => {
      const dir = await mkdtemp(join(tmpdir(), 'pdfstudio-mail-'))
      const file = join(dir, name.replace(/[\\/:*?"<>|]/g, '_'))
      await writeFile(file, Buffer.from(data))
      if (process.platform === 'win32') {
        try {
          const esc = (s: string): string => s.replace(/'/g, "''")
          const lines = [
            `$ol = New-Object -ComObject Outlook.Application`,
            `$m = $ol.CreateItem(0)`,
            `$m.Attachments.Add('${file.replace(/'/g, "''")}') | Out-Null`
          ]
          if (opts?.to) lines.push(`$m.To = '${esc(opts.to)}'`)
          if (opts?.subject) lines.push(`$m.Subject = '${esc(opts.subject)}'`)
          if (opts?.body) {
            const html = esc(opts.body.replace(/\r?\n/g, '<br>'))
            lines.push(`$m.HTMLBody = '${html}' + $m.HTMLBody`)
          }
          lines.push(`$m.Display()`)
          await new Promise<void>((resolve, reject) => {
            execFile('powershell.exe', ['-NoProfile', '-Command', lines.join('; ')], (err) =>
              err ? reject(err) : resolve()
            )
          })
          return { ok: true }
        } catch {
          // Outlook niet beschikbaar — val terug op de Verkenner.
        }
      }
      shell.showItemInFolder(file)
      return { ok: true, fallback: true }
    }
  )

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
