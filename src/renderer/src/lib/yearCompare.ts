import { useStudioStore } from '../store'
import { diffPages } from './pdfDiff'
import { makeSheet, saveWorkbook } from './xlsxUtil'
import type { DocGroup, SourceFile } from '../types'

/**
 * Jaar-op-jaar-analyse: alle regels waar het label gelijk bleef maar een
 * getal wijzigde, als Excel-overzicht met oud, nieuw, verschil en % mutatie.
 * Ideaal om twee jaarrekeningen naast elkaar te leggen.
 */
export async function exportYearComparisonXlsx(
  left: DocGroup,
  right: DocGroup,
  sources: Map<string, SourceFile>
): Promise<void> {
  const state = useStudioStore.getState()
  try {
    const rows: (string | number)[][] = [['Pagina', 'Omschrijving', `Was (${left.name})`, `Is (${right.name})`, 'Verschil', '% mutatie']]
    const maxPages = Math.max(left.pages.length, right.pages.length)
    for (let i = 0; i < maxPages; i += 1) {
      const lp = left.pages[i]
      const rp = right.pages[i]
      const d = await diffPages(
        lp ? sources.get(lp.sourceId) : undefined,
        lp,
        rp ? sources.get(rp.sourceId) : undefined,
        rp
      ).catch(() => null)
      for (const n of d?.numbers ?? []) {
        const was = Number(n.from)
        const is = Number(n.to)
        // Eén getal per kant → verschil en % berekenen; anders de ruwe waarden tonen.
        if (Number.isFinite(was) && Number.isFinite(is) && !n.from.includes(' ') && !n.to.includes(' ')) {
          const diff = is - was
          const pct = was !== 0 ? Math.round((diff / Math.abs(was)) * 1000) / 10 : ''
          rows.push([i + 1, n.label, was, is, diff, pct])
        } else {
          rows.push([i + 1, n.label, n.from, n.to, '', ''])
        }
      }
    }
    if (rows.length === 1) {
      state.addToast('info', 'Geen cijferwijzigingen gevonden tussen deze documenten')
      return
    }
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, makeSheet(XLSX, rows, { header: true }), 'Jaar-op-jaar')
    await saveWorkbook(XLSX, wb, 'Jaar-op-jaar.xlsx', `Jaar-op-jaar-overzicht opgeslagen (${rows.length - 1} regels)`)
  } catch {
    state.addToast('error', 'Jaar-op-jaar-export is mislukt')
  }
}
