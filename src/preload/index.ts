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

export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  confidence: number
}

export interface OcrPageResult {
  text: string
  words: OcrWord[]
}

export interface ConvertResult {
  ok: boolean
  data?: Uint8Array
  error?: string
}

const api = {
  openPdfs: (): Promise<LoadedFile[]> => ipcRenderer.invoke('dialog:openPdfs'),
  ocrRecognize: (png: Uint8Array): Promise<OcrPageResult> => ipcRenderer.invoke('ocr:recognize', png),
  convertOffice: (name: string, data: Uint8Array): Promise<ConvertResult> =>
    ipcRenderer.invoke('office:convert', name, data),
  printHtml: (html: string): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('print:html', html),
  savePdf: (defaultName: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('dialog:savePdf', defaultName, data),
  saveZip: (defaultName: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('dialog:saveZip', defaultName, data),
  onFilesOpened: (callback: (files: LoadedFile[]) => void): (() => void) => {
    const listener = (_evt: unknown, files: LoadedFile[]): void => callback(files)
    ipcRenderer.on('files:opened', listener)
    return () => ipcRenderer.removeListener('files:opened', listener)
  },
  getRecentFiles: (): Promise<{ path: string; name: string }[]> => ipcRenderer.invoke('recent:list'),
  openRecentFile: (path: string): Promise<(LoadedFile & { error?: undefined }) | { error: string }> =>
    ipcRenderer.invoke('recent:open', path),
  sessionLoad: (): Promise<{
    state: unknown
    sources: { id: string; name: string; pageCount: number; data: Uint8Array }[]
  }> => ipcRenderer.invoke('session:load'),
  sessionSave: (stateJson: string): Promise<{ missing: string[] }> => ipcRenderer.invoke('session:save', stateJson),
  sessionSaveSources: (sources: { id: string; data: Uint8Array }[]): Promise<boolean> =>
    ipcRenderer.invoke('session:saveSources', sources),
  sessionClear: (): Promise<boolean> => ipcRenderer.invoke('session:clear')
}

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}

export type Api = typeof api
