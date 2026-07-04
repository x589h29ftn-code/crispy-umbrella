import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { createBlankPageSource, decryptPdfBytes, forgetSource, isPasswordError, loadSourceFile } from './lib/pdfEngine'
import type { Annotation, DocGroup, PageComment, PageRef, SignatureAsset, SignaturePlacement, SourceFile, Watermark } from './types'

export interface LightboxState {
  open: boolean
  pageId: string | null
}

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  message: string
}

export interface PasswordRequest {
  fileName: string
  attempt: number
}

export type DropTarget =
  | { type: 'slot'; groupId: string; index: number; edge: 'before' | 'after' }
  | { type: 'canvas' }

const BLANK_SOURCE_ID = 'blank-page-source'
const HISTORY_LIMIT = 50

export type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'pdf-studio-theme'

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

  setSearchOpen: (open: boolean) => void
  toggleTheme: () => void
  markHistory: () => void
  undo: () => void
  redo: () => void
  toggleSelectPage: (pageId: string) => void
  rangeSelectPage: (pageId: string) => void
  clearSelection: () => void
  addToast: (kind: Toast['kind'], message: string) => void
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
  importFiles: (files: { name: string; data: Uint8Array }[]) => Promise<void>
  addPagesToGroup: (groupId: string, files: { name: string; data: Uint8Array }[]) => Promise<void>
  insertBlankPage: (groupId: string) => Promise<void>
  movePages: (pageIds: string[], toGroupId: string, toIndex: number) => void
  createGroupWithPages: (pageIds: string[]) => void
  deletePages: (pageIds: string[]) => void
  rotatePages: (pageIds: string[], delta?: 90 | -90) => void
  duplicatePages: (pageIds: string[]) => void
  renameGroup: (groupId: string, name: string) => void
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
 * Loads a PDF, prompting for a password (and decrypting via the main process)
 * when the file turns out to be protected. Returns null if the user cancels
 * or the file is unreadable — a toast explains which.
 */
async function loadFileInteractive(
  file: { name: string; data: Uint8Array },
  addToast: StudioState['addToast']
): Promise<SourceFile | null> {
  let data = file.data
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await loadSourceFile(file.name, data, nanoid())
    } catch (error) {
      if (!isPasswordError(error)) {
        addToast('error', `Kon "${file.name}" niet openen — is het een geldig PDF-bestand?`)
        return null
      }
      const password = await requestPassword(file.name, attempt)
      if (password === null) {
        addToast('info', `"${file.name}" overgeslagen`)
        return null
      }
      try {
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

  clearSelection: () => set({ selectedPageIds: new Set(), lastSelectedPageId: null }),

  addToast: (kind, message) => {
    const id = nanoid()
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
    window.setTimeout(() => get().dismissToast(id), 4500)
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
      const newGroups: DocGroup[] = []
      const sources = new Map(get().sources)
      for (const file of files) {
        const source = await loadFileInteractive(file, get().addToast)
        if (!source) continue
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
            comments: []
          })),
          watermark: null,
          pageNumbers: false,
          documentDate: null
        })
      }
      if (!newGroups.length) return
      get().markHistory()
      set((state) => ({
        sources,
        groups: [...state.groups, ...newGroups],
        activeGroupId: state.activeGroupId ?? newGroups[0]?.id ?? null
      }))
    } finally {
      set({ isImporting: false })
    }
  },

  addPagesToGroup: async (groupId, files) => {
    if (!files.length) return
    set({ isImporting: true })
    try {
      const sources = new Map(get().sources)
      const newPages: PageRef[] = []
      for (const file of files) {
        const source = await loadFileInteractive(file, get().addToast)
        if (!source) continue
        sources.set(source.id, source)
        for (let i = 0; i < source.pageCount; i += 1) {
          newPages.push({
            id: nanoid(),
            sourceId: source.id,
            sourcePageIndex: i,
            rotation: 0,
            signatures: [],
            annotations: [],
            comments: []
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
      set({ isImporting: false })
    }
  },

  insertBlankPage: async (groupId) => {
    // Every blank page is byte-identical, so all of them share one lazily-created
    // SourceFile instead of re-parsing a fresh throwaway PDF through pdf.js each time.
    let source = get().sources.get(BLANK_SOURCE_ID)
    if (!source) source = await createBlankPageSource(BLANK_SOURCE_ID)
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
      const groups = state.groups.map((g) => ({ ...g, pages: g.pages.filter((p) => !idSet.has(p.id)) }))
      return { ...finalizeGroups(state, groups), ...pruneSelection(state, groups) }
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
  focusCommentId: null,

  setCommentsPanelOpen: (open) => set({ commentsPanelOpen: open }),

  openCommentThread: (pageId, commentId) => {
    set({ lightbox: { open: true, pageId }, focusCommentId: commentId, commentsPanelOpen: false })
  },

  clearFocusComment: () => set({ focusCommentId: null }),

  addComment: (pageId, comment) => {
    get().markHistory()
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) => (p.id === pageId ? { ...p, comments: [...p.comments, comment] } : p))
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
                    : { ...c, replies: [...c.replies, { id: nanoid(), text, createdAt: Date.now() }] }
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
  for (const id of sources.keys()) {
    if (!used.has(id)) {
      next.delete(id)
      forgetSource(id)
    }
  }
  if (next.size !== sources.size) {
    useStudioStore.setState({ sources: next })
  }
}
