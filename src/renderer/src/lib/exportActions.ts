import { zipSync } from 'fflate'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import type { DocGroup, SourceFile } from '../types'

// pdfEngine trekt de zware @cantoo/pdf-lib-bundel mee; we laden hem pas bij het
// eerste exporteren zodat het opstarten er niet op hoeft te wachten.
let enginePromise: Promise<typeof import('./pdfEngine')> | null = null
function engine(): Promise<typeof import('./pdfEngine')> {
  return (enginePromise ??= import('./pdfEngine'))
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
}

async function exportGroup(
  group: DocGroup,
  sources: Map<string, SourceFile>,
  opts: { formValues: Record<string, Record<string, string | boolean>>; flattenForms: boolean }
): Promise<Uint8Array> {
  const { exportGroupToPdf } = await engine()
  return exportGroupToPdf(group, sources, opts)
}

async function maybeEncrypt(bytes: Uint8Array): Promise<Uint8Array> {
  const state = useStudioStore.getState()
  const password = state.exportPassword.trim()
  const perms = state.exportPermissions
  const restricted = !perms.printing || !perms.copying || !perms.modifying
  if (!password && !restricted) return bytes
  const { encryptPdfBytes } = await engine()
  return encryptPdfBytes(bytes, password, restricted ? perms : undefined)
}

function exportOptions(): { formValues: Record<string, Record<string, string | boolean>>; flattenForms: boolean } {
  const state = useStudioStore.getState()
  return { formValues: state.formValues, flattenForms: state.flattenForms }
}

/** Exports the active document as a single PDF via a save dialog. */
export async function exportActivePdf(): Promise<void> {
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group || state.busyExport) return
  state.setBusyExport('pdf')
  try {
    const bytes = await maybeEncrypt(await exportGroup(group, state.sources, exportOptions()))
    const result = await window.api.savePdf(`${sanitizeFileName(group.name)}.pdf`, bytes)
    if (result.saved) state.addToast('success', `"${group.name}" opgeslagen`)
  } catch {
    state.addToast('error', `Exporteren van "${group.name}" is mislukt`)
  } finally {
    useStudioStore.getState().setBusyExport(null)
  }
}

/** Exports every document as its own PDF, bundled in one zip, via a save dialog. */
export async function exportAllZip(): Promise<void> {
  const state = useStudioStore.getState()
  if (!state.groups.length || state.busyExport) return
  state.setBusyExport('zip')
  try {
    const files: Record<string, Uint8Array> = {}
    const usedNames = new Set<string>()
    for (const group of state.groups) {
      if (!group.pages.length) continue
      const bytes = await maybeEncrypt(await exportGroup(group, state.sources, exportOptions()))
      let fileName = `${sanitizeFileName(group.name)}.pdf`
      let n = 2
      while (usedNames.has(fileName)) {
        fileName = `${sanitizeFileName(group.name)} (${n}).pdf`
        n += 1
      }
      usedNames.add(fileName)
      files[fileName] = bytes
    }
    const zipBytes = zipSync(files, { level: 6 })
    const result = await window.api.saveZip('PDF-Studio-export.zip', zipBytes)
    if (result.saved) state.addToast('success', `${usedNames.size} PDF's opgeslagen als zip`)
  } catch {
    state.addToast('error', 'Exporteren als zip is mislukt')
  } finally {
    useStudioStore.getState().setBusyExport(null)
  }
}

/** Exporteert elke geselecteerde pagina als een apart PDF-bestand, gebundeld in één zip. */
export async function exportPagesAsSeparateFiles(pageIds: string[]): Promise<void> {
  const state = useStudioStore.getState()
  if (!pageIds.length || state.busyExport) return
  const idSet = new Set(pageIds)
  // Behoud de projectvolgorde en onthoud waar elke pagina vandaan komt (voor de naam).
  const ordered = state.groups.flatMap((g) =>
    g.pages.filter((p) => idSet.has(p.id)).map((page) => ({ page, groupName: g.name }))
  )
  if (!ordered.length) return
  state.setBusyExport('zip')
  try {
    const files: Record<string, Uint8Array> = {}
    const usedNames = new Set<string>()
    let index = 1
    for (const { page, groupName } of ordered) {
      const single: DocGroup = {
        id: nanoid(),
        name: groupName,
        pages: [page],
        watermark: null,
        pageNumbers: false,
        documentDate: null
      }
      const bytes = await maybeEncrypt(await exportGroup(single, state.sources, exportOptions()))
      let fileName = `${sanitizeFileName(groupName)} - pagina ${index}.pdf`
      let n = 2
      while (usedNames.has(fileName)) {
        fileName = `${sanitizeFileName(groupName)} - pagina ${index} (${n}).pdf`
        n += 1
      }
      usedNames.add(fileName)
      files[fileName] = bytes
      index += 1
    }
    const zipBytes = zipSync(files, { level: 6 })
    const result = await window.api.saveZip('PDF-Studio-paginas.zip', zipBytes)
    if (result.saved) state.addToast('success', `${usedNames.size} pagina's opgeslagen als losse PDF's`)
  } catch {
    state.addToast('error', "Exporteren van losse pagina's is mislukt")
  } finally {
    useStudioStore.getState().setBusyExport(null)
  }
}
