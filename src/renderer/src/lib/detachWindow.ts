import { useStudioStore } from '../store'
import type { SourceFile } from '../types'

/**
 * Koppelt het opgegeven document los naar een eigen venster. De pagina's,
 * bewerkingen en benodigde bronbestanden worden via het main-proces
 * doorgegeven aan het nieuwe venster.
 */
export async function openDocumentInNewWindow(groupId: string): Promise<void> {
  if (typeof window.api.openDocumentWindow !== 'function') {
    useStudioStore.getState().addToast('info', 'Losse vensters werken alleen in de desktop-app')
    return
  }
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === groupId)
  if (!group) return
  const sourceIds = new Set(group.pages.map((p) => p.sourceId))
  const sources = [...sourceIds]
    .map((id) => state.sources.get(id))
    .filter((s): s is SourceFile => Boolean(s))
  await window.api.openDocumentWindow({
    groups: [group],
    sources,
    signatureAssets: state.signatureAssets,
    formValues: state.formValues,
    flattenForms: state.flattenForms
  })
}

/** True wanneer dit venster in "los venster"-modus is geopend (via de URL-hash). */
export function isHandoffWindow(): boolean {
  return /(?:^|[#&])handoff=/.test(window.location.hash)
}

/**
 * Laadt het losgekoppelde document in dit venster. Wordt bij het opstarten
 * aangeroepen in plaats van het gewone sessieherstel.
 */
export async function consumeHandoffIfPresent(): Promise<boolean> {
  if (!isHandoffWindow() || typeof window.api.consumeHandoff !== 'function') return false
  const id = window.location.hash.replace(/^#/, '').match(/handoff=([\w-]+)/)?.[1]
  if (!id) return false
  try {
    const payload = (await window.api.consumeHandoff(id)) as
      | {
          groups: unknown[]
          sources: { id: string; name: string; pageCount: number; data: ArrayLike<number>; path?: string }[]
          signatureAssets?: unknown[]
          formValues?: Record<string, Record<string, string | boolean>>
          flattenForms?: boolean
        }
      | null
    if (!payload || !Array.isArray(payload.groups) || !payload.groups.length) return false
    const sources: SourceFile[] = payload.sources.map((s) => ({
      id: s.id,
      name: s.name,
      pageCount: s.pageCount,
      data: s.data instanceof Uint8Array ? s.data : new Uint8Array(s.data),
      path: s.path
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useStudioStore.getState().restoreSession({
      sources,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      groups: payload.groups as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signatureAssets: (payload.signatureAssets ?? []) as any,
      formValues: payload.formValues ?? {},
      flattenForms: Boolean(payload.flattenForms)
    })
    return true
  } catch {
    return false
  }
}
