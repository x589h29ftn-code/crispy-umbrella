import { app, BrowserWindow, ipcMain } from 'electron'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * Automatische updates via de GitHub-releases van dit project: op de
 * achtergrond downloaden, melding in de app, en installeren bij herstart.
 * Werkt alleen in de geïnstalleerde (nsis) app — de portable exe en de
 * dev-omgeving slaan dit stilletjes over.
 */
export function initAutoUpdater(): void {
  ipcMain.handle('app:version', () => app.getVersion())

  if (!app.isPackaged) return
  void (async () => {
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true

      const broadcast = (payload: { type: string; version?: string }): void => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('update:event', payload)
        }
      }
      autoUpdater.on('update-available', (info) => broadcast({ type: 'available', version: info.version }))
      autoUpdater.on('update-downloaded', (info) => broadcast({ type: 'downloaded', version: info.version }))
      autoUpdater.on('error', () => {
        // Geen netwerk, portable build, of release zonder feed — geen drama.
      })

      ipcMain.handle('update:install', () => {
        autoUpdater.quitAndInstall()
      })

      await autoUpdater.checkForUpdates().catch(() => undefined)
      setInterval(() => {
        void autoUpdater.checkForUpdates().catch(() => undefined)
      }, CHECK_INTERVAL_MS)
    } catch {
      // electron-updater niet beschikbaar — app werkt gewoon zonder updates.
    }
  })()
}
