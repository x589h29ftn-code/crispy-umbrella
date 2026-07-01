import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { createBlankPageSource, forgetSource, loadSourceFile } from './lib/pdfEngine'
import type { DocGroup, PageRef, SignatureAsset, SignaturePlacement, SourceFile, Watermark } from './types'

export interface LightboxState {
  open: boolean
  pageId: string | null
}

interface StudioState {
  sources: Map<string, SourceFile>
  groups: DocGroup[]
  activeGroupId: string | null
  zoom: number
  lightbox: LightboxState
  isImporting: boolean
  dragPageId: string | null
  dragGroupId: string | null
  signatureAsset: SignatureAsset | null

  setDragPageId: (id: string | null) => void
  setDragGroupId: (id: string | null) => void
  reorderGroups: (groupId: string, toIndex: number) => void
  removeGroup: (groupId: string) => void
  importFiles: (files: { name: string; data: Uint8Array }[]) => Promise<void>
  addPagesToGroup: (groupId: string, files: { name: string; data: Uint8Array }[]) => Promise<void>
  insertBlankPage: (groupId: string) => Promise<void>
  movePage: (pageId: string, toGroupId: string, toIndex: number) => void
  createGroupWithPage: (pageId: string) => void
  deletePage: (pageId: string) => void
  rotatePage: (pageId: string) => void
  renameGroup: (groupId: string, name: string) => void
  setGroupWatermark: (groupId: string, watermark: Watermark | null) => void
  toggleGroupPageNumbers: (groupId: string) => void
  setActiveGroup: (groupId: string) => void
  setZoom: (zoom: number | ((z: number) => number)) => void
  openLightbox: (pageId: string) => void
  closeLightbox: () => void
  stepLightbox: (direction: 1 | -1) => void
  setSignatureAsset: (asset: SignatureAsset | null) => void
  addSignaturePlacement: (pageId: string, placement: Omit<SignaturePlacement, 'id'>) => void
  updateSignaturePlacement: (pageId: string, placementId: string, patch: Partial<SignaturePlacement>) => void
  removeSignaturePlacement: (pageId: string, placementId: string) => void
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

export const useStudioStore = create<StudioState>((set, get) => ({
  sources: new Map(),
  groups: [],
  activeGroupId: null,
  zoom: 1,
  lightbox: { open: false, pageId: null },
  isImporting: false,
  dragPageId: null,
  dragGroupId: null,
  signatureAsset: null,

  setDragPageId: (id) => set({ dragPageId: id }),
  setDragGroupId: (id) => set({ dragGroupId: id }),

  reorderGroups: (groupId, toIndex) => {
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
    set((state) => {
      const groups = state.groups.filter((g) => g.id !== groupId)
      return finalizeGroups(state, groups)
    })
  },

  importFiles: async (files) => {
    if (!files.length) return
    set({ isImporting: true })
    try {
      const newGroups: DocGroup[] = []
      const sources = new Map(get().sources)
      for (const file of files) {
        const id = nanoid()
        const source = await loadSourceFile(file.name, file.data, id)
        sources.set(id, source)
        const baseName = file.name.replace(/\.pdf$/i, '')
        newGroups.push({
          id: nanoid(),
          name: nextGroupName([...get().groups, ...newGroups], baseName),
          pages: Array.from({ length: source.pageCount }, (_, i) => ({
            id: nanoid(),
            sourceId: id,
            sourcePageIndex: i,
            rotation: 0,
            signatures: []
          })),
          watermark: null,
          pageNumbers: false
        })
      }
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
        const id = nanoid()
        const source = await loadSourceFile(file.name, file.data, id)
        sources.set(id, source)
        for (let i = 0; i < source.pageCount; i += 1) {
          newPages.push({ id: nanoid(), sourceId: id, sourcePageIndex: i, rotation: 0, signatures: [] })
        }
      }
      set((state) => ({
        sources,
        groups: state.groups.map((g) => (g.id === groupId ? { ...g, pages: [...g.pages, ...newPages] } : g))
      }))
    } finally {
      set({ isImporting: false })
    }
  },

  insertBlankPage: async (groupId) => {
    const id = nanoid()
    const source = await createBlankPageSource(id)
    const page: PageRef = { id: nanoid(), sourceId: id, sourcePageIndex: 0, rotation: 0, signatures: [] }
    set((state) => ({
      sources: new Map(state.sources).set(id, source),
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, pages: [...g.pages, page] } : g))
    }))
  },

  movePage: (pageId, toGroupId, toIndex) => {
    set((state) => {
      const found = findPage(state.groups, pageId)
      if (!found) return state
      const { group: fromGroup, index: fromIndex } = found
      const page = fromGroup.pages[fromIndex]

      const groups = state.groups.map((g) => {
        if (g.id === fromGroup.id && g.id === toGroupId) {
          const pages = g.pages.filter((p) => p.id !== pageId)
          const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex
          pages.splice(Math.max(0, Math.min(insertAt, pages.length)), 0, page)
          return { ...g, pages }
        }
        if (g.id === fromGroup.id) {
          return { ...g, pages: g.pages.filter((p) => p.id !== pageId) }
        }
        if (g.id === toGroupId) {
          const pages = [...g.pages]
          pages.splice(Math.max(0, Math.min(toIndex, pages.length)), 0, page)
          return { ...g, pages }
        }
        return g
      })

      return finalizeGroups(state, groups)
    })
  },

  createGroupWithPage: (pageId) => {
    set((state) => {
      const found = findPage(state.groups, pageId)
      if (!found) return state
      const { group: fromGroup, index } = found
      const page = fromGroup.pages[index]
      const newGroup: DocGroup = {
        id: nanoid(),
        name: nextGroupName(state.groups, 'Nieuw document'),
        pages: [page],
        watermark: null,
        pageNumbers: false
      }
      const groups = state.groups
        .map((g) => (g.id === fromGroup.id ? { ...g, pages: g.pages.filter((p) => p.id !== pageId) } : g))
        .concat(newGroup)
      return { ...finalizeGroups(state, groups), activeGroupId: newGroup.id }
    })
  },

  deletePage: (pageId) => {
    set((state) => {
      const groups = state.groups.map((g) => ({ ...g, pages: g.pages.filter((p) => p.id !== pageId) }))
      return finalizeGroups(state, groups)
    })
  },

  rotatePage: (pageId) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id === pageId ? { ...p, rotation: (((p.rotation + 90) % 360) as PageRef['rotation']) } : p
        )
      }))
    }))
  },

  renameGroup: (groupId, name) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g))
    }))
  },

  setGroupWatermark: (groupId, watermark) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, watermark } : g))
    }))
  },

  toggleGroupPageNumbers: (groupId) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, pageNumbers: !g.pageNumbers } : g))
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

  setSignatureAsset: (asset) => set({ signatureAsset: asset }),

  addSignaturePlacement: (pageId, placement) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id === pageId ? { ...p, signatures: [...p.signatures, { ...placement, id: nanoid() }] } : p
        )
      }))
    }))
  },

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
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        pages: g.pages.map((p) =>
          p.id !== pageId ? p : { ...p, signatures: p.signatures.filter((s) => s.id !== placementId) }
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

export function releaseUnusedSources(): void {
  const { sources, groups } = useStudioStore.getState()
  const used = new Set(groups.flatMap((g) => g.pages.map((p) => p.sourceId)))
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
