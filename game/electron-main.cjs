// Electron-hoofdprocess: draait Blokkenwereld als Windows-desktopapplicatie.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

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

app.whenReady().then(() => {
  createWindow();
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
