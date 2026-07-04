import { useStudioStore } from '../store'
import { exportGroupToPdf } from './pdfEngine'

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
}

/**
 * Deelt het actieve document met reMarkable. Nog niet gekoppeld? Dan opent
 * eerst het koppelscherm; daarna (of meteen als al gekoppeld) wordt geüpload.
 */
export async function shareActiveToRemarkable(): Promise<void> {
  const state = useStudioStore.getState()
  if (typeof window.api.remarkableUpload !== 'function') {
    state.addToast('error', 'Delen met reMarkable werkt alleen in de desktop-app')
    return
  }
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) {
    state.addToast('info', 'Er is nog geen document om te delen')
    return
  }
  const status = await window.api.remarkableStatus()
  if (!status.paired) {
    state.setRemarkableDialogOpen(true)
    return
  }
  await uploadActiveToRemarkable()
}

/** Exporteert het actieve document en uploadt het naar de map "PDF Studio". */
export async function uploadActiveToRemarkable(): Promise<void> {
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) return
  state.addToast('info', `"${group.name}" wordt naar reMarkable geüpload…`)
  try {
    // reMarkable opent geen versleutelde PDF's, dus zonder exportwachtwoord.
    const bytes = await exportGroupToPdf(group, state.sources, {
      formValues: state.formValues,
      flattenForms: state.flattenForms
    })
    const result = await window.api.remarkableUpload(sanitizeName(group.name), bytes)
    if (result.ok) {
      state.addToast('success', `"${group.name}" staat nu in de map "PDF Studio" op je reMarkable`)
    } else {
      state.addToast('error', result.error ?? 'Uploaden naar reMarkable is mislukt')
    }
  } catch {
    state.addToast('error', `Delen van "${group.name}" met reMarkable is mislukt`)
  }
}
