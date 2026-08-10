import { getTextItems, type TextItem } from './textLines'
import { getGroupBookmarks } from './bookmarks'
import type { DocGroup, SourceFile } from '../types'

/**
 * Structuur uit een PDF halen.
 *
 * Een PDF kent geen koppen, alinea's, lijsten of tabellen — er staan alleen
 * tekstfragmenten op coördinaten. Deze module leidt die structuur af uit
 * posities, lettergroottes en vet, zodat Markdown, Word en Excel allemaal
 * dezelfde (en dus even goede) herkenning gebruiken.
 */

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string; bold: boolean }
  | { kind: 'list'; ordered: boolean; items: { text: string; indent: number; marker?: string }[] }
  | { kind: 'table'; grid: string[][]; caption?: string }
  | { kind: 'note'; text: string }

export interface StructureOptions {
  /** Koppen herkennen aan lettergrootte, vet en de bladwijzers van de PDF. */
  headings: boolean
  /** Opsommingen (•, -, 1.) als lijst herkennen. */
  lists: boolean
  /** Uitgelijnde kolommen als tabel herkennen. */
  tables: boolean
  /** Regels van dezelfde alinea samenvoegen (inclusief afbreekstreepjes). */
  joinParagraphs: boolean
  /** Terugkerende kop-/voetteksten weglaten. */
  dropRunningHeads: boolean
  /** Een eerste regel die de documentnaam herhaalt overslaan. */
  dropTitleLine?: boolean
}

export const DEFAULT_STRUCTURE_OPTIONS: StructureOptions = {
  headings: true,
  lists: true,
  tables: true,
  joinParagraphs: true,
  dropRunningHeads: true,
  dropTitleLine: false
}

export interface StructureStats {
  pages: number
  /** Pagina's zonder tekstlaag (scans): daar valt niets te halen zonder OCR. */
  pagesWithoutText: number
  headings: number
  tables: number
  listItems: number
  words: number
}

export interface DocumentStructure {
  pages: Block[][]
  stats: StructureStats
}

/** Eén tekstregel met alles wat nodig is om de structuur te bepalen. */
interface Line {
  text: string
  items: TextItem[]
  size: number
  bold: boolean
  x: number
  y: number
}

const BULLET_RE = /^\s*[•▪◦‣·∙*+●-]\s+/
const ORDERED_RE = /^\s*(\d{1,2})[.)]\s+/
const LETTER_RE = /^\s*[a-z][.)]\s+/i

/** Fragmenten van een pagina groeperen tot regels (zelfde basislijn). */
function itemsToLines(items: TextItem[]): Line[] {
  const rows: TextItem[][] = []
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) < Math.max(2, item.height * 0.45))
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x)
      let text = ''
      let prevEnd: number | null = null
      for (const item of row) {
        if (prevEnd !== null && item.x - prevEnd > item.height * 0.2 && !text.endsWith(' ') && !item.str.startsWith(' ')) {
          text += ' '
        }
        text += item.str
        prevEnd = item.x + item.width
      }
      const chars = row.reduce((n, i) => n + i.str.length, 0)
      const boldChars = row.filter((i) => i.bold).reduce((n, i) => n + i.str.length, 0)
      return {
        text: text.trim(),
        items: row,
        size: Math.max(...row.map((i) => i.height)),
        bold: chars > 0 && boldChars / chars > 0.6,
        x: Math.min(...row.map((i) => i.x)),
        y: row[0].y
      }
    })
    .filter((l) => l.text.length > 0)
}

/** Meest voorkomende lettergrootte, gewogen naar het aantal tekens (= de broodtekst). */
function bodyFontSize(lines: Line[]): number {
  const weight = new Map<number, number>()
  for (const line of lines) {
    const key = Math.round(line.size * 2) / 2
    weight.set(key, (weight.get(key) ?? 0) + line.text.length)
  }
  let best = 11
  let bestWeight = -1
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      bestWeight = w
      best = size
    }
  }
  return best
}

