import { contextBridge, ipcRenderer } from 'electron'

const gameAPI = {
  quit: (): void => {
    void ipcRenderer.invoke('game:quit')
  },
  toggleFullscreen: (): void => {
    void ipcRenderer.invoke('game:toggleFullscreen')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('gameAPI', gameAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.gameAPI = gameAPI
}
