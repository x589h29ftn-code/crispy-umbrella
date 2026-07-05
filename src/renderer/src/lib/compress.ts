import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import { forgetSource, getPagePointSize, loadSourceFile, renderPageToCanvas } from './pdfRender'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} kB`
}

/**
 * Comprimeert het actieve document: eerst een volwaardige export (met alle
 * bewerkingen), daarna elke pagina als JPEG op lagere resolutie in een nieuwe
 * PDF. Levert vooral winst op bij scans; is het resultaat níet kleiner, dan
 * wordt de gewone export bewaard.
 */
export async function compressActiveGroup(strength: 'normal' | 'strong'): Promise<void> {
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group || !group.pages.length || state.busyExport) return
  state.setBusyExport('pdf')
  const tempId = `compress-${nanoid()}`
  try {
    const { exportGroupToPdf } = await import('./pdfEngine')
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const full = await exportGroupToPdf(group, state.sources, {
      formValues: state.formValues,
      flattenForms: true,
      cleanMetadata: state.cleanMetadata
    })
    const temp = await loadSourceFile('compress', full, tempId)
    const dpi = strength === 'strong' ? 100 : 150
    const jpegQ = strength === 'strong' ? 0.62 : 0.78
    const out = await PDFDocument.create()
    for (let i = 0; i < temp.pageCount; i += 1) {
      const size = await getPagePointSize(temp, i, 0)
      const canvas = await renderPageToCanvas(temp, i, 0, Math.max(200, Math.round((size.width * dpi) / 72)))
      const dataUrl = canvas.toDataURL('image/jpeg', jpegQ)
      canvas.width = 0
      canvas.height = 0
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
      const img = await out.embedJpg(bytes)
      const page = out.addPage([size.width, size.height])
      page.drawImage(img, { x: 0, y: 0, width: size.width, height: size.height })
    }
    out.setTitle(group.name)
    const small = await out.save()

    const base = group.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')
    if (small.length >= full.length) {
      // Tekst-PDF's worden door rasteren juist groter — bewaar dan de gewone export.
      const result = await window.api.savePdf(`${base}.pdf`, full)
      if (result.saved)
        state.addToast('info', `Document is al compact (${fmtSize(full.length)}) — gewone export opgeslagen`)
      return
    }
    const pct = Math.round((1 - small.length / full.length) * 100)
    const result = await window.api.savePdf(`${base} (klein).pdf`, small)
    if (result.saved)
      state.addToast('success', `Gecomprimeerd: ${fmtSize(full.length)} → ${fmtSize(small.length)} (−${pct}%)`)
  } catch {
    state.addToast('error', 'Comprimeren is mislukt')
  } finally {
    forgetSource(tempId)
    useStudioStore.getState().setBusyExport(null)
  }
}