/** Tekst normaliseren om terugkerende kop-/voetregels te herkennen. */
function runningKey(text: string): string {
  return text
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Kop- en voetteksten: regels die boven- of onderaan op veel pagina's in
 * (bijna) dezelfde vorm terugkomen, zoals "Pagina 3 van 12" of de kantoornaam.
 */
function findRunningHeads(pages: Line[][]): Set<string> {
  const counts = new Map<string, number>()
  const pageCount = pages.filter((p) => p.length).length
  if (pageCount < 3) return new Set()
  for (const lines of pages) {
    if (!lines.length) continue
    const candidates = [...lines.slice(0, 2), ...lines.slice(-2)]
    for (const key of new Set(candidates.map((l) => runningKey(l.text)))) {
      if (key.length < 3) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const threshold = Math.max(3, Math.ceil(pageCount * 0.6))
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([key]) => key))
}

/** Rijen die eruitzien als een tabelregel: meerdere kolommen met duidelijke tussenruimte. */
function isTabular(line: Line): boolean {
  if (line.items.length < 2) return false
  let gaps = 0
  for (let i = 1; i < line.items.length; i += 1) {
    const prev = line.items[i - 1]
    const gap = line.items[i].x - (prev.x + prev.width)
    if (gap > Math.max(6, prev.height * 1.4)) gaps += 1
  }
  return gaps >= 1
}

/** Kolomankers uit een blok tabelregels; elke cel hangt aan het dichtstbijzijnde anker. */
function blockToGrid(block: Line[]): string[][] {
  const all = block.flatMap((l) => l.items)
  const avgHeight = all.reduce((s, i) => s + i.height, 0) / Math.max(1, all.length)
  const tol = Math.max(6, avgHeight * 1.2)
  const anchors: number[] = []
  for (const x of all.map((i) => i.x).sort((a, b) => a - b)) {
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
  return block.map((line) => {
    const cells: string[] = new Array(anchors.length).fill('')
    for (const item of line.items) {
      const c = colOf(item.x)
      cells[c] = cells[c] ? `${cells[c]} ${item.str}` : item.str
    }
    return cells.map((c) => c.trim())
  })
}

/** Lege eindkolommen weghalen en tabellen zonder inhoud afwijzen. */
function tidyGrid(grid: string[][]): string[][] | null {
  const width = Math.max(0, ...grid.map((r) => r.length))
  let last = -1
  for (let c = 0; c < width; c += 1) if (grid.some((r) => (r[c] ?? '').length)) last = c
  const trimmed = grid.map((r) => {
    const row = r.slice(0, last + 1)
    while (row.length < last + 1) row.push('')
    return row
  })
  if (trimmed.length < 2 || (trimmed[0]?.length ?? 0) < 2) return null
  return trimmed
}

/** Analyseert alle pagina's van een document tot een reeks blokken per pagina. */
export async function analyzeDocument(
  group: DocGroup,
  sources: Map<string, SourceFile>,
  options: StructureOptions,
  documentTitle?: string
): Promise<DocumentStructure> {
  const pages: Line[][] = []
  for (const page of group.pages) {
    const source = sources.get(page.sourceId)
    if (!source) {
      pages.push([])
      continue
    }
    const items = await getTextItems(source, page.sourcePageIndex).catch(() => [] as TextItem[])
    pages.push(itemsToLines(items))
  }

  const runningHeads = options.dropRunningHeads ? findRunningHeads(pages) : new Set<string>()

  // Herhaalt de eerste échte regel de documentnaam? Die wordt elders al als
  // titel gebruikt; hem hier weghalen houdt de koppen eronder op niveau 1.
  if (options.dropTitleLine && documentTitle) {
    const wanted = documentTitle.replace(/\.pdf$/i, '').trim().toLowerCase()
    const first = pages[0]?.find((l) => !runningHeads.has(runningKey(l.text)))
    if (first && first.text.trim().toLowerCase() === wanted) {
      pages[0] = pages[0].filter((l) => l !== first)
    }
  }

  const allLines = pages.flat()
  const stats: StructureStats = {
    pages: pages.length,
    pagesWithoutText: pages.filter((p) => !p.length).length,
    headings: 0,
    tables: 0,
    listItems: 0,
    words: allLines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0)
  }
  if (!allLines.length) {
    return { pages: pages.map((_, i) => [noteBlock(i)]), stats }
  }

  const body = bodyFontSize(allLines)
  const headingSizes = [...new Set(allLines.filter((l) => l.size >= body * 1.15).map((l) => Math.round(l.size * 2) / 2))]
    .sort((a, b) => b - a)
    .slice(0, 4)

  // Bladwijzers zijn de betrouwbaarste koppen die een PDF heeft.
  const bookmarkTitles = new Map<string, number>()
  if (options.headings) {
    const marks = await getGroupBookmarks(group, sources).catch(() => [])
    for (const mark of marks) {
      const key = mark.title.trim().toLowerCase()
      if (key) bookmarkTitles.set(key, Math.min(4, mark.depth + 1))
    }
  }

  function headingLevel(line: Line): number | null {
    if (!options.headings) return null
    const fromBookmark = bookmarkTitles.get(line.text.trim().toLowerCase())
    if (fromBookmark) return fromBookmark
    const rounded = Math.round(line.size * 2) / 2
    const index = headingSizes.indexOf(rounded)
    if (index >= 0) return index + 1
    // Korte vette regel zonder eindleesteken: sectiekopje in dezelfde grootte.
    if (line.bold && line.text.length <= 70 && !/[.;:,]$/.test(line.text)) return Math.min(4, headingSizes.length + 1)
    return null
  }

  const result: Block[][] = pages.map((lines, pageIndex) => {
    const blocks: Block[] = []
    if (!lines.length) return [noteBlock(pageIndex)]

    const visible = lines.filter((l) => !runningHeads.has(runningKey(l.text)))
    if (!visible.length) return []
    const leftMargin = Math.min(...visible.map((l) => l.x))
    let paragraph: { text: string; bold: boolean } | null = null
    let list: Extract<Block, { kind: 'list' }> | null = null
    let lastHeading: string | undefined

    const flushParagraph = (): void => {
      if (paragraph) {
        blocks.push({ kind: 'paragraph', text: paragraph.text.replace(/\s+/g, ' ').trim(), bold: paragraph.bold })
        paragraph = null
      }
    }
    const flushList = (): void => {
      if (list) {
        blocks.push(list)
        list = null
      }
    }
    const flushAll = (): void => {
      flushParagraph()
      flushList()
    }

    for (let i = 0; i < visible.length; i += 1) {
      const line = visible[i]

      // --- Tabel: een aaneengesloten blok uitgelijnde regels ---
      if (options.tables && isTabular(line)) {
        const block: Line[] = []
        let j = i
        while (j < visible.length && isTabular(visible[j])) {
          block.push(visible[j])
          j += 1
        }
        const grid = block.length >= 2 ? tidyGrid(blockToGrid(block)) : null
        if (grid) {
          flushAll()
          blocks.push({ kind: 'table', grid, caption: lastHeading })
          stats.tables += 1
          i = j - 1
          continue
        }
      }

      // --- Kop ---
      const level = headingLevel(line)
      if (level) {
        flushAll()
        blocks.push({ kind: 'heading', level, text: line.text })
        lastHeading = line.text
        stats.headings += 1
        continue
      }

      // --- Opsomming ---
      if (options.lists) {
        const shift = line.x - leftMargin
        const step = Math.max(12, body * 2.4)
        const indent = shift > step * 0.8 ? Math.min(3, Math.floor(shift / step) + 1) : 0
        const bullet = BULLET_RE.exec(line.text)
        const ordered = ORDERED_RE.exec(line.text)
        const lettered = LETTER_RE.exec(line.text)
        if (bullet || ordered || lettered) {
          flushParagraph()
          const isOrdered = Boolean(ordered)
          if (!list || list.ordered !== isOrdered) {
            flushList()
            list = { kind: 'list', ordered: isOrdered, items: [] }
          }
          const rest = line.text.replace(bullet ? BULLET_RE : ordered ? ORDERED_RE : LETTER_RE, '')
          list.items.push({ text: rest.trim(), indent, marker: ordered?.[1] })
          stats.listItems += 1
          continue
        }
      }

      // --- Gewone tekst ---
      flushList()
      const previous = visible[i - 1]
      const gap = previous ? previous.y - line.y : 0
      const newParagraph =
        !options.joinParagraphs || !paragraph || gap > line.size * 1.9 || Math.abs(line.x - leftMargin) > body * 2.5
      if (newParagraph) flushParagraph()
      if (!paragraph) {
        paragraph = { text: line.text, bold: line.bold }
      } else if (/-$/.test(paragraph.text)) {
        // Afbreekstreepje aan het regeleinde: woord weer aan elkaar plakken.
        paragraph.text = paragraph.text.replace(/-$/, '') + line.text
        paragraph.bold = paragraph.bold && line.bold
      } else {
        paragraph.text = `${paragraph.text} ${line.text}`
        paragraph.bold = paragraph.bold && line.bold
      }
      if (!options.joinParagraphs) flushParagraph()
    }
    flushAll()
    return blocks
  })

  return { pages: result, stats }
}

function noteBlock(pageIndex: number): Block {
  return { kind: 'note', text: `Pagina ${pageIndex + 1} bevat geen tekstlaag (scan) — voer eerst OCR uit.` }
}
