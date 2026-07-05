import { useStudioStore } from '../store'
import { DOC_TYPE_LABELS, extractFields, getGroupText } from './docAnalysis'

function csvCell(value: string | null): string {
  const v = value ?? ''
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Herkent per document de kerngegevens (type, datum, factuurnummer, bedrag,
 * BTW/IBAN, leverancier) en exporteert ze als CSV — één regel per document.
 * Puntkomma-gescheiden met BOM, zodat het meteen goed in Excel opent (NL).
 */
export async function exportDataToCsv(): Promise<void> {
  const state = useStudioStore.getState()
  if (!state.groups.length) {
    state.addToast('info', 'Er zijn geen documenten om te analyseren')
    return
  }
  try {
    const header = ['Bestand', 'Type', 'Datum', 'Factuurnummer', 'Bedrag (EUR)', 'IBAN', 'Afzender']
    const rows: string[] = [header.join(';')]
    for (const group of state.groups) {
      const text = await getGroupText(group, state.sources)
      const f = extractFields(text)
      rows.push(
        [group.name, DOC_TYPE_LABELS[f.type], f.date, f.invoiceNumber, f.amount, f.iban, f.supplier]
          .map(csvCell)
          .join(';')
      )
    }
    const csv = '﻿' + rows.join('\r\n')
    const bytes = new TextEncoder().encode(csv)
    const result = await window.api.saveFile('PDF-Studio-gegevens.csv', bytes, 'csv')
    if (result.saved) state.addToast('success', `Gegevens van ${state.groups.length} document(en) opgeslagen als CSV`)
  } catch {
    state.addToast('error', 'Exporteren van de gegevens is mislukt')
  }
}
