import { useStudioStore } from '../store'
import { analyzeDocument, DEFAULT_STRUCTURE_OPTIONS } from './docStructure'
import { getTextItems, type TextItem } from './textLines'
import { makeSheet, saveWorkbook } from './xlsxUtil'
import type { DocGroup, SourceFile } from '../types'

/**
 * Tabellen naar Excel. De herkenning zit in docStructure (gedeeld met de
 * Markdown- en Word-export): alleen blokken die écht een tabel zijn worden een
 * werkblad, in plaats van elke pagina als raster. Kop-/voetteksten en gewone
 * alinea's belanden dus niet meer tussen de cijfers.
 */

/** Ziet de eerste rij eruit als een kopregel (tekst boven kolommen met cijfers)? */
function looksLikeHeader(grid: string[][]): boolean {
  const first = grid[0] ?? []
  const filled = first.filter((c) => c.trim().length > 0)
  if (filled.length < 2) return false
  const numericInHeader = filled.filter((c) => /^[€\s]*-?\(?\d[\d.,\s]*\)?-?\s*%?$/.test(c.trim())).length
  if (numericInHeader > 0) return false
  // Onder de eerste rij moeten wél getallen staan, anders is het gewoon tekst.
  return grid.slice(1).some((row) => row.some((c) => /\d/.test(c)))
}

/** Werkbladnaam: het kopje boven de tabel, anders het paginanummer. */
function sheetName(caption: string | undefined, pageNumber: number, used: Set<string>): string {
  const base = (caption ?? `Pagina ${pageNumber}`).replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || `Pagina ${pageNumber}`
  let name = base
  let n = 2
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 25)} (${n++})`
  used.add(name.toLowerCase())
  return name
}

/** Losse tekstfragmenten van een pagina als ruw raster (terugvaloptie). */
function itemsToGrid(items: TextItem[]): string[][] {
  if (!items.length) return []
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: TextItem[][] = []
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) < Math.max(2, item.height * 0.5))
    if (row) row.push(item)
    else rows.push([item])
  }
  const tol = Math.max(6, (items.reduce((s, i) => s + i.height, 0) / items.length) * 0.9)
  const anchors: number[] = []
  for (const x of items.map((i) => i.x).sort((a, b) => a - b)) {
    if (!anchors.length || x - anchors[anchors.length - 1] > tol) anchors.push(x)
    else anchors[anchors.length - 1] = (anchors[anchors.length - 1] + x) / 2
  }
  const colOf = (x: number): number => {
    let best = 0
    let bestD = Infinity
    anchors.forEach((a, c) => {
      const d = Math.abs(a - x)
      if (d < bestD) {
        bestD = d
        best = c
      }
    })
    return best
  }
  return rows
    .sort((a, b) => b[0].y - a[0].y)
    .map((row) => {
      const cells: string[] = new Array(anchors.length).fill('')
      for (const item of row.sort((a, b) => a.x - b.x)) {
        const c = colOf(item.x)
        cells[c] = cells[c] ? `${cells[c]} ${item.str}` : item.str
      }
      return cells.map((c) => c.trim())
    })
}

export interface TableExportOptions {
  /** Ook pagina's zonder herkende tabel als ruw raster meenemen. */
  includeRawPages: boolean
}

/**
 * Exporteert de herkende tabellen van het actieve document naar één
 * Excel-bestand: één werkblad per tabel, genoemd naar het kopje erboven.
 */
export async function exportTablesToXlsx(
  options: TableExportOptions = { includeRawPages: false }
): Promise<{ ok: boolean; sheets: number; reason?: string }> {
  const state = useStudioStore.getState()
  const group: DocGroup | undefined = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) return { ok: false, sheets: 0, reason: 'Geen document' }

  const numberFormat = state.numberFormat
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  let sheets = 0

  const { pages } = await analyzeDocument(group, state.sources, DEFAULT_STRUCTURE_OPTIONS, group.name)

  pages.forEach((blocks, pageIndex) => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue
      const header = looksLikeHeader(block.grid)
      const ws = makeSheet(XLSX, block.grid, { header, numberFormat })
      XLSX.utils.book_append_sheet(wb, ws, sheetName(block.caption, pageIndex + 1, used).slice(0, 31))
      sheets += 1
    }
  })

  if (options.includeRawPages) {
    for (let i = 0; i < group.pages.length; i += 1) {
      if (pages[i]?.some((b) => b.kind === 'table')) continue
      const page = group.pages[i]
      const source: SourceFile | undefined = state.sources.get(page.sourceId)
      if (!source) continue
      const items = await getTextItems(source, page.sourcePageIndex).catch(() => [] as TextItem[])
      const grid = itemsToGrid(items)
      if (!grid.length) continue
      const ws = makeSheet(XLSX, grid, { numberFormat })
      XLSX.utils.book_append_sheet(wb, ws, sheetName(`Pagina ${i + 1} (ruw)`, i + 1, used).slice(0, 31))
      sheets += 1
    }
  }

  if (!sheets) {
    return {
      ok: false,
      sheets: 0,
      reason: 'Geen tabellen herkend. Bevat dit document alleen lopende tekst, of is het een scan? Draai dan eerst OCR, of kies "Elke pagina als ruw raster".'
    }
  }

  const base = group.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_') || 'tabel'
  const ok = await saveWorkbook(
    XLSX,
    wb,
    `${base}.xlsx`,
    `Tabellen geëxporteerd naar Excel (${sheets} werkblad${sheets === 1 ? '' : 'en'})`
  )
  return { ok, sheets }
}
