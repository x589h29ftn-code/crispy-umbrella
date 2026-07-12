// Preload: veilige brug tussen het spel (renderer) en het Windows-systeem.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // wereld naar een .bw-bestand schrijven (native opslaan-dialoog)
  saveWorld: (defaultName, content) => ipcRenderer.invoke('save-world', defaultName, content),
  // een .bw-bestand kiezen en inlezen
  openWorld: () => ipcRenderer.invoke('open-world'),
  // screenshot (PNG data-URL) naar de Afbeeldingen-map
  saveScreenshot: (defaultName, dataUrl) => ipcRenderer.invoke('save-screenshot', defaultName, dataUrl),
});
