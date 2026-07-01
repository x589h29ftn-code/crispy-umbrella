import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface LoadedFile {
  name: string
  data: Uint8Array
}

export interface SaveResult {
  saved: boolean
  path?: string
}

const api = {
  openPdfs: (): Promise<LoadedFile[]> => ipcRenderer.invoke('dialog:openPdfs'),
  savePdf: (defaultName: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('dialog:savePdf', defaultName, data),
  saveZip: (defaultName: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('dialog:saveZip', defaultName, data),
  encryptPdf: (data: Uint8Array, password: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdf:encrypt', data, password),
  onFilesOpened: (callback: (files: LoadedFile[]) => void): (() => void) => {
    const listener = (_evt: unknown, files: LoadedFile[]): void => callback(files)
    ipcRenderer.on('files:opened', listener)
    return () => ipcRenderer.removeListener('files:opened', listener)
  }
}

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}

export type Api = typeof api
