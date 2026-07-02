import { zipSync } from 'fflate'
import { useStudioStore } from '../store'
import { encryptPdfBytes, exportGroupToPdf } from './pdfEngine'

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
}

async function maybeEncrypt(bytes: Uint8Array): Promise<Uint8Array> {
  const password = useStudioStore.getState().exportPassword.trim()
  if (!password) return bytes
  return encryptPdfBytes(bytes, password)
}

/** Exports the active document as a single PDF via a save dialog. */
export async function exportActivePdf(): Promise<void> {
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group || state.busyExport) return
  state.setBusyExport('pdf')
  try {
    const bytes = await maybeEncrypt(await exportGroupToPdf(group, state.sources))
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
      const bytes = await maybeEncrypt(await exportGroupToPdf(group, state.sources))
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
