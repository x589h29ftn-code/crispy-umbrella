import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface LoadedFile {
  name: string
  data: Uint8Array
  /** Absoluut pad op schijf (afwezig bij bv. de web-versie). */
  path?: string
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
  savePdfToPath: (path: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('dialog:savePdfToPath', path, data),
  saveToOneDrive: (defaultName: string, data: Uint8Array): Promise<SaveResult & { reason?: string }> =>
    ipcRenderer.invoke('onedrive:savePdf', defaultName, data),
  openPath: (path: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('shell:openPath', path),
  mailPdf: (
    name: string,
    data: Uint8Array,
    opts?: { to?: string; subject?: string; body?: string }
  ): Promise<{ ok: boolean; fallback?: boolean }> => ipcRenderer.invoke('mail:pdf', name, data, opts),
  openDocumentWindow: (payload: unknown): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('window:openDocument', payload),
  consumeHandoff: (id: string): Promise<unknown> => ipcRenderer.invoke('window:consumeHandoff', id),
  saveZip: (defaultName: string, data: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('dialog:saveZip', defaultName, data),
  saveFile: (defaultName: string, data: Uint8Array, extension: string): Promise<SaveResult> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, data, extension),
  templatesList: (): Promise<unknown[]> => ipcRenderer.invoke('templates:list'),
  templatesGetDir: (): Promise<{ dir: string; isDefault: boolean }> => ipcRenderer.invoke('templates:getDir'),
  templatesChooseDir: (): Promise<{ ok: boolean; dir?: string; error?: string }> =>
    ipcRenderer.invoke('templates:chooseDir'),
  templatesReadAux: (name: string): Promise<string | null> => ipcRenderer.invoke('templates:readAux', name),
  templatesWriteAux: (name: string, json: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('templates:writeAux', name, json),
  templatesSave: (metaJson: string, docx: Uint8Array | null): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('templates:save', metaJson, docx),
  templatesDelete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('templates:delete', id),
  templatesLoadDocx: (id: string): Promise<Uint8Array | null> => ipcRenderer.invoke('templates:loadDocx', id),
  signingList: (): Promise<unknown[]> => ipcRenderer.invoke('signing:list'),
  signingSaveDossier: (metaJson: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('signing:saveDossier', metaJson),
  signingDeleteDossier: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('signing:deleteDossier', id),
  signingSaveDoc: (id: string, kind: 'orig' | 'signed', data: Uint8Array): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('signing:saveDoc', id, kind, data),
  signingLoadDoc: (id: string, kind: 'orig' | 'signed'): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('signing:loadDoc', id, kind),
  signingCertStatus: (): Promise<{ exists: boolean; subject?: string; validTo?: number; isSelfSigned?: boolean }> =>
    ipcRenderer.invoke('signing:certStatus'),
  signingCreateSelfCert: (
    name: string,
    org?: string
  ): Promise<{ ok: boolean; subject?: string; validTo?: number; error?: string }> =>
    ipcRenderer.invoke('signing:createSelfCert', name, org),
  signingImportP12: (
    data: Uint8Array,
    passphrase: string
  ): Promise<{ ok: boolean; subject?: string; validTo?: number; error?: string }> =>
    ipcRenderer.invoke('signing:importP12', data, passphrase),
  signingSignPades: (
    data: Uint8Array,
    opts: { reason?: string; name?: string; location?: string; contactInfo?: string }
  ): Promise<{ ok: boolean; data?: Uint8Array; error?: string }> =>
    ipcRenderer.invoke('signing:signPades', data, opts),
  onFilesOpened: (callback: (files: LoadedFile[]) => void): (() => void) => {
    const listener = (_evt: unknown, files: LoadedFile[]): void => callback(files)
    ipcRenderer.on('files:opened', listener)
    return () => ipcRenderer.removeListener('files:opened', listener)
  },
  getRecentFiles: (): Promise<{ path: string; name: string; openedAt?: number }[]> =>
    ipcRenderer.invoke('recent:list'),
  openRecentFile: (path: string): Promise<(LoadedFile & { error?: undefined }) | { error: string }> =>
    ipcRenderer.invoke('recent:open', path),
  sessionLoad: (): Promise<{
    state: unknown
    sources: { id: string; name: string; pageCount: number; data: Uint8Array }[]
  }> => ipcRenderer.invoke('session:load'),
  sessionSave: (stateJson: string): Promise<{ missing: string[] }> => ipcRenderer.invoke('session:save', stateJson),
  sessionSaveSources: (sources: { id: string; data: Uint8Array }[]): Promise<boolean> =>
    ipcRenderer.invoke('session:saveSources', sources),
  sessionClear: (): Promise<boolean> => ipcRenderer.invoke('session:clear'),
  remarkableStatus: (): Promise<{ paired: boolean }> => ipcRenderer.invoke('remarkable:status'),
  remarkablePair: (code: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('remarkable:pair', code),
  remarkableUnpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('remarkable:unpair'),
  remarkableUpload: (name: string, data: Uint8Array): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('remarkable:upload', name, data),
  /** Meldt het gekozen thema zodat een volgend venster meteen goed opent. */
  setWindowTheme: (theme: 'dark' | 'light'): void => ipcRenderer.send('prefs:theme', theme),
  /**
   * Meldt of er niet-opgeslagen bewerkingen zijn. Staat dit aan, dan vraagt het
   * venster bij afsluiten eerst om bevestiging.
   */
  setCloseGuard: (dirty: boolean): void => ipcRenderer.send('window:closeGuard', dirty),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (callback: (event: { type: string; version?: string }) => void): (() => void) => {
    const listener = (_evt: unknown, payload: { type: string; version?: string }): void => callback(payload)
    ipcRenderer.on('update:event', listener)
    return () => ipcRenderer.removeListener('update:event', listener)
  }
}

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}

export type Api = typeof api
