import { useStudioStore } from '../store'

const W = 595.28
const H = 841.89
const M = 56

/** Helvetica kan alleen WinAnsi aan; vervang tekens daarbuiten. */
function safe(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

/**
 * Bundelt alle geopende documenten tot één dossier-PDF: voorblad, inhoudsopgave
 * met paginanummers en een scheidingsblad per document.
 */
export async function exportPortfolio(): Promise<void> {
  const state = useStudioStore.getState()
  const groups = state.groups.filter((g) => g.pages.length)
  if (groups.length < 2) {
    state.addToast('info', 'Open minstens twee documenten om een dossier te bundelen')
    return
  }
  if (state.busyExport) return
  state.setBusyExport('pdf')
  try {
    const { exportGroupToPdf } = await import('./pdfEngine')
    const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib')
    const parts: { name: string; doc: Awaited<ReturnType<typeof PDFDocument.load>> }[] = []
    for (const g of groups) {
      const bytes = await exportGroupToPdf(g, state.sources, {
        formValues: state.formValues,
        flattenForms: state.flattenForms,
        cleanMetadata: state.cleanMetadata
      })
      parts.push({ name: g.name, doc: await PDFDocument.load(bytes) })
    }

    const out = await PDFDocument.create()
    const font = await out.embedFont(StandardFonts.Helvetica)
    const bold = await out.embedFont(StandardFonts.HelveticaBold)
    const ink = rgb(0.12, 0.14, 0.18)
    const dim = rgb(0.45, 0.48, 0.54)

    // Paginanummers vooraf uitrekenen: voorblad + inhoudsopgave + per document
    // een scheidingsblad gevolgd door de pagina's zelf.
    const tocPages = Math.max(1, Math.ceil(parts.length / 30))
    let pageNo = 1 + tocPages + 1
    const entries = parts.map((p) => {
      const e = { name: p.name, page: pageNo, count: p.doc.getPageCount() }
      pageNo += 1 + p.doc.getPageCount()
      return e
    })

    const cover = out.addPage([W, H])
    cover.drawText('Dossier', { x: M, y: H - 150, size: 34, font: bold, color: ink })
    cover.drawText(`${parts.length} documenten · ${pageNo - 1} pagina's`, { x: M, y: H - 185, size: 12, font, color: dim })

    for (let t = 0; t < tocPages; t += 1) {
      const toc = out.addPage([W, H])
      toc.drawText('Inhoud', { x: M, y: H - 90, size: 20, font: bold, color: ink })
      const slice = entries.slice(t * 30, t * 30 + 30)
      slice.forEach((e, i) => {
        const y = H - 130 - i * 22
        toc.drawText(safe(e.name), { x: M, y, size: 11, font, color: ink, maxWidth: W - M * 2 - 60 })
        toc.drawText(String(e.page), { x: W - M - 30, y, size: 11, font: bold, color: ink })
      })
    }

    for (let p = 0; p < parts.length; p += 1) {
      const sep = out.addPage([W, H])
      sep.drawText(String(p + 1).padStart(2, '0'), { x: M, y: H / 2 + 30, size: 56, font: bold, color: dim })
      sep.drawText(safe(parts[p].name), { x: M, y: H / 2 - 10, size: 16, font: bold, color: ink, maxWidth: W - M * 2 })
      sep.drawText(`${entries[p].count} pagina's`, { x: M, y: H / 2 - 34, size: 11, font, color: dim })
      const copied = await out.copyPages(parts[p].doc, parts[p].doc.getPageIndices())
      for (const page of copied) out.addPage(page)
    }

    out.setTitle('Dossier')
    const bytes = await out.save()
    const result = await window.api.savePdf('Dossier.pdf', bytes)
    if (result.saved) state.addToast('success', `Dossier gebundeld: ${parts.length} documenten in één PDF`)
  } catch {
    state.addToast('error', 'Dossier bundelen is mislukt')
  } finally {
    useStudioStore.getState().setBusyExport(null)
  }
}
