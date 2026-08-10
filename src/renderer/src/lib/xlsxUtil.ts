import { useStudioStore } from '../store'
import { excelNumberFormat, parseDutchNumber, type NumberFormatChoice } from './numberFormat'

interface ParsedCell {
  v: string | number | Date
  z?: string
}

// Datumopmaak; de getalopmaak komt uit numberFormat (gedeeld met de Word-export).
const FMT_DATE = 'dd-mm-jjjj'

/**
 * Herkent een Nederlands getal/bedrag/percentage/datum in een tekstcel en geeft
 * een echte waarde + Excel-opmaak terug — zo komen bedragen, percentages en
 * datums als échte waarden in Excel, niet als tekst. Ondersteunt ook
 * boekhoudkundige negatieven: "(1.234)" en "1.234-" (bedrag tussen haakjes of
 * met een min-teken erachter) worden als negatief getal gelezen.
 */
export function cellFromText(raw: string, choice: NumberFormatChoice = 'auto'): ParsedCell {
  const s = String(raw ?? '').trim()
  if (!s) return { v: '' }
  // Datum: d-m-jjjj / d/m/jj → echte Excel-datum (sorteerbaar, rekenbaar).
  const dm = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (dm) {
    const [, d, mo, y] = dm
    const year = y.length === 2 ? 2000 + Number(y) : Number(y)
    const date = new Date(year, Number(mo) - 1, Number(d))
    if (!Number.isNaN(date.getTime()) && Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return { v: date, z: FMT_DATE }
    }
  }
  const parsed = parseDutchNumber(s)
  if (parsed) return { v: parsed.value, z: excelNumberFormat(parsed, choice) }
  return { v: s }
}

/**
 * Bouwt een nette werkblad uit tekstrijen: getallen worden echte getallen met
 * opmaak, kolombreedtes passen automatisch, en met `header` krijgt de eerste
 * rij een autofilter en blijft die in beeld bij scrollen.
 */
// Celstijlen (xlsx-js-style): dunne rand rondom, vette koprij met grijze vulling.
const THIN = { style: 'thin', color: { rgb: 'FFD0D5DD' } }
const CELL_BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN }
const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FF1F2937' } },
  fill: { fgColor: { rgb: 'FFEFF2F7' } },
  alignment: { vertical: 'center' },
  border: CELL_BORDER
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeSheet(
  XLSX: any,
  rows: (string | number)[][],
  opts: { header?: boolean; numberFormat?: NumberFormatChoice } = {}
): any {
  const parsed = rows.map((row) =>
    row.map((c) => (typeof c === 'number' ? { v: c } : cellFromText(String(c), opts.numberFormat ?? 'auto')))
  )
  // cellDates zorgt dat Date-waarden echte datumcellen worden (niet als getal/tekst).
  const ws = XLSX.utils.aoa_to_sheet(
    parsed.map((r) => r.map((c) => c.v)),
    { cellDates: true }
  )
  // Opmaak (z) + celstijl per cel toepassen.
  const colCount = Math.max(0, ...parsed.map((r) => r.length))
  for (let r = 0; r < parsed.length; r += 1) {
    for (let c = 0; c < parsed[r].length; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (!ws[addr]) continue
      const z = parsed[r][c].z
      if (z) ws[addr].z = z
      const val = parsed[r][c].v
      const rightAlign = typeof val === 'number' || val instanceof Date
      const isHeaderCell = opts.header && r === 0
      ws[addr].s = isHeaderCell
        ? HEADER_STYLE
        : { border: CELL_BORDER, alignment: { vertical: 'center', horizontal: rightAlign ? 'right' : 'left' } }
    }
  }
  // Kolombreedtes (datums tellen als ~10 tekens, niet als hun lange JS-string).
  const widths: number[] = []
  for (const row of parsed)
    row.forEach((c, i) => {
      const len = c.v instanceof Date ? 10 : String(c.v).length
      widths[i] = Math.max(widths[i] ?? 8, Math.min(60, len + 2))
    })
  ws['!cols'] = widths.map((wch) => ({ wch }))
  if (opts.header && rows.length > 1) {
    const range = { s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: Math.max(0, colCount - 1) } }
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) }
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
    ws['!rows'] = [{ hpt: 20 }]
  }
  return ws
}

/**
 * Slaat een SheetJS-workbook op en toont een melding met een knop
 * "Open Excel-bestand" die het bestand meteen opent.
 */
export async function saveWorkbook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any,
  fileName: string,
  successMessage: string
): Promise<boolean> {
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
  const result = await window.api.saveFile(fileName, bytes, 'xlsx')
  if (!result.saved) return false
  const addToast = useStudioStore.getState().addToast
  const path = result.path
  addToast(
    'success',
    successMessage,
    path && typeof window.api.openPath === 'function'
      ? { label: 'Open Excel-bestand', run: () => void window.api.openPath!(path) }
      : undefined
  )
  return true
}
