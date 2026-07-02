import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { decryptPdfBuffer, encryptPdfBuffer } from './pdfEncrypt'
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

  ipcMain.handle('dialog:openPdfs', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF-bestanden', extensions: ['pdf'] }]
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

  ipcMain.handle('dialog:saveZip', async (_evt, defaultName: string, data: Uint8Array) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'ZIP-archief', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data))
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle('pdf:encrypt', async (_evt, data: Uint8Array, password: string) => {
    return encryptPdfBuffer(data, password)
  })

  ipcMain.handle('pdf:decrypt', async (_evt, data: Uint8Array, password: string) => {
    return decryptPdfBuffer(data, password)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
