import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { ExportPermissions } from './lib/pdfEngine'
import type { NumberFormatChoice } from './lib/numberFormat'
import { isImageFileName, type ImagePageMode } from './lib/imageToPdf'
import type { Annotation, DocGroup, PageComment, PageRef, SignatureAsset, SignaturePlacement, SourceFile, Watermark } from './types'

export interface LightboxState {
  open: boolean
  pageId: string | null
}

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  message: string
  /** Optionele actieknop, bv. "Open Excel-bestand". */
  action?: { label: string; run: () => void }
}

export interface PasswordRequest {
  fileName: string
  attempt: number
}

/** Een verwijderde pagina die in de prullenbak wacht om teruggehaald te worden. */
export interface TrashedPage {
  id: string
  page: PageRef
  groupId: string
  groupName: string
}

/** Tabbladen van het "Slim"-venster; ook gebruikt om het op een tab te openen. */
export type SmartTab =
  | 'rename'
  | 'blank'
  | 'cleanup'
  | 'data'
  | 'split'
  | 'sort'
  | 'text'
  | 'table'
  | 'compress'
  | 'markdown'
  | 'portfolio'
  | 'watermark'

export type DropTarget =
  | { type: 'slot'; groupId: string; index: number; edge: 'before' | 'after' }
  | { type: 'canvas' }

const BLANK_SOURCE_ID = 'blank-page-source'
const HISTORY_LIMIT = 50

const OFFICE_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp']

/** PDF plus alle Office- en afbeeldingsformaten die we naar PDF kunnen omzetten. */
export function isImportableFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'pdf' || OFFICE_EXTENSIONS.includes(ext) || isImageFileName(name)
}

/**
 * Word/Excel/PowerPoint-bestanden worden eerst (in het main-proces) naar PDF
 * omgezet; afbeeldingen (foto van een bon, schermafdruk, gescande verklaring)
 * worden in de app zelf tot één PDF gemaakt — elke afbeelding een pagina.
 */
async function prepareImportFiles(
  files: { name: string; data: Uint8Array; path?: string }[],
  addToast: StudioState['addToast'],
  imagePageMode: ImagePageMode
): Promise<{ name: string; data: Uint8Array; path?: string }[]> {
  const prepared: { name: string; data: Uint8Array; path?: string }[] = []
  const images = files.filter((f) => isImageFileName(f.name))
  if (images.length) {
    try {
      const { imagesToPdf } = await import('./lib/imageToPdf')
      const data = await imagesToPdf(images, imagePageMode)
      const name =
        images.length === 1 ? `${images[0].name.replace(/\.[^.]+$/, '')}.pdf` : `Afbeeldingen (${images.length}).pdf`
      prepared.push({ name, data })
      if (images.length > 1) {
        addToast('info', `${images.length} afbeeldingen samengevoegd tot één PDF ("${name}")`)
      }
    } catch {
      addToast('error', images.length === 1 ? 'Kon de afbeelding niet omzetten naar PDF' : 'Kon de afbeeldingen niet omzetten naar PDF')
    }
  }
  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (isImageFileName(file.name)) continue // hierboven al samengevoegd
    if (!OFFICE_EXTENSIONS.includes(ext)) {
      prepared.push(file)
      continue
    }
    if (typeof window.api.convertOffice !== 'function') {
      addToast('error', `"${file.name}" overgeslagen — Office-conversie werkt alleen in de desktop-app`)
      continue
    }
    addToast('info', `"${file.name}" wordt omgezet naar PDF…`)
    const result = await window.api.convertOffice(file.name, file.data)
    if (!result.ok || !result.data) {
      addToast('error', result.error ?? `Kon "${file.name}" niet omzetten naar PDF`)
      continue
    }
    prepared.push({ name: file.name.replace(/\.[^.]+$/, '.pdf'), data: result.data })
  }
  return prepared
}

export type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'pdf-studio-theme'
const AUTHOR_STORAGE_KEY = 'pdf-studio-author'
const READER_VIEW_STORAGE_KEY = 'pdf-studio-reader-view'
const NIGHT_MODE_STORAGE_KEY = 'pdf-studio-night-mode'
const FLATTEN_STORAGE_KEY = 'pdf-studio-flatten-forms'
const CLEAN_META_STORAGE_KEY = 'pdf-studio-clean-metadata'
const TOOLBAR_HIDDEN_STORAGE_KEY = 'pdf-studio-toolbar-hidden'
const RESTORE_SESSION_STORAGE_KEY = 'pdf-studio-restore-session'
const FULL_TOOLBAR_STORAGE_KEY = 'pdf-studio-full-toolbar'
const NUMBER_FORMAT_STORAGE_KEY = 'pdf-studio-number-format'
const IMAGE_PAGE_MODE_STORAGE_KEY = 'pdf-studio-image-page-mode'
const RAIL_WIDTH_STORAGE_KEY = 'pdf-studio-rail-width'
const RAIL_COLLAPSED_STORAGE_KEY = 'pdf-studio-rail-collapsed'
const TOOLS_COLLAPSED_STORAGE_KEY = 'pdf-studio-tools-collapsed'

/** Afbeeldingen komen standaard netjes op een A4-pagina te staan. */
function getInitialImagePageMode(): ImagePageMode {
  return window.localStorage.getItem(IMAGE_PAGE_MODE_STORAGE_KEY) === 'fit' ? 'fit' : 'a4'
}

function getInitialReaderView(): 'scroll' | 'spread' | 'single' {
  const v = window.localStorage.getItem(READER_VIEW_STORAGE_KEY)
  return v === 'spread' || v === 'single' || v === 'scroll' ? v : 'scroll'
}

function getInitialTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

