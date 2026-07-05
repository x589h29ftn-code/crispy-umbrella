import { useStudioStore } from '../store'
import { getTextItems, type TextItem } from './textLines'
import type { DocGroup, SourceFile } from '../types'

/**
 * Reconstrueert een tabel uit de losse tekstfragmenten van een pagina: rijen
 * op basis van de baseline (y), kolommen op basis van geclusterde x-posities.
 * Bedoeld voor nette, uitgelijnde tabellen zoals in jaarrekeningen.
 */
function itemsToGrid(items: TextItem[]): string[][] {
  if (!items.length) return []

  // Rijen: fragmenten met (bijna) dezelfde baseline horen bij elkaar.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: TextItem[][] = []
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) < Math.max(2, item.height * 0.5))
    if (row) row.push(item)
    else rows.push([item])
  }

  // Kolom-ankers: alle linker-x-posities clusteren (tolerantie ~ halve regelhoogte).
  const tol = Math.max(6, (items.reduce((s, i) => s + i.height, 0) / items.length) * 0.9)
  const xs = [...items.map((i) => i.x)].sort((a, b) => a - b)
  const anchors: number[] = []
  for (const x of xs) {
    if (!anchors.length || x - anchors[anchors.length - 1] > tol) anchors.push(x)
    else anchors[anchors.length - 1] = (anchors[anchors.length - 1] + x) / 2
  }

  const colOf = (x: number): number => {
    let best = 0
    let bestD = Infinity
    for (let c = 0; c < anchors.length; c += 1) {
      const d = Math.abs(anchors[c] - x)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return best
  }

  const grid: string[][] = []
  for (const row of rows.sort((a, b) => b[0].y - a[0].y)) {
    const cells: string[] = new Array(anchors.length).fill('')
    for (const item of row.sort((a, b) => a.x - b.x)) {
      const c = colOf(item.x)
      cells[c] = cells[c] ? `${cells[c]} ${item.str}` : item.str
    }
    grid.push(cells.map((c) => c.trim()))
  }
  return grid
}

/** Verwijdert lege eind-kolommen zodat het blad niet onnodig breed is. */
function trimGrid(grid: string[][]): string[][] {
  const width = Math.max(0, ...grid.map((r) => r.length))
  let lastUsed = -1
  for (let c = 0; c < width; c += 1) {
    if (grid.some((r) => (r[c] ?? '').length)) lastUsed = c
  }
  return grid.map((r) => r.slice(0, lastUsed + 1))
}

/**
 * Exporteert de (herkende) tabellen van het actieve document naar één
 * Excel-bestand: één werkblad per pagina die tekst bevat.
 */
export async function exportTablesToXlsx(): Promise<{ ok: boolean; sheets: number; reason?: string }> {
  const state = useStudioStore.getState()
  const group: DocGroup | undefined = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) return { ok: false, sheets: 0, reason: 'Geen document' }

  const XLSX = await import('@e965/xlsx')
  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()
  let sheets = 0

  for (let i = 0; i < group.pages.length; i += 1) {
    const page = group.pages[i]
    const source: SourceFile | undefined = state.sources.get(page.sourceId)
    if (!source) continue
    const items = await getTextItems(source, page.sourcePageIndex).catch(() => [] as TextItem[])
    if (!items.length) continue
    const grid = trimGrid(itemsToGrid(items))
    if (!grid.length) continue
    const ws = XLSX.utils.aoa_to_sheet(grid)
    let name = `Pagina ${i + 1}`
    let n = 2
    while (usedNames.has(name)) name = `Pagina ${i + 1} (${n++})`
    usedNames.add(name)
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
    sheets += 1
  }

  if (!sheets) return { ok: false, sheets: 0, reason: 'Geen tekst gevonden om als tabel te exporteren (scan? gebruik eerst OCR)' }

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const bytes = new Uint8Array(out)
  const base = group.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_') || 'tabel'
  const result = await window.api.saveFile(`${base}.xlsx`, bytes, 'xlsx')
  return { ok: Boolean(result.saved), sheets }
}
