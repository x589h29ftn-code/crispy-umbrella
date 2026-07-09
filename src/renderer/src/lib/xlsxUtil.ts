import { useStudioStore } from '../store'

interface ParsedCell {
  v: string | number
  z?: string
}

/**
 * Herkent een Nederlands getal/bedrag/percentage/datum in een tekstcel en geeft
 * een echte waarde + Excel-opmaak terug — zo komen bedragen als getallen in
 * Excel, niet als tekst.
 */
export function cellFromText(raw: string): ParsedCell {
  const s = String(raw ?? '').trim()
  if (!s) return { v: '' }
  const dm = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (dm) {
    const [, d, mo, y] = dm
    const year = y.length === 2 ? 2000 + Number(y) : Number(y)
    return { v: `${String(d).padStart(2, '0')}-${String(mo).padStart(2, '0')}-${year}` }
  }
  const isPct = /%$/.test(s)
  const isCur = /€|EUR/i.test(s)
  const numPart = s.replace(/[€\s%]|EUR/gi, '')
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(numPart) || /^-?\d+(,\d+)?$/.test(numPart)) {
    const value = Number(numPart.replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(value)) {
      if (isPct) return { v: value / 100, z: '0.0%' }
      if (isCur) return { v: value, z: '€ #,##0.00' }
      return { v: value, z: Number.isInteger(value) ? '#,##0' : '#,##0.00' }
    }
  }
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
export function makeSheet(XLSX: any, rows: (string | number)[][], opts: { header?: boolean } = {}): any {
  const parsed = rows.map((row) => row.map((c) => (typeof c === 'number' ? { v: c } : cellFromText(String(c)))))
  const ws = XLSX.utils.aoa_to_sheet(parsed.map((r) => r.map((c) => c.v)))
  // Opmaak (z) + celstijl per cel toepassen.
  const colCount = Math.max(0, ...parsed.map((r) => r.length))
  for (let r = 0; r < parsed.length; r += 1) {
    for (let c = 0; c < parsed[r].length; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (!ws[addr]) continue
      const z = parsed[r][c].z
      if (z) ws[addr].z = z
      const isHeaderCell = opts.header && r === 0
      ws[addr].s = isHeaderCell
        ? HEADER_STYLE
        : { border: CELL_BORDER, alignment: { vertical: 'center', horizontal: typeof parsed[r][c].v === 'number' ? 'right' : 'left' } }
    }
  }
  // Kolombreedtes.
  const widths: number[] = []
  for (const row of parsed) row.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 8, Math.min(60, String(c.v).length + 2))))
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
