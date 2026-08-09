import { useStudioStore } from '../store'
import type { DocGroup, SignatureAsset, SourceFile } from '../types'

interface SessionState {
  version: 1
  groups: DocGroup[]
  signatureAssets: SignatureAsset[]
  formValues: Record<string, Record<string, string | boolean>>
  flattenForms: boolean
  sources: { id: string; name: string; pageCount: number }[]
}

const SAVE_DEBOUNCE_MS = 1500

/**
 * Sessieherstel: alleen wanneer de voorkeur "Vorige sessie herstellen" aan
 * staat wordt de vorige werksessie (documenten, bewerkingen, handtekeningen,
 * formulierwaarden) teruggezet en bij elke wijziging bewaard. Standaard staat
 * de voorkeur uit: de app begint dan leeg — ook in het overzicht waar je
 * samenvoegt en splitst — en er blijft niets op schijf achter.
 */
export function initSessionPersistence(): void {
  if (typeof window.api.sessionLoad !== 'function') return

  let enabled = useStudioStore.getState().restoreLastSession
  if (enabled) void restore()
  else void clear()

  let timer: number | null = null
  let lastSnapshot = ''
  useStudioStore.subscribe((state) => {
    if (!state.restoreLastSession) {
      // Voorkeur (net) uitgezet: niets meer bewaren en het opgeslagene wissen.
      if (enabled) {
        enabled = false
        lastSnapshot = ''
        if (timer !== null) {
          window.clearTimeout(timer)
          timer = null
        }
        void clear()
      }
      return
    }
    enabled = true
    const snapshotKey = JSON.stringify([state.groups, state.signatureAssets, state.formValues, state.flattenForms])
    if (snapshotKey === lastSnapshot) return
    lastSnapshot = snapshotKey
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
  })
}

async function clear(): Promise<void> {
  try {
    await window.api.sessionClear()
  } catch {
    // Best-effort; een mislukte opruiming mag het opstarten niet blokkeren.
  }
}

async function restore(): Promise<void> {
  try {
    const { state, sources } = await window.api.sessionLoad()
    const parsed = state as SessionState | null
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups) || !parsed.groups.length) return
    const sourceFiles: SourceFile[] = sources.map((s) => ({
      id: s.id,
      name: s.name,
      pageCount: s.pageCount,
      data: new Uint8Array(s.data)
    }))
    const store = useStudioStore.getState()
    const restored = store.restoreSession({
      sources: sourceFiles,
      groups: parsed.groups,
      signatureAssets: parsed.signatureAssets ?? [],
      formValues: parsed.formValues ?? {},
      flattenForms: Boolean(parsed.flattenForms)
    })
    if (restored) {
      useStudioStore.getState().addToast('info', 'Vorige sessie hersteld')
    }
  } catch {
    // Een kapotte sessie mag het opstarten nooit blokkeren.
  }
}

async function persist(): Promise<void> {
  try {
    const state = useStudioStore.getState()
    if (!state.groups.length) {
      await window.api.sessionClear()
      return
    }
    const usedSourceIds = new Set(state.groups.flatMap((g) => g.pages.map((p) => p.sourceId)))
    const sourcesMeta = [...usedSourceIds]
      .map((id) => state.sources.get(id))
      .filter((s): s is SourceFile => Boolean(s))
      .map((s) => ({ id: s.id, name: s.name, pageCount: s.pageCount }))
    const payload: SessionState = {
      version: 1,
      groups: state.groups,
      signatureAssets: state.signatureAssets,
      formValues: state.formValues,
      flattenForms: state.flattenForms,
      sources: sourcesMeta
    }
    const { missing } = await window.api.sessionSave(JSON.stringify(payload))
    if (missing.length) {
      const bins = missing
        .map((id) => state.sources.get(id))
        .filter((s): s is SourceFile => Boolean(s))
        .map((s) => ({ id: s.id, data: s.data }))
      if (bins.length) await window.api.sessionSaveSources(bins)
    }
  } catch {
    // Best-effort; de volgende wijziging probeert het opnieuw.
  }
}