interface StudioState {
  sources: Map<string, SourceFile>
  groups: DocGroup[]
  activeGroupId: string | null
  zoom: number
  lightbox: LightboxState
  isImporting: boolean
  /** Voortgang tijdens het openen van bestanden (null = niets bezig). */
  importProgress: { done: number; total: number } | null
  dragPageIds: string[] | null
  dragGroupId: string | null
  signatureAssets: SignatureAsset[]
  activeSignatureId: string | null
  theme: Theme
  past: DocGroup[][]
  future: DocGroup[][]
  selectedPageIds: Set<string>
  lastSelectedPageId: string | null
  toasts: Toast[]
  passwordRequest: PasswordRequest | null
  busyExport: 'pdf' | 'zip' | null
  exportPassword: string
  canvasScale: number
  dropTarget: DropTarget | null
  groupDropIndex: number | null
  searchOpen: boolean
  /** Documents opened as editor tabs (group ids). */
  editorTabs: string[]
  /** Active tab; null = the Overzicht (canvas) tab. */
  activeEditorTab: string | null
  editorViewMode: 'scroll' | 'spread' | 'single'
  /** Actieve zoekterm-markering op een pagina (na klik op een zoekresultaat). */
  searchHighlight: { pageId: string; query: string } | null
  /** Naam die bij nieuwe opmerkingen en in de PDF-export wordt gezet. */
  authorName: string
  /** Ingevulde formulierwaarden per bron-PDF (sourceId → veldnaam → waarde). */
  formValues: Record<string, Record<string, string | boolean>>
  /** Formulieren platslaan bij export (velden worden vaste inhoud). */
  flattenForms: boolean
  /** Metadata opschonen bij export (auteur/maker/producer/XMP weg). */
  cleanMetadata: boolean
  /**
   * Vorige sessie terugzetten bij het opstarten. Standaard uit: de app begint
   * leeg, zowel in het leestabblad als in het overzicht (samenvoegen/splitsen).
   */
  restoreLastSession: boolean
  /**
   * Volledige werkbalk: alle acties in de zijbalk (zoals vóór de opschoning).
   * Standaard uit — de zijbalk toont dan de kernacties en de rest staat in het Menu.
   */
  fullToolbar: boolean
  /** Getalopmaak bij export naar Word en Excel (zoals in de PDF / 0 / 2 decimalen). */
  numberFormat: NumberFormatChoice
  /** Hoe een toegevoegde afbeelding een PDF-pagina wordt (A4 of op maat). */
  imagePageMode: ImagePageMode
  /** Zoom van het leestabblad (1 = passend), zodat de werkbalk hem ook kan bedienen. */
  editorZoom: number
  /** Breedte van de miniaturenstrook in het leestabblad (px). */
  railWidth: number
  /** Miniaturenstrook ingeklapt. */
  railCollapsed: boolean
  /** Gereedschapspaneel rechts ingeklapt. */
  toolsCollapsed: boolean

  setFormValue: (sourceId: string, fieldName: string, value: string | boolean) => void
  setFlattenForms: (flatten: boolean) => void
  setCleanMetadata: (clean: boolean) => void
  setRestoreLastSession: (on: boolean) => void
  setFullToolbar: (on: boolean) => void
  setNumberFormat: (choice: NumberFormatChoice) => void
  setImagePageMode: (mode: ImagePageMode) => void
  setEditorZoom: (zoom: number | ((z: number) => number)) => void
  setRailWidth: (width: number) => void
  setRailCollapsed: (collapsed: boolean) => void
  setToolsCollapsed: (collapsed: boolean) => void
  setAuthorName: (name: string) => void
  /** Herstelt een vorige sessie (alleen wanneer er nog niets geopend is). */
  restoreSession: (payload: {
    sources: SourceFile[]
    groups: DocGroup[]
    signatureAssets: SignatureAsset[]
    formValues: Record<string, Record<string, string | boolean>>
    flattenForms: boolean
  }) => boolean
  setSearchHighlight: (value: { pageId: string; query: string } | null) => void
  openEditorTab: (groupId: string) => void
  closeEditorTab: (groupId: string) => void
  /** Tabblad naar een andere plek in de tabbalk slepen. */
  moveEditorTab: (groupId: string, targetIndex: number) => void
  setActiveEditorTab: (groupId: string | null) => void
  setEditorViewMode: (mode: 'scroll' | 'spread' | 'single') => void
  setSearchOpen: (open: boolean) => void
  toggleTheme: () => void
  markHistory: () => void
  undo: () => void
  redo: () => void
  toggleSelectPage: (pageId: string) => void
  rangeSelectPage: (pageId: string) => void
  /** Selecteert alle pagina's van het actieve document (Ctrl+A); nogmaals = alles in alle documenten. */
  selectAllPages: () => void
  clearSelection: () => void
  addToast: (kind: Toast['kind'], message: string, action?: Toast['action']) => void
  dismissToast: (id: string) => void
  submitPassword: (password: string | null) => void
  setBusyExport: (busy: 'pdf' | 'zip' | null) => void
  setExportPassword: (password: string) => void
  setCanvasScale: (scale: number) => void
  setDropTarget: (target: DropTarget | null) => void
  setGroupDropIndex: (index: number | null) => void
  setDragPageIds: (ids: string[] | null) => void
  setDragGroupId: (id: string | null) => void
  reorderGroups: (groupId: string, toIndex: number) => void
  removeGroup: (groupId: string) => void
  /** Voegt alle pagina's van het ene document achter aan het andere toe. */
  mergeGroupInto: (sourceGroupId: string, targetGroupId: string) => void
  importFiles: (files: { name: string; data: Uint8Array; path?: string }[]) => Promise<void>
  addPagesToGroup: (groupId: string, files: { name: string; data: Uint8Array; path?: string }[]) => Promise<void>
  insertBlankPage: (groupId: string) => Promise<void>
  movePages: (pageIds: string[], toGroupId: string, toIndex: number) => void
  createGroupWithPages: (pageIds: string[]) => void
  /** Splitst een document in meerdere nieuwe documenten volgens segmenten. */
  splitGroupIntoSegments: (groupId: string, segments: { name: string; pageIds: string[] }[]) => void
  /** Herordent de pagina's van een document naar de opgegeven volgorde. */
  reorderGroupPages: (groupId: string, orderedPageIds: string[]) => void
  /** Voegt meerdere annotaties in één keer toe (één undo-stap). */
  addAnnotationsBulk: (entries: { pageId: string; annotation: Annotation }[]) => void
  deletePages: (pageIds: string[]) => void
  rotatePages: (pageIds: string[], delta?: 90 | -90) => void
  duplicatePages: (pageIds: string[]) => void
  renameGroup: (groupId: string, name: string) => void
  /** Vervangt pagina's door hun opgeschoonde (afbeelding-)versie. */
  applyCleanedPages: (entries: { pageId: string; source: SourceFile }[]) => void
  setGroupWatermark: (groupId: string, watermark: Watermark | null) => void
  toggleGroupPageNumbers: (groupId: string) => void
  setGroupDocumentDate: (groupId: string, documentDate: string | null) => void
  setActiveGroup: (groupId: string) => void
  setZoom: (zoom: number | ((z: number) => number)) => void
  openLightbox: (pageId: string) => void
  closeLightbox: () => void
  stepLightbox: (direction: 1 | -1) => void
  addSignatureAsset: (asset: SignatureAsset) => void
  removeSignatureAsset: (assetId: string) => void
  setActiveSignature: (assetId: string) => void
  addSignaturePlacement: (pageId: string, placement: Omit<SignaturePlacement, 'id'>) => void
  updateSignaturePlacement: (pageId: string, placementId: string, patch: Partial<SignaturePlacement>) => void
  removeSignaturePlacement: (pageId: string, placementId: string) => void
  commentsPanelOpen: boolean
  bookmarksPanelOpen: boolean
  setBookmarksPanelOpen: (open: boolean) => void
  /** reMarkable-koppeldialoog open? */
  remarkableDialogOpen: boolean
  setRemarkableDialogOpen: (open: boolean) => void
  /** Presentatiemodus: alles verbergen behalve de pagina's. */
  presentationMode: boolean
  setPresentationMode: (on: boolean) => void
  /** Werkbalk (zijbalk) volledig verbergen voor meer documentruimte. */
  toolbarHidden: boolean
  setToolbarHidden: (hidden: boolean) => void
  /** Nachtmodus: pagina-kleuren omkeren tijdens het lezen (niet in de export). */
  readerNightMode: boolean
  setReaderNightMode: (on: boolean) => void
  /** Rechten die bij een beveiligde export worden afgedwongen. */
  exportPermissions: ExportPermissions
  setExportPermissions: (patch: Partial<ExportPermissions>) => void
  /** Vergelijk-weergave: twee documenten naast elkaar met verschillen. */
  compare: { open: boolean; leftGroupId: string | null; rightGroupId: string | null }
  openCompare: () => void
  closeCompare: () => void
  setCompareGroups: (side: 'left' | 'right', groupId: string) => void
  /** Handtekening-tekenen-dialoog. */
  drawSignatureOpen: boolean
  setDrawSignatureOpen: (open: boolean) => void
  /** Privacy-scan (AVG): gevonden gevoelige gegevens die te redigeren zijn. */
  privacyScanOpen: boolean
  setPrivacyScanOpen: (open: boolean) => void
  /** "Slimme documenten"-dialoog (hernoemen, lege pagina's, opschonen, CSV). */
  smartDialogOpen: boolean
  /** Tabblad waarop het Slim-venster opent (null = het standaardtabblad). */
  smartDialogTab: SmartTab | null
  setSmartDialogOpen: (open: boolean, tab?: SmartTab) => void
  /** Documentsjablonen: Word-sjablonen met {variabelen} invullen en genereren. */
  templatesDialogOpen: boolean
  setTemplatesDialogOpen: (open: boolean) => void
  /** Ondertekendashboard: zelf tekenen, verzenden en herinneren. */
  signingDialogOpen: boolean
  setSigningDialogOpen: (open: boolean) => void
  /** Sneltoetsen-overzicht (help). */
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  /** Voorkeuren-scherm. */
  preferencesOpen: boolean
  setPreferencesOpen: (open: boolean) => void
  /** Prullenbak: pagina's die deze sessie zijn verwijderd, om terug te halen. */
  trash: TrashedPage[]
  trashPanelOpen: boolean
  setTrashPanelOpen: (open: boolean) => void
  restoreTrashedPages: (entryIds: string[]) => void
  clearTrash: () => void
  focusCommentId: string | null
  setCommentsPanelOpen: (open: boolean) => void
  openCommentThread: (pageId: string, commentId: string) => void
  clearFocusComment: () => void
  addComment: (pageId: string, comment: PageComment) => void
  updateComment: (pageId: string, commentId: string, patch: Partial<PageComment>) => void
  addCommentReply: (pageId: string, commentId: string, text: string) => void
  removeComment: (pageId: string, commentId: string) => void
  addAnnotation: (pageId: string, annotation: Annotation) => void
  updateAnnotation: (pageId: string, annotationId: string, patch: Partial<Annotation>) => void
  removeAnnotation: (pageId: string, annotationId: string) => void
}

