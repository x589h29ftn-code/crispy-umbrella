import { useStudioStore } from '../store'
import { makeSheet, saveWorkbook } from './xlsxUtil'
import type { ChangeEntry } from './pdfDiff'
import type { DocGroup } from '../types'

/**
 * Jaar-op-jaar-analyse: alle regels waar het label gelijk bleef maar een
 * getal wijzigde, als Excel-overzicht met oud, nieuw, verschil en % mutatie.
 * Werkt op de wijzigingen zoals ze in het verschilpaneel staan, dus de
 * ingestelde filters (drempelbedrag, kop-/voetteksten) gelden ook hier.
 */
export async function exportYearComparisonXlsx(
  left: DocGroup,
  right: DocGroup,
  changes: ChangeEntry[]
): Promise<void> {
  const state = useStudioStore.getState()
  try {
    const rows: (string | number)[][] = [
      ['Pagina', 'Omschrijving', `Was (${left.name})`, `Is (${right.name})`, 'Verschil', '% mutatie']
    ]
    for (const c of changes) {
      if (c.kind !== 'number') continue
      const was = Number(c.from)
      const is = Number(c.to)
      // Eén getal per kant → verschil en % berekenen; anders de ruwe waarden tonen.
      if (c.delta !== null && c.delta !== undefined && Number.isFinite(was) && Number.isFinite(is)) {
        rows.push([c.page + 1, c.label ?? '', was, is, c.delta, c.pct ?? ''])
      } else {
        rows.push([c.page + 1, c.label ?? '', c.from ?? '', c.to ?? '', '', ''])
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
