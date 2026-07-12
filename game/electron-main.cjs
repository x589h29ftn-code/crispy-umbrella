// Electron-hoofdprocess: draait Blokkenwereld als Windows-desktopapplicatie.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

// één instantie
if (!app.requestSingleInstanceLock()) { app.quit(); }

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0b0e14',
    title: 'Blokkenwereld',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // spel blijft draaien
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // externe links in de standaardbrowser openen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // F11 = volledig scherm, Esc laat pointer lock los (spel regelt de rest)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });
}

// ---- bestand-opslag & screenshots via IPC ----
ipcMain.handle('save-world', async (evt, defaultName, content) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const res = await dialog.showSaveDialog(win, {
    title: 'Wereld opslaan',
    defaultPath: path.join(app.getPath('documents'), defaultName || 'wereld.bw'),
    filters: [{ name: 'Blokkenwereld', extensions: ['bw'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false };
  try { fs.writeFileSync(res.filePath, content, 'utf8'); return { ok: true, path: res.filePath }; }
  catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('open-world', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Wereld laden',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Blokkenwereld', extensions: ['bw', 'json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  try {
    const content = fs.readFileSync(res.filePaths[0], 'utf8');
    return { ok: true, content, name: path.basename(res.filePaths[0]) };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('save-screenshot', async (evt, defaultName, dataUrl) => {
  const dir = app.getPath('pictures');
  const file = path.join(dir, defaultName || ('Blokkenwereld-' + Date.now() + '.png'));
  try {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { ok: true, path: file };
  } catch (e) { return { ok: false, error: String(e) }; }
});

app.whenReady().then(() => {
  createWindow();
  // scherm niet laten slapen tijdens het spelen (rustig spel dat je laat staan)
  try { powerSaveBlocker.start('prevent-display-sleep'); } catch (e) {}
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