function findPage(groups: DocGroup[], pageId: string): { group: DocGroup; index: number } | null {
  for (const group of groups) {
    const index = group.pages.findIndex((p) => p.id === pageId)
    if (index !== -1) return { group, index }
  }
  return null
}

function nextGroupName(groups: DocGroup[], base: string): string {
  const existing = new Set(groups.map((g) => g.name))
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base} (${n})`)) n += 1
  return `${base} (${n})`
}

/** Resolver for the in-flight password dialog; module-level because it never needs to render. */
let passwordResolver: ((password: string | null) => void) | null = null

function requestPassword(fileName: string, attempt: number): Promise<string | null> {
  return new Promise((resolve) => {
    passwordResolver = resolve
    useStudioStore.setState({ passwordRequest: { fileName, attempt } })
  })
}

/**
 * Wachtwoorddialoog: er kan er maar één tegelijk open staan, terwijl bestanden
 * wél naast elkaar geladen worden. Deze poort laat de vragen netjes op elkaar
 * wachten.
 */
let passwordGate: Promise<unknown> = Promise.resolve()
function withPasswordGate<T>(run: () => Promise<T>): Promise<T> {
  const next = passwordGate.then(run, run)
  passwordGate = next.catch(() => undefined)
  return next
}

/** Voert `task` uit over alle items, met maximaal `limit` tegelijk (volgorde blijft behouden). */
async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next
        next += 1
        if (index >= items.length) return
        results[index] = await task(items[index])
      }
    })
  )
  return results
}

/** Aantal bestanden dat tegelijk door pdf.js gehaald wordt bij het importeren. */
const IMPORT_CONCURRENCY = 3

interface LoadedImport {
  file: { name: string; data: Uint8Array; path?: string }
  source: SourceFile
  comments: Map<number, PageComment[]>
}

/**
 * Laadt de gekozen bestanden (meerdere tegelijk) en houdt de voortgang bij, zodat
 * de gebruiker bij een grote stapel ziet dat er gewerkt wordt.
 */
async function loadImports(
  files: { name: string; data: Uint8Array; path?: string }[],
  addToast: StudioState['addToast'],
  setState: (partial: Partial<StudioState>) => void
): Promise<LoadedImport[]> {
  let done = 0
  setState({ importProgress: { done: 0, total: files.length } })
  const loaded = await mapLimited(files, IMPORT_CONCURRENCY, async (file) => {
    const source = await loadFileInteractive(file, addToast)
    let comments = new Map<number, PageComment[]>()
    if (source) {
      const { extractComments } = await import('./lib/commentImport')
      comments = await extractComments(source)
    }
    done += 1
    setState({ importProgress: { done, total: files.length } })
    return source ? { file, source, comments } : null
  })
  return loaded.filter((entry): entry is LoadedImport => entry !== null)
}

/**
 * pdf.js is de zwaarste bibliotheek van de app (±0,6 MB). Hij wordt pas geladen
 * zodra er echt een document binnenkomt, zodat een lege start snel is.
 */
let renderLibPromise: Promise<typeof import('./lib/pdfRender')> | null = null
function renderLib(): Promise<typeof import('./lib/pdfRender')> {
  return (renderLibPromise ??= import('./lib/pdfRender'))
}

/**
 * Loads a PDF, prompting for a password (and decrypting via the main process)
 * when the file turns out to be protected. Returns null if the user cancels
 * or the file is unreadable — a toast explains which.
 */
async function loadFileInteractive(
  file: { name: string; data: Uint8Array; path?: string },
  addToast: StudioState['addToast']
): Promise<SourceFile | null> {
  const { loadSourceFile, isPasswordError } = await renderLib()
  let data = file.data
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await loadSourceFile(file.name, data, nanoid(), file.path)
    } catch (error) {
      if (!isPasswordError(error)) {
        addToast('error', `Kon "${file.name}" niet openen — is het een geldig PDF-bestand?`)
        return null
      }
      const password = await withPasswordGate(() => requestPassword(file.name, attempt))
      if (password === null) {
        addToast('info', `"${file.name}" overgeslagen`)
        return null
      }
      try {
        const { decryptPdfBytes } = await import('./lib/pdfEngine')
        data = await decryptPdfBytes(file.data, password)
      } catch {
        // Wrong password — loop; the next dialog shows the retry state via `attempt`.
        continue
      }
    }
  }
}

export const useStudioStore = create<StudioState>((set, get) => ({
  sources: new Map(),
  groups: [],
  activeGroupId: null,
  zoom: 1,
  lightbox: { open: false, pageId: null },
  isImporting: false,
  importProgress: null,
  dragPageIds: null,
  dragGroupId: null,
  signatureAssets: [],
  activeSignatureId: null,
  theme: getInitialTheme(),
  past: [],
  future: [],
  selectedPageIds: new Set(),
  lastSelectedPageId: null,
  toasts: [],
  passwordRequest: null,
  busyExport: null,
  exportPassword: '',
  canvasScale: 1,
  dropTarget: null,
  groupDropIndex: null,
  searchOpen: false,
  editorTabs: [],
  activeEditorTab: null,
  editorViewMode: getInitialReaderView(),
  searchHighlight: null,
  authorName: window.localStorage.getItem(AUTHOR_STORAGE_KEY) ?? '',
  formValues: {},
  flattenForms: window.localStorage.getItem(FLATTEN_STORAGE_KEY) === '1',
  cleanMetadata: window.localStorage.getItem(CLEAN_META_STORAGE_KEY) === '1',
  restoreLastSession: window.localStorage.getItem(RESTORE_SESSION_STORAGE_KEY) === '1',
  fullToolbar: window.localStorage.getItem(FULL_TOOLBAR_STORAGE_KEY) === '1',
  numberFormat: ((): NumberFormatChoice => {
    const stored = window.localStorage.getItem(NUMBER_FORMAT_STORAGE_KEY)
    return stored === 'none' || stored === 'two' ? stored : 'auto'
  })(),
  imagePageMode: getInitialImagePageMode(),
  editorZoom: 1,
  railWidth: ((): number => {
    const stored = Number(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= 90 ? Math.min(420, stored) : 160
  })(),
  railCollapsed: window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === '1',
  toolsCollapsed: window.localStorage.getItem(TOOLS_COLLAPSED_STORAGE_KEY) === '1',

  setFormValue: (sourceId, fieldName, value) => {
    set((state) => ({
      formValues: {
        ...state.formValues,
        [sourceId]: { ...state.formValues[sourceId], [fieldName]: value }
      }
    }))
  },

  setFlattenForms: (flatten) => {
    window.localStorage.setItem(FLATTEN_STORAGE_KEY, flatten ? '1' : '0')
    set({ flattenForms: flatten })
  },
  setCleanMetadata: (clean) => {
    window.localStorage.setItem(CLEAN_META_STORAGE_KEY, clean ? '1' : '0')
    set({ cleanMetadata: clean })
  },
  setRestoreLastSession: (on) => {
    window.localStorage.setItem(RESTORE_SESSION_STORAGE_KEY, on ? '1' : '0')
    set({ restoreLastSession: on })
  },
  setFullToolbar: (on) => {
    window.localStorage.setItem(FULL_TOOLBAR_STORAGE_KEY, on ? '1' : '0')
    set({ fullToolbar: on })
  },
  setNumberFormat: (choice) => {
    window.localStorage.setItem(NUMBER_FORMAT_STORAGE_KEY, choice)
    set({ numberFormat: choice })
  },
  setImagePageMode: (mode) => {
    window.localStorage.setItem(IMAGE_PAGE_MODE_STORAGE_KEY, mode)
    set({ imagePageMode: mode })
  },
  setEditorZoom: (zoom) => {
    set((state) => {
      const next = typeof zoom === 'function' ? zoom(state.editorZoom) : zoom
      return { editorZoom: Math.min(5, Math.max(0.2, next)) }
    })
  },
  setRailWidth: (width) => {
    const clamped = Math.min(420, Math.max(90, Math.round(width)))
    window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(clamped))
    set({ railWidth: clamped })
  },
  setRailCollapsed: (collapsed) => {
    window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
    set({ railCollapsed: collapsed })
  },
  setToolsCollapsed: (collapsed) => {
    window.localStorage.setItem(TOOLS_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
    set({ toolsCollapsed: collapsed })
  },

  restoreSession: (payload) => {
    if (get().groups.length || !payload.groups.length) return false
    const sources = new Map(get().sources)
    payload.sources.forEach((s) => sources.set(s.id, s))
    // Alleen groepen waarvan alle bronnen aanwezig zijn (bin-bestand kan ontbreken).
    const groups = payload.groups.filter((g) => g.pages.every((p) => sources.has(p.sourceId)))
    if (!groups.length) return false
    set({
      sources,
      groups,
      signatureAssets: payload.signatureAssets,
      formValues: payload.formValues,
      flattenForms: payload.flattenForms,
      activeGroupId: groups[0]?.id ?? null,
      activeSignatureId: payload.signatureAssets[0]?.id ?? null,
      editorTabs: groups.map((g) => g.id),
      activeEditorTab: groups[0]?.id ?? null
    })
    return true
  },

  setAuthorName: (name) => {
    window.localStorage.setItem(AUTHOR_STORAGE_KEY, name)
    set({ authorName: name })
  },

  setSearchHighlight: (value) => set({ searchHighlight: value }),

  openEditorTab: (groupId) => {
    set((state) => ({
      editorTabs: state.editorTabs.includes(groupId) ? state.editorTabs : [...state.editorTabs, groupId],
      activeEditorTab: groupId
    }))
  },

  closeEditorTab: (groupId) => {
    set((state) => {
      const editorTabs = state.editorTabs.filter((id) => id !== groupId)
      const activeEditorTab =
        state.activeEditorTab === groupId
          ? (editorTabs[editorTabs.length - 1] ?? null)
          : state.activeEditorTab
      return { editorTabs, activeEditorTab }
    })
  },

  /** Sleep een tabblad naar een andere plek; het Overzicht blijft altijd vooraan. */
  moveEditorTab: (groupId, targetIndex) => {
    set((state) => {
      if (!state.editorTabs.includes(groupId)) return {}
      const rest = state.editorTabs.filter((id) => id !== groupId)
      const index = Math.max(0, Math.min(rest.length, targetIndex))
      rest.splice(index, 0, groupId)
      return { editorTabs: rest }
    })
  },

  setActiveEditorTab: (groupId) => set({ activeEditorTab: groupId }),

  setEditorViewMode: (mode) => {
    window.localStorage.setItem(READER_VIEW_STORAGE_KEY, mode)
    set({ editorViewMode: mode })
  },

  setSearchOpen: (open) => set({ searchOpen: open }),

  toggleTheme: () => {
    set((state) => {
      const theme: Theme = state.theme === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
      return { theme }
    })
  },

  markHistory: () => {
    set((state) => ({
      past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.groups],
      future: []
    }))
  },

  undo: () => {
    set((state) => {
      if (!state.past.length) return state
      const previous = state.past[state.past.length - 1]
      return {
        groups: previous,
        past: state.past.slice(0, -1),
        future: [state.groups, ...state.future],
        ...syncDerivedState(state, previous)
      }
    })
  },

  redo: () => {
    set((state) => {
      if (!state.future.length) return state
      const [next, ...rest] = state.future
      return {
        groups: next,
        past: [...state.past, state.groups],
        future: rest,
        ...syncDerivedState(state, next)
      }
    })
  },

  toggleSelectPage: (pageId) => {
    set((state) => {
      const selectedPageIds = new Set(state.selectedPageIds)
      if (selectedPageIds.has(pageId)) selectedPageIds.delete(pageId)
      else selectedPageIds.add(pageId)
      return { selectedPageIds, lastSelectedPageId: pageId }
    })
  },

  rangeSelectPage: (pageId) => {
    set((state) => {
      const target = findPage(state.groups, pageId)
      if (!target) return state
      const anchor = state.lastSelectedPageId ? findPage(state.groups, state.lastSelectedPageId) : null
      // Range selection only makes sense within one document row; otherwise treat as single select.
      if (!anchor || anchor.group.id !== target.group.id) {
        return { selectedPageIds: new Set([pageId]), lastSelectedPageId: pageId }
      }
      const [from, to] = [anchor.index, target.index].sort((a, b) => a - b)
      const selectedPageIds = new Set(state.selectedPageIds)
      for (let i = from; i <= to; i += 1) selectedPageIds.add(anchor.group.pages[i].id)
      return { selectedPageIds }
    })
  },

  selectAllPages: () => {
    const { groups, activeGroupId, selectedPageIds } = get()
    if (!groups.length) return
    const active = groups.find((g) => g.id === activeGroupId) ?? groups[0]
    const inActive = active.pages.map((p) => p.id)
    // Alles in dit document al geselecteerd? Dan pakt een tweede Ctrl+A alles.
    const allOfActive = inActive.length > 0 && inActive.every((id) => selectedPageIds.has(id))
    const target = allOfActive ? groups.flatMap((g) => g.pages.map((p) => p.id)) : inActive
    set({ selectedPageIds: new Set(target), lastSelectedPageId: target[target.length - 1] ?? null })
  },

  clearSelection: () => set({ selectedPageIds: new Set(), lastSelectedPageId: null }),

  addToast: (kind, message, action) => {
    const id = nanoid()
    set((state) => ({ toasts: [...state.toasts, { id, kind, message, action }] }))
    // Foutmeldingen blijven staan tot je ze wegklikt — anders mis je ze.
    // Meldingen met een actieknop blijven wat langer staan zodat je erop kunt klikken.
    if (kind === 'error') return
    window.setTimeout(() => get().dismissToast(id), action ? 12000 : 4500)
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  submitPassword: (password) => {
    const resolve = passwordResolver
    passwordResolver = null
    set({ passwordRequest: null })
    resolve?.(password)
  },

  setBusyExport: (busy) => set({ busyExport: busy }),
  setExportPassword: (password) => set({ exportPassword: password }),
  setCanvasScale: (scale) => set({ canvasScale: scale }),
  setDropTarget: (target) => set({ dropTarget: target }),
  setGroupDropIndex: (index) => set({ groupDropIndex: index }),
  setDragPageIds: (ids) => set({ dragPageIds: ids }),
  setDragGroupId: (id) => set({ dragGroupId: id }),

  reorderGroups: (groupId, toIndex) => {
    get().markHistory()
    set((state) => {
      const fromIndex = state.groups.findIndex((g) => g.id === groupId)
      if (fromIndex === -1) return state
      const groups = [...state.groups]
      const [moved] = groups.splice(fromIndex, 1)
      const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex
      groups.splice(Math.max(0, Math.min(insertAt, groups.length)), 0, moved)
      return { groups }
    })
  },

  mergeGroupInto: (sourceGroupId, targetGroupId) => {
    if (sourceGroupId === targetGroupId) return
    const { groups, addToast } = get()
    const source = groups.find((g) => g.id === sourceGroupId)
    const target = groups.find((g) => g.id === targetGroupId)
    if (!source || !target) return
    get().markHistory()
    set((state) => {
      const merged = state.groups
        .map((g) => (g.id === targetGroupId ? { ...g, pages: [...g.pages, ...source.pages] } : g))
        .filter((g) => g.id !== sourceGroupId)
      return { ...finalizeGroups(state, merged), ...pruneSelection(state, merged), activeGroupId: targetGroupId }
    })
    addToast(
      'success',
      `"${source.name}" toegevoegd aan "${target.name}" (${source.pages.length} ${
        source.pages.length === 1 ? 'pagina' : "pagina's"
      })`
    )
  },

  removeGroup: (groupId) => {
    get().markHistory()
    set((state) => {
      const groups = state.groups.filter((g) => g.id !== groupId)
      return { ...finalizeGroups(state, groups), ...pruneSelection(state, groups) }
    })
  },

  importFiles: async (files) => {
    if (!files.length) return
    set({ isImporting: true })
    try {
      files = await prepareImportFiles(files, get().addToast, get().imagePageMode)
      const newGroups: DocGroup[] = []
      const sources = new Map(get().sources)
      for (const { file, source, comments } of await loadImports(files, get().addToast, set)) {
        sources.set(source.id, source)
        const baseName = file.name.replace(/\.pdf$/i, '')
        newGroups.push({
          id: nanoid(),
          name: nextGroupName([...get().groups, ...newGroups], baseName),
          pages: Array.from({ length: source.pageCount }, (_, i) => ({
            id: nanoid(),
            sourceId: source.id,
            sourcePageIndex: i,
            rotation: 0,
            signatures: [],
            annotations: [],
            comments: comments.get(i) ?? []
          })),
          watermark: null,
          pageNumbers: false,
          documentDate: null
        })
      }
      if (!newGroups.length) return
      get().markHistory()
      set((state) => {
        // Reader-first: het éérste document opent direct als leestabblad.
        // Wie daarna vanuit het Overzicht bij-importeert, blijft gewoon daar.
        const firstImport = state.groups.length === 0
        return {
          sources,
          groups: [...state.groups, ...newGroups],
          activeGroupId: state.activeGroupId ?? newGroups[0]?.id ?? null,
          editorTabs: firstImport
            ? [...state.editorTabs, ...newGroups.map((g) => g.id).filter((id) => !state.editorTabs.includes(id))]
            : state.editorTabs,
          activeEditorTab: firstImport ? (newGroups[0]?.id ?? state.activeEditorTab) : state.activeEditorTab
        }
      })
    } finally {
      set({ isImporting: false, importProgress: null })
    }
  },

  addPagesToGroup: async (groupId, files) => {
    if (!files.length) return
    set({ isImporting: true })
    try {
      files = await prepareImportFiles(files, get().addToast, get().imagePageMode)
      const sources = new Map(get().sources)
      const newPages: PageRef[] = []
      for (const { source, comments } of await loadImports(files, get().addToast, set)) {
        sources.set(source.id, source)
        for (let i = 0; i < source.pageCount; i += 1) {
          newPages.push({
            id: nanoid(),
            sourceId: source.id,
            sourcePageIndex: i,
            rotation: 0,
            signatures: [],
            annotations: [],
            comments: comments.get(i) ?? []
          })
        }
      }
      if (!newPages.length) return
      get().markHistory()
      set((state) => ({
        sources,
        groups: state.groups.map((g) => (g.id === groupId ? { ...g, pages: [...g.pages, ...newPages] } : g))
      }))
    } finally {
      set({ isImporting: false, importProgress: null })
    }
  },

  insertBlankPage: async (groupId) => {
    // Every blank page is byte-identical, so all of them share one lazily-created
    // SourceFile instead of re-parsing a fresh throwaway PDF through pdf.js each time.
    let source = get().sources.get(BLANK_SOURCE_ID)
    if (!source) {
      const { createBlankPageSource } = await import('./lib/pdfEngine')
      source = await createBlankPageSource(BLANK_SOURCE_ID)
    }
    const page: PageRef = {
      id: nanoid(),
      sourceId: BLANK_SOURCE_ID,
      sourcePageIndex: 0,
      rotation: 0,
      signatures: [],
      annotations: [],
      comments: []
    }
    get().markHistory()
    set((state) => ({
      sources: new Map(state.sources).set(BLANK_SOURCE_ID, source!),
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, pages: [...g.pages, page] } : g))
    }))
  },

  movePages: (pageIds, toGroupId, toIndex) => {
    if (!pageIds.length) return
    get().markHistory()
    set((state) => {
      const idSet = new Set(pageIds)
      const moving = state.groups.flatMap((g) => g.pages).filter((p) => idSet.has(p.id))
      if (!moving.length) return state

      const target = state.groups.find((g) => g.id === toGroupId)
      if (!target) return state
      // Removing selected pages that sit before the drop position shifts it left.
      const removedBefore = target.pages.slice(0, Math.max(0, toIndex)).filter((p) => idSet.has(p.id)).length

      const groups = state.groups.map((g) => ({ ...g, pages: g.pages.filter((p) => !idSet.has(p.id)) }))
      const targetGroup = groups.find((g) => g.id === toGroupId)
      if (!targetGroup) return state
      const insertAt = Math.max(0, Math.min(toIndex - removedBefore, targetGroup.pages.length))
      targetGroup.pages.splice(insertAt, 0, ...moving)

      return { ...finalizeGroups(state, groups), ...pruneSelection(state, groups) }
    })
  },

  createGroupWithPages: (pageIds) => {
    if (!pageIds.length) return
    get().markHistory()
    set((state) => {
      const idSet = new Set(pageIds)
      const moving = state.groups.flatMap((g) => g.pages).filter((p) => idSet.has(p.id))
      if (!moving.length) return state
      const newGroup: DocGroup = {
        id: nanoid(),
        name: nextGroupName(state.groups, 'Nieuw document'),
        pages: moving,
        watermark: null,
        pageNumbers: false,
        documentDate: null
      }
      const groups = state.groups
        .map((g) => ({ ...g, pages: g.pages.filter((p) => !idSet.has(p.id)) }))
        .concat(newGroup)
      return {
        ...finalizeGroups(state, groups),
        ...pruneSelection(state, groups),
        activeGroupId: newGroup.id
      }
    })
  },

  deletePages: (pageIds) => {
    if (!pageIds.length) return
    get().markHistory()
    set((state) => {
      const idSet = new Set(pageIds)
      // Bewaar de verwijderde pagina's in de prullenbak zodat ze terug te halen zijn.
      const removed: TrashedPage[] = []
      for (const g of state.groups) {
        for (const p of g.pages) {
          if (idSet.has(p.id)) removed.push({ id: nanoid(), page: p, groupId: g.id, groupName: g.name })
        }
      }
      const groups = state.groups.map((g) => ({ ...g, pages: g.pages.filter((p) => !idSet.has(p.id)) }))
      const trash = [...removed, ...state.trash].slice(0, 200)
      return { ...finalizeGroups(state, groups), ...pruneSelection(state, groups), trash }
    })
  },

  splitGroupIntoSegments: (groupId, segments) => {
    if (segments.length < 2) return
    get().markHistory()
    set((state) => {
      const idx = state.groups.findIndex((g) => g.id === groupId)
      const source = state.groups[idx]
      if (!source) return state
      const byId = new Map(source.pages.map((p) => [p.id, p]))
      const newGroups: DocGroup[] = []
      for (const seg of segments) {
        const pages = seg.pageIds.map((id) => byId.get(id)).filter((p): p is PageRef => Boolean(p))
        if (!pages.length) continue
        newGroups.push({
          id: nanoid(),
          // Ook tegen de al gemaakte segmenten aftoetsen: twee bladwijzers met
          // dezelfde titel leverden anders twee documenten met dezelfde naam op.
          name: nextGroupName([...state.groups, ...newGroups], seg.name),
          pages,
          watermark: source.watermark,
          pageNumbers: source.pageNumbers,
          documentDate: source.documentDate
        })
      }
      if (!newGroups.length) return state
      const groups = [...state.groups.slice(0, idx), ...newGroups, ...state.groups.slice(idx + 1)]
      return { ...finalizeGroups(state, groups), ...pruneSelection(state, groups), activeGroupId: newGroups[0].id }
    })
  },

  reorderGroupPages: (groupId, orderedPageIds) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id !== groupId) return g
        const byId = new Map(g.pages.map((p) => [p.id, p]))
        const ordered = orderedPageIds.map((id) => byId.get(id)).filter((p): p is PageRef => Boolean(p))
        // Behoud pagina's die (onverwacht) niet in de nieuwe volgorde staan.
        const seen = new Set(orderedPageIds)
        const rest = g.pages.filter((p) => !seen.has(p.id))
        return { ...g, pages: [...ordered, ...rest] }
      })
    }))
  },

  addAnnotationsBulk: (entries) => {
    if (!entries.length) return
    get().markHistory()
    set((state) => {
      const byPage = new Map<string, Annotation[]>()
      for (const e of entries) {
        const list = byPage.get(e.pageId) ?? []
        list.push(e.annotation)
        byPage.set(e.pageId, list)
      }
      return {
        groups: state.groups.map((g) => ({
          ...g,
          pages: g.pages.map((p) => (byPage.has(p.id) ? { ...p, annotations: [...p.annotations, ...byPage.get(p.id)!] } : p))
        }))
      }
    })
  },

  rotatePages: (pageIds, delta = 90) => {
    if (!pageIds.length) return
    get().markHistory()
    set((state) => {
      const idSet = new Set(pageIds)
      return {
        groups: state.groups.map((g) => ({
          ...g,
          pages: g.pages.map((p) =>
            idSet.has(p.id) ? { ...p, rotation: (((p.rotation + delta + 360) % 360) as PageRef['rotation']) } : p
          )
        }))
      }
    })
  },

  duplicatePages: (pageIds) => {
    if (!pageIds.length) return
    get().markHistory()
    set((state) => {
      const idSet = new Set(pageIds)
      return {
        groups: state.groups.map((g) => ({
          ...g,
          pages: g.pages.flatMap((p) =>
            idSet.has(p.id)
              ? [
                  p,
                  {
                    ...p,
                    id: nanoid(),
                    signatures: p.signatures.map((s) => ({ ...s, id: nanoid() })),
                    annotations: p.annotations.map((a) => ({ ...a, id: nanoid() })),
                    comments: p.comments.map((c) => ({
                      ...c,
                      id: nanoid(),
                      replies: c.replies.map((r) => ({ ...r, id: nanoid() }))
                    }))
                  }
                ]
              : [p]
          )
        }))
      }
    })
  },

  renameGroup: (groupId, name) => {
    const trimmed = name.trim()
    const current = get().groups.find((g) => g.id === groupId)
    if (!current || !trimmed || trimmed === current.name) return
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g))
    }))
  },

  applyCleanedPages: (entries) => {
    if (!entries.length) return
    get().markHistory()
    set((state) => {
      const sources = new Map(state.sources)
      for (const e of entries) sources.set(e.source.id, e.source)
      const byPage = new Map(entries.map((e) => [e.pageId, e.source.id]))
      const groups = state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          byPage.has(p.id) ? { ...p, sourceId: byPage.get(p.id)!, sourcePageIndex: 0, rotation: 0 as const } : p
        )
      }))
      return { sources, groups }
    })
  },

  setGroupWatermark: (groupId, watermark) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, watermark } : g))
    }))
  },

  toggleGroupPageNumbers: (groupId) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, pageNumbers: !g.pageNumbers } : g))
    }))
  },

  setGroupDocumentDate: (groupId, documentDate) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, documentDate } : g))
    }))
  },

  setActiveGroup: (groupId) => set({ activeGroupId: groupId }),

  setZoom: (zoom) =>
    set((state) => ({
      zoom: Math.max(0.25, Math.min(3, typeof zoom === 'function' ? zoom(state.zoom) : zoom))
    })),

  openLightbox: (pageId) => set({ lightbox: { open: true, pageId } }),
  closeLightbox: () => set({ lightbox: { open: false, pageId: null } }),

  stepLightbox: (direction) => {
    const state = get()
    if (!state.lightbox.pageId) return
    const flat = state.groups.flatMap((g) => g.pages)
    const idx = flat.findIndex((p) => p.id === state.lightbox.pageId)
    if (idx === -1) return
    const nextIdx = idx + direction
    if (nextIdx < 0 || nextIdx >= flat.length) return
    set({ lightbox: { open: true, pageId: flat[nextIdx].id } })
  },

  addSignatureAsset: (asset) => {
    set((state) => ({
      signatureAssets: [...state.signatureAssets, asset],
      activeSignatureId: asset.id
    }))
  },

  removeSignatureAsset: (assetId) => {
    set((state) => {
      const signatureAssets = state.signatureAssets.filter((a) => a.id !== assetId)
      const activeSignatureId =
        state.activeSignatureId === assetId ? (signatureAssets[0]?.id ?? null) : state.activeSignatureId
      return { signatureAssets, activeSignatureId }
    })
  },

  setActiveSignature: (assetId) => set({ activeSignatureId: assetId }),

  addSignaturePlacement: (pageId, placement) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id === pageId ? { ...p, signatures: [...p.signatures, { ...placement, id: nanoid() }] } : p
        )
      }))
    }))
  },

  // No markHistory here: this fires continuously during a drag. Lightbox calls
  // markHistory() once on pointer-down so the whole gesture is a single undo step.
  updateSignaturePlacement: (pageId, placementId, patch) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId
            ? p
            : {
                ...p,
                signatures: p.signatures.map((s) => (s.id === placementId ? { ...s, ...patch } : s))
              }
        )
      }))
    }))
  },

  removeSignaturePlacement: (pageId, placementId) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId ? p : { ...p, signatures: p.signatures.filter((s) => s.id !== placementId) }
        )
      }))
    }))
  },

  commentsPanelOpen: false,
  bookmarksPanelOpen: false,
  setBookmarksPanelOpen: (open) => set({ bookmarksPanelOpen: open }),
  remarkableDialogOpen: false,
  setRemarkableDialogOpen: (open) => set({ remarkableDialogOpen: open }),
  presentationMode: false,
  setPresentationMode: (on) => set({ presentationMode: on }),
  toolbarHidden: window.localStorage.getItem(TOOLBAR_HIDDEN_STORAGE_KEY) === '1',
  setToolbarHidden: (hidden) => {
    window.localStorage.setItem(TOOLBAR_HIDDEN_STORAGE_KEY, hidden ? '1' : '0')
    set({ toolbarHidden: hidden })
  },
  readerNightMode: window.localStorage.getItem(NIGHT_MODE_STORAGE_KEY) === '1',
  setReaderNightMode: (on) => {
    window.localStorage.setItem(NIGHT_MODE_STORAGE_KEY, on ? '1' : '0')
    set({ readerNightMode: on })
  },
  exportPermissions: { printing: true, copying: true, modifying: true },
  setExportPermissions: (patch) => set((s) => ({ exportPermissions: { ...s.exportPermissions, ...patch } })),
  compare: { open: false, leftGroupId: null, rightGroupId: null },
  openCompare: () =>
    set((s) => {
      // Standaard twee verschillende documenten: hetzelfde document links en
      // rechts levert alleen een lege lijst op.
      const known = s.groups.map((g) => g.id)
      const left = known.includes(s.compare.leftGroupId ?? '') ? s.compare.leftGroupId : (s.groups[0]?.id ?? null)
      let right = known.includes(s.compare.rightGroupId ?? '') ? s.compare.rightGroupId : null
      if (!right || right === left) right = s.groups.find((g) => g.id !== left)?.id ?? left
      return { compare: { open: true, leftGroupId: left, rightGroupId: right } }
    }),
  closeCompare: () => set((s) => ({ compare: { ...s.compare, open: false } })),
  setCompareGroups: (side, groupId) =>
    set((s) => ({ compare: { ...s.compare, [side === 'left' ? 'leftGroupId' : 'rightGroupId']: groupId } })),
  drawSignatureOpen: false,
  setDrawSignatureOpen: (open) => set({ drawSignatureOpen: open }),
  privacyScanOpen: false,
  setPrivacyScanOpen: (open) => set({ privacyScanOpen: open }),
  smartDialogOpen: false,
  smartDialogTab: null,
  setSmartDialogOpen: (open, tab) => set({ smartDialogOpen: open, smartDialogTab: open ? (tab ?? null) : null }),
  templatesDialogOpen: false,
  setTemplatesDialogOpen: (open) => set({ templatesDialogOpen: open }),
  signingDialogOpen: false,
  setSigningDialogOpen: (open) => set({ signingDialogOpen: open }),
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  preferencesOpen: false,
  setPreferencesOpen: (open) => set({ preferencesOpen: open }),
  trash: [],
  trashPanelOpen: false,
  setTrashPanelOpen: (open) => set({ trashPanelOpen: open }),
  restoreTrashedPages: (entryIds) => {
    const ids = new Set(entryIds)
    const entries = get().trash.filter((t) => ids.has(t.id))
    if (!entries.length) return
    get().markHistory()
    set((state) => {
      let groups = state.groups.map((g) => ({ ...g, pages: [...g.pages] }))
      for (const entry of entries) {
        // Terug in het oorspronkelijke document als dat er nog is, anders een nieuw document.
        const target = groups.find((g) => g.id === entry.groupId)
        if (target) {
          target.pages.push(entry.page)
        } else {
          groups = [
            ...groups,
            {
              id: nanoid(),
              name: nextGroupName(groups, entry.groupName),
              pages: [entry.page],
              watermark: null,
              pageNumbers: false,
              documentDate: null
            }
          ]
        }
      }
      const trash = state.trash.filter((t) => !ids.has(t.id))
      return { ...finalizeGroups(state, groups), trash }
    })
  },
  clearTrash: () => set({ trash: [] }),
  focusCommentId: null,

  setCommentsPanelOpen: (open) => set({ commentsPanelOpen: open }),

  openCommentThread: (pageId, commentId) => {
    set({ lightbox: { open: true, pageId }, focusCommentId: commentId, commentsPanelOpen: false })
  },

  clearFocusComment: () => set({ focusCommentId: null }),

  addComment: (pageId, comment) => {
    get().markHistory()
    const author = comment.author ?? (get().authorName.trim() || undefined)
    const stamped = { ...comment, author }
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) => (p.id === pageId ? { ...p, comments: [...p.comments, stamped] } : p))
      }))
    }))
  },

  updateComment: (pageId, commentId, patch) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId
            ? p
            : { ...p, comments: p.comments.map((c) => (c.id === commentId ? { ...c, ...patch } : c)) }
        )
      }))
    }))
  },

  addCommentReply: (pageId, commentId, text) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId
            ? p
            : {
                ...p,
                comments: p.comments.map((c) =>
                  c.id !== commentId
                    ? c
                    : {
                        ...c,
                        replies: [
                          ...c.replies,
                          { id: nanoid(), text, createdAt: Date.now(), author: get().authorName.trim() || undefined }
                        ]
                      }
                )
              }
        )
      }))
    }))
  },

  removeComment: (pageId, commentId) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId ? p : { ...p, comments: p.comments.filter((c) => c.id !== commentId) }
        )
      }))
    }))
  },

  addAnnotation: (pageId, annotation) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) => (p.id === pageId ? { ...p, annotations: [...p.annotations, annotation] } : p))
      }))
    }))
  },

  // No markHistory: fires continuously while dragging an annotation. Callers
  // mark history once at the start of a gesture or one-shot style change.
  updateAnnotation: (pageId, annotationId, patch) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId
            ? p
            : {
                ...p,
                annotations: p.annotations.map((a) =>
                  a.id === annotationId ? ({ ...a, ...patch } as Annotation) : a
                )
              }
        )
      }))
    }))
  },

  removeAnnotation: (pageId, annotationId) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId ? p : { ...p, annotations: p.annotations.filter((a) => a.id !== annotationId) }
        )
      }))
    }))
  }
}))

function finalizeGroups(
  state: StudioState,
  groups: DocGroup[]
): { groups: DocGroup[]; activeGroupId: string | null } {
  const kept = groups.filter((g) => g.pages.length > 0)
  const activeGroupId = kept.some((g) => g.id === state.activeGroupId)
    ? state.activeGroupId
    : (kept[0]?.id ?? null)
  return { groups: kept, activeGroupId }
}

function pruneSelection(
  state: StudioState,
  groups: DocGroup[]
): { selectedPageIds: Set<string>; lastSelectedPageId: string | null } {
  const existing = new Set(groups.flatMap((g) => g.pages.map((p) => p.id)))
  const selectedPageIds = new Set([...state.selectedPageIds].filter((id) => existing.has(id)))
  const lastSelectedPageId =
    state.lastSelectedPageId && existing.has(state.lastSelectedPageId) ? state.lastSelectedPageId : null
  return { selectedPageIds, lastSelectedPageId }
}

/** After undo/redo the restored groups may not contain the active group, selection, or lightbox page. */
function syncDerivedState(
  state: StudioState,
  groups: DocGroup[]
): Pick<StudioState, 'activeGroupId' | 'selectedPageIds' | 'lastSelectedPageId' | 'lightbox'> {
  const { activeGroupId } = finalizeGroups(state, groups)
  const { selectedPageIds, lastSelectedPageId } = pruneSelection(state, groups)
  const pageStillExists =
    state.lightbox.pageId != null && groups.some((g) => g.pages.some((p) => p.id === state.lightbox.pageId))
  const lightbox = state.lightbox.open && !pageStillExists ? { open: false, pageId: null } : state.lightbox
  return { activeGroupId, selectedPageIds, lastSelectedPageId, lightbox }
}

export function releaseUnusedSources(): void {
  const { sources, groups, past, future } = useStudioStore.getState()
  // Sources referenced anywhere in history must survive so undo/redo can restore them.
  const used = new Set(
    [...past, ...future, groups].flatMap((snapshot) => snapshot.flatMap((g) => g.pages.map((p) => p.sourceId)))
  )
  const next = new Map(sources)
  const dropped: string[] = []
  for (const id of sources.keys()) {
    if (!used.has(id)) {
      next.delete(id)
      dropped.push(id)
    }
  }
  // pdf.js is hier per definitie al geladen (er was een document), maar de
  // import blijft dynamisch zodat het opstartpad vrij blijft.
  if (dropped.length) {
    void renderLib().then(({ forgetSource }) => dropped.forEach(forgetSource))
  }
  if (next.size !== sources.size) {
    useStudioStore.setState({ sources: next })
  }
}
