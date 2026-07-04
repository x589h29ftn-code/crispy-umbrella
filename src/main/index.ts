import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const filesToOpen = process.argv.filter((a) => a.toLowerCase().endsWith('.pdf'))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (filesToOpen.length) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const files = await Promise.all(
        filesToOpen.map(async (p) => ({ name: p.split(/[\\/]/).pop() || p, data: await readFile(p) }))
      )
      mainWindow.webContents.send('files:opened', files)
    })
  }
}

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
    return Promise.all(
      result.filePaths.map(async (p) => ({
        name: p.split(/[\\/]/).pop() || p,
        data: await readFile(p)
      }))
    )
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
