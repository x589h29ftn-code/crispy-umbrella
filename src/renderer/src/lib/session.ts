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
 * Sessieherstel: bij het opstarten wordt de vorige werksessie (documenten,
 * bewerkingen, handtekeningen, formulierwaarden) teruggezet, en elke wijziging
 * wordt met een korte vertraging naar de gebruikersmap weggeschreven.
 */
export function initSessionPersistence(): void {
  if (typeof window.api.sessionLoad !== 'function') return

  void restore()

  let timer: number | null = null
  let lastSnapshot = ''
  useStudioStore.subscribe((state) => {
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
