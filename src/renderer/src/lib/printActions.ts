import * as pdfjsLib from 'pdfjs-dist'
import { exportGroupToPdf } from './pdfEngine'
import { useStudioStore } from '../store'

const PRINT_DPI = 150

/**
 * Prints the active document via the native print dialog. The document is
 * first assembled exactly like an export (annotations, signatures, OCR layer,
 * redactions included) and then rendered to page images, so what prints is
 * what you would export.
 */
export async function printActiveGroup(): Promise<void> {
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) return
  if (typeof window.api.printHtml !== 'function') {
    state.addToast('error', 'Afdrukken is alleen in de desktop-app beschikbaar')
    return
  }
  state.addToast('info', `"${group.name}" wordt voorbereid om af te drukken…`)
  try {
    // Print with flattened form values so the filled fields are visible in the raster.
    const bytes = await exportGroupToPdf(group, state.sources, {
      formValues: state.formValues,
      flattenForms: true
    })
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: PRINT_DPI / 72 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D context unavailable')
      await page.render({ canvasContext: ctx, viewport }).promise
      const landscape = viewport.width > viewport.height
      pages.push(
        `<div class="page${landscape ? ' page--landscape' : ''}"><img src="${canvas.toDataURL('image/jpeg', 0.92)}"></div>`
      )
      canvas.width = 0
      canvas.height = 0
    }
    await doc.destroy()
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { margin: 0; }
      html, body { margin: 0; padding: 0; }
      .page { page-break-after: always; display: flex; align-items: center; justify-content: center; }
      .page img { width: 100%; }
    </style></head><body>${pages.join('')}</body></html>`
    const result = await window.api.printHtml(html)
    if (!result.ok && result.reason && result.reason !== 'cancelled' && result.reason !== 'Print job canceled') {
      state.addToast('error', `Afdrukken mislukt: ${result.reason}`)
    }
  } catch {
    state.addToast('error', 'Afdrukken mislukt')
  }
}
