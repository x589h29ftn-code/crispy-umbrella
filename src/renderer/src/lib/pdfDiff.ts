import { PDFDocument, rgb } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import fontRegularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url'
import fontBoldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import { getTextLineBoxes, type TextLineBox } from './textLines'
import { getPageVisualSize } from './pdfRender'
import { getGroupBookmarks } from './bookmarks'
import { useStudioStore } from '../store'
import type { DocGroup, SourceFile } from '../types'

export type DiffKind = 'added' | 'removed' | 'changed'

export interface DiffBox {
  x: number
  y: number
  width: number
  height: number
}

export interface DiffLine {
  kind: DiffKind
  /** Regelvak in visuele eenheden op de betreffende pagina. */
  box: DiffBox
  text: string
  /** Regel staat in de kop- of voetmarge én komt op meerdere pagina's voor. */
  head?: boolean
  /** Gezet op de twee regels (links/rechts) die bij dezelfde wijziging horen. */
  pairId?: string
}

/** Een regel waarvan het label gelijk bleef maar een getal veranderde (jaarrekeningen). */
export interface NumberChange {
  /** Regelvak op de rechterpagina (visuele eenheden). */
  box: DiffBox
  /** Regelvak van dezelfde regel op de linkerpagina. */
  boxLeft: DiffBox
  /** De tekst vóór/rond het getal (bv. "Eigen vermogen"). */
  label: string
  from: string
  to: string
  /** Verschil en % mutatie; null als een kant meerdere getallen bevat. */
  delta: number | null
  pct: number | null
  /** De volledige regeltekst rechts — nodig om kop-/voetteksten te herkennen. */
  line: string
  head?: boolean
}

export interface PageDiff {
  /** Gewijzigde/verwijderde regels op de linkerpagina. */
  left: DiffLine[]
  /** Gewijzigde/toegevoegde regels op de rechterpagina. */
  right: DiffLine[]
  changeCount: number
  /** Regels met hetzelfde label maar een gewijzigd bedrag/getal. */
  numbers: NumberChange[]
  /** Paginaformaat (visuele eenheden), zodat markeringen direct geplaatst kunnen worden. */
  leftSize?: { width: number; height: number }
  rightSize?: { width: number; height: number }
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

const NUMBER_RE = /-?\d[\d.  ]*(?:,\d+)?/g

/** Getallen uit een regel als genormaliseerde waarde-strings (punt = decimaal). */
function extractNumbers(str: string): string[] {
  const out: string[] = []
  const matches = str.match(NUMBER_RE)
  if (!matches) return out
  for (const raw of matches) {
    const cleaned = raw.replace(/[.  ]/g, '').replace(',', '.')
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned) && cleaned.replace(/[-.]/g, '').length >= 1) out.push(cleaned)
  }
  return out
}

/** Het label van een regel: de tekst zonder de getallen, genormaliseerd. */
function labelOf(str: string): string {
  return normalize(str.replace(NUMBER_RE, ' ').replace(/[€%.,;:]/g, ' '))
}

/** Waarde van één getal; null zodra de kant meerdere getallen bevat. */
function singleValue(joined: string): number | null {
  if (!joined || joined.includes(' ')) return null
  const n = Number(joined)
  return Number.isFinite(n) ? n : null
}

/**
 * Regels met hetzelfde label waarvan een getal wijzigde. Matcht op labeltekst
 * (bv. "omzet") zodat verschoven regels toch worden herkend — ideaal voor het
 * vergelijken van cijfers in jaarrekeningen.
 */
function numberChanges(left: TextLineBox[], right: TextLineBox[]): NumberChange[] {
  const leftByLabel = new Map<string, TextLineBox>()
  for (const l of left) {
    const label = labelOf(l.str)
    if (label.length >= 3 && extractNumbers(l.str).length && !leftByLabel.has(label)) leftByLabel.set(label, l)
  }
  const changes: NumberChange[] = []
  const usedLabels = new Set<string>()
  for (const r of right) {
    const label = labelOf(r.str)
    if (label.length < 3 || usedLabels.has(label)) continue
    const l = leftByLabel.get(label)
    if (!l) continue
    const from = extractNumbers(l.str)
    const to = extractNumbers(r.str)
    if (!to.length) continue
    if (from.join('|') !== to.join('|')) {
      usedLabels.add(label)
      const fromText = from.join(' ')
      const toText = to.join(' ')
      const fromValue = singleValue(fromText)
      const toValue = singleValue(toText)
      const delta = fromValue !== null && toValue !== null ? Number((toValue - fromValue).toFixed(2)) : null
      const pct = delta !== null && fromValue ? Math.round((delta / Math.abs(fromValue)) * 1000) / 10 : null
      changes.push({
        box: r.visual,
        boxLeft: l.visual,
        label: r.str.replace(NUMBER_RE, '').replace(/\s+/g, ' ').trim() || label,
        from: fromText,
        to: toText,
        delta,
        pct,
        line: r.str
      })
    }
  }
  return changes
}

/**
 * Regel-gebaseerde diff (LCS) tussen twee pagina's: regels die alleen links
 * bestaan zijn "verwijderd", alleen rechts "toegevoegd"; een verwijderde regel
 * gevolgd door een toegevoegde regel op dezelfde plek geldt als "gewijzigd".
 */
function diffLines(left: TextLineBox[], right: TextLineBox[]): PageDiff {
  const a = left.map((l) => normalize(l.str))
  const b = right.map((l) => normalize(l.str))
  const n = a.length
  const m = b.length
  // LCS-tabel.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const leftOut: DiffLine[] = []
  const rightOut: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      leftOut.push({ kind: 'removed', box: left[i].visual, text: left[i].str })
      i += 1
    } else {
      rightOut.push({ kind: 'added', box: right[j].visual, text: right[j].str })
      j += 1
    }
  }
  while (i < n) {
    leftOut.push({ kind: 'removed', box: left[i].visual, text: left[i].str })
    i += 1
  }
  while (j < m) {
    rightOut.push({ kind: 'added', box: right[j].visual, text: right[j].str })
    j += 1
  }
  // Verwijderd + toegevoegd die (ongeveer) op dezelfde hoogte staan → gewijzigd.
  let pair = 0
  for (const l of leftOut) {
    const match = rightOut.find(
      (r) => r.kind === 'added' && !r.pairId && Math.abs(r.box.y - l.box.y) < Math.max(l.box.height, r.box.height)
    )
    if (match) {
      const id = `p${pair}`
      pair += 1
      l.kind = 'changed'
      l.pairId = id
      match.kind = 'changed'
      match.pairId = id
    }
  }
  const changeCount = new Set([...leftOut, ...rightOut].map((d) => Math.round(d.box.y))).size
  return { left: leftOut, right: rightOut, changeCount, numbers: numberChanges(left, right) }
}

// ---------------------------------------------------------------------------
// Documentbrede vergelijking: één lijst wijzigingen om door te lopen,
// samen te vatten en te filteren (zoals het verschilpaneel van Acrobat).
// ---------------------------------------------------------------------------

export type ChangeKind = 'changed' | 'added' | 'removed' | 'number' | 'page-added' | 'page-removed'

export interface ChangeEntry {
  id: string
  /** Nulgebaseerde index van het paginapaar. */
  page: number
  kind: ChangeKind
  /** Staat in een kop-/voettekst die op meerdere pagina's terugkomt. */
  head: boolean
  /** Vak om te markeren op de linker- resp. rechterpagina. */
  left?: DiffBox
  right?: DiffBox
  /** Tekst zoals hij was / zoals hij nu is. */
  before?: string
  after?: string
  /** Alleen bij 'number': omschrijving, oude/nieuwe waarde en de mutatie. */
  label?: string
  from?: string
  to?: string
  delta?: number | null
  pct?: number | null
}

export interface DocumentDiff {
  pages: PageDiff[]
  changes: ChangeEntry[]
  pageCount: { left: number; right: number }
  /** Vergelijking is afgebroken (venster gesloten of documenten gewisseld). */
  cancelled: boolean
}

export interface DiffProgress {
  done: number
  total: number
}

interface SidePage {
  lines: TextLineBox[]
  size: { width: number; height: number } | null
}

async function extractSide(
  group: DocGroup | undefined,
  index: number,
  sources: Map<string, SourceFile>
): Promise<SidePage | null> {
  const page = group?.pages[index]
  if (!page) return null
  const source = sources.get(page.sourceId)
  if (!source) return null
  const [lines, size] = await Promise.all([
    getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [] as TextLineBox[]),
    getPageVisualSize(source, page.sourcePageIndex, page.rotation).catch(() => null)
  ])
  return { lines, size }
}

/** Staat de regel in de bovenste/onderste 12% van de pagina? */
function inMargin(box: DiffBox, height: number | undefined): boolean {
  if (!height) return false
  return box.y < height * 0.12 || box.y + box.height > height * 0.88
}

/** Sleutel waarbij cijfers wegvallen, zodat "pagina 3 van 48" op elke pagina gelijk is. */
function headKey(str: string): string {
  return normalize(str).replace(/\d+/g, '#')
}

/**
 * Tekst die in de marge staat én op minstens 40% van de pagina's terugkomt is
 * een kop-/voettekst. Dat filtert de ruis weg (paginanummers, kantoornaam,
 * bestandsnaam) die anders elke pagina als "gewijzigd" laat oplichten.
 */
function runningHeadKeys(sides: (SidePage | null)[]): Set<string> {
  const filled = sides.filter((s): s is SidePage => Boolean(s))
  const hits = new Map<string, number>()
  for (const side of filled) {
    const seen = new Set<string>()
    for (const line of side.lines) {
      if (!inMargin(line.visual, side.size?.height)) continue
      const key = headKey(line.str)
      if (key.length < 2 || seen.has(key)) continue
      seen.add(key)
      hits.set(key, (hits.get(key) ?? 0) + 1)
    }
  }
  const threshold = Math.max(2, Math.ceil(filled.length * 0.4))
  return new Set([...hits].filter(([, n]) => n >= threshold).map(([key]) => key))
}

/**
 * Vergelijkt twee documenten volledig: per paginapaar de verschillen én één
 * doorlopende lijst wijzigingen om langs te navigeren. `onProgress` houdt de
 * balk in beeld bij lange documenten; `isCancelled` stopt netjes halverwege.
 */
export async function diffDocuments(
  left: DocGroup,
  right: DocGroup,
  sources: Map<string, SourceFile>,
  onProgress?: (p: DiffProgress) => void,
  isCancelled?: () => boolean
): Promise<DocumentDiff> {
  const total = Math.max(left.pages.length, right.pages.length)
  const leftSides: (SidePage | null)[] = []
  const rightSides: (SidePage | null)[] = []
  let cancelled = false
  for (let i = 0; i < total; i += 1) {
    if (isCancelled?.()) {
      cancelled = true
      break
    }
    const [l, r] = await Promise.all([extractSide(left, i, sources), extractSide(right, i, sources)])
    leftSides.push(l)
    rightSides.push(r)
    onProgress?.({ done: i + 1, total })
  }

  const leftHeads = runningHeadKeys(leftSides)
  const rightHeads = runningHeadKeys(rightSides)

  const pages: PageDiff[] = []
  const changes: ChangeEntry[] = []

  for (let i = 0; i < leftSides.length; i += 1) {
    const l = leftSides[i]
    const r = rightSides[i]
    const isHead = (text: string, box: DiffBox, side: SidePage | null, keys: Set<string>): boolean =>
      inMargin(box, side?.size?.height) && keys.has(headKey(text))

    let diff: PageDiff
    if (l && r) {
      diff = diffLines(l.lines, r.lines)
      for (const line of diff.left) line.head = isHead(line.text, line.box, l, leftHeads)
      for (const line of diff.right) line.head = isHead(line.text, line.box, r, rightHeads)
      for (const num of diff.numbers) num.head = isHead(num.line, num.box, r, rightHeads)
    } else if (r) {
      diff = { left: [], right: [], changeCount: 1, numbers: [] }
      changes.push({ id: `${i}-pageadd`, page: i, kind: 'page-added', head: false, after: `Pagina ${i + 1}` })
    } else if (l) {
      diff = { left: [], right: [], changeCount: 1, numbers: [] }
      changes.push({ id: `${i}-pagedel`, page: i, kind: 'page-removed', head: false, before: `Pagina ${i + 1}` })
    } else {
      diff = { left: [], right: [], changeCount: 0, numbers: [] }
    }
    diff.leftSize = l?.size ?? undefined
    diff.rightSize = r?.size ?? undefined
    pages.push(diff)

    if (!l || !r) continue

    // Een regel waarvan alleen het bedrag wijzigde staat al als cijferwijziging
    // in de lijst; dan hoeft dezelfde regel er niet óók als tekstwijziging bij.
    const numberBoxes = new Set<DiffBox>()
    for (const num of diff.numbers) {
      numberBoxes.add(num.box)
      numberBoxes.add(num.boxLeft)
    }

    // Gewijzigd: de twee gekoppelde regels als één wijziging (oud → nieuw).
    const pairedLeft = new Map(diff.left.filter((d) => d.pairId).map((d) => [d.pairId!, d]))
    let seq = 0
    for (const line of diff.right) {
      if (line.kind !== 'changed' || !line.pairId) continue
      if (numberBoxes.has(line.box)) continue
      const partner = pairedLeft.get(line.pairId)
      changes.push({
        id: `${i}-c${seq}`,
        page: i,
        kind: 'changed',
        head: Boolean(line.head) || Boolean(partner?.head),
        left: partner?.box,
        right: line.box,
        before: partner?.text,
        after: line.text
      })
      seq += 1
    }
    for (const line of diff.right) {
      if (line.kind !== 'added' || numberBoxes.has(line.box)) continue
      changes.push({ id: `${i}-a${seq}`, page: i, kind: 'added', head: Boolean(line.head), right: line.box, after: line.text })
      seq += 1
    }
    for (const line of diff.left) {
      if (line.kind !== 'removed' || numberBoxes.has(line.box)) continue
      changes.push({ id: `${i}-r${seq}`, page: i, kind: 'removed', head: Boolean(line.head), left: line.box, before: line.text })
      seq += 1
    }
    for (const num of diff.numbers) {
      changes.push({
        id: `${i}-n${seq}`,
        page: i,
        kind: 'number',
        head: Boolean(num.head),
        left: num.boxLeft,
        right: num.box,
        label: num.label,
        from: num.from,
        to: num.to,
        delta: num.delta,
        pct: num.pct
      })
      seq += 1
    }
  }

  // Op paginanummer en daarna op positie op de pagina, zodat de lijst de
  // leesrichting volgt in plaats van de soort wijziging.
  changes.sort((a, b) => a.page - b.page || (a.right?.y ?? a.left?.y ?? 0) - (b.right?.y ?? b.left?.y ?? 0))

  return {
    pages,
    changes,
    pageCount: { left: left.pages.length, right: right.pages.length },
    cancelled
  }
}

export interface DiffFilter {
  changed: boolean
  added: boolean
  removed: boolean
  numbers: boolean
  /** Kop-/voetteksten (paginanummers, kantoornaam) buiten beschouwing laten. */
  ignoreHeads: boolean
  /** Alleen cijferwijzigingen vanaf dit absolute verschil (0 = alles). */
  minAmount: number
  /** Alleen cijferwijzigingen vanaf deze mutatie in % (0 = alles). */
  minPercent: number
}

export const DEFAULT_DIFF_FILTER: DiffFilter = {
  changed: true,
  added: true,
  removed: true,
  numbers: true,
  ignoreHeads: true,
  minAmount: 0,
  minPercent: 0
}

/** Alleen de cijferwijzigingen — de "cijfermodus" van het verschilpaneel. */
export const NUMBERS_ONLY_FILTER: DiffFilter = {
  ...DEFAULT_DIFF_FILTER,
  changed: false,
  added: false,
  removed: false,
  numbers: true
}

export function filterChanges(changes: ChangeEntry[], filter: DiffFilter): ChangeEntry[] {
  return changes.filter((c) => {
    if (filter.ignoreHeads && c.head) return false
    if (c.kind === 'changed') return filter.changed
    if (c.kind === 'added' || c.kind === 'page-added') return filter.added
    if (c.kind === 'removed' || c.kind === 'page-removed') return filter.removed
    if (!filter.numbers) return false
    if (filter.minAmount > 0 && (c.delta === null || c.delta === undefined || Math.abs(c.delta) < filter.minAmount)) {
      return false
    }
    if (filter.minPercent > 0 && (c.pct === null || c.pct === undefined || Math.abs(c.pct) < filter.minPercent)) {
      return false
    }
    return true
  })
}

export interface DiffSummary {
  total: number
  changed: number
  added: number
  removed: number
  numbers: number
  pagesAdded: number
  pagesRemoved: number
  /** Aantal wijzigingen in een kop-/voettekst (los geteld, meestal ruis). */
  heads: number
}

export function summarizeChanges(changes: ChangeEntry[]): DiffSummary {
  const sum: DiffSummary = {
    total: changes.length,
    changed: 0,
    added: 0,
    removed: 0,
    numbers: 0,
    pagesAdded: 0,
    pagesRemoved: 0,
    heads: 0
  }
  for (const c of changes) {
    if (c.head) sum.heads += 1
    if (c.kind === 'changed') sum.changed += 1
    else if (c.kind === 'added') sum.added += 1
    else if (c.kind === 'removed') sum.removed += 1
    else if (c.kind === 'number') sum.numbers += 1
    else if (c.kind === 'page-added') sum.pagesAdded += 1
    else if (c.kind === 'page-removed') sum.pagesRemoved += 1
  }
  return sum
}

/** Nederlandse weergave van een getal uit de vergelijking (punt = duizend, komma = decimaal). */
export function formatDiffNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  const decimals = Math.abs(n % 1) > 0.0001 ? 2 : 0
  return n.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

interface ReportPageDiff {
  pageNumber: number
  notes: string[]
  removed: string[]
  added: string[]
  changedOld: string[]
  changedNew: string[]
  numbers: { label: string; from: string; to: string; delta: number | null; pct: number | null }[]
}
interface ReportChapter {
  title: string
  pages: ReportPageDiff[]
}

/** Deelt de rechterpagina's op in hoofdstukken op basis van de bladwijzers (inhoudsopgave). */
async function chaptersFor(right: DocGroup, sources: Map<string, SourceFile>): Promise<{ title: string; start: number }[]> {
  const bms = await getGroupBookmarks(right, sources).catch(() => [])
  const idxOf = new Map(right.pages.map((p, i) => [p.id, i]))
  const cuts = bms
    .filter((b) => b.depth === 0 && idxOf.has(b.pageId))
    .map((b) => ({ title: b.title, start: idxOf.get(b.pageId)! }))
    .sort((a, b) => a.start - b.start)
  if (!cuts.length || cuts[0].start > 0) cuts.unshift({ title: 'Document', start: 0 })
  return cuts
}

/**
 * Genereert een overzichtelijk verschilrapport-PDF: een inhoudsopgave gevolgd
 * door de verschillen per hoofdstuk/sectie, met paginanummers, de oorspronkelijke
 * en de gewijzigde tekst, en de wijziging geel gemarkeerd. Werkt op de lijst
 * wijzigingen zoals die in beeld staat, dus de gekozen filters gelden ook hier.
 */
export async function exportDiffReport(
  left: DocGroup,
  right: DocGroup,
  sources: Map<string, SourceFile>,
  changes: ChangeEntry[]
): Promise<void> {
  const state = useStudioStore.getState()
  try {
    // 1) Wijzigingen per pagina bundelen en per hoofdstuk groeperen.
    const cuts = await chaptersFor(right, sources)
    const chapterAt = (pageIdx: number): number => {
      let c = 0
      for (let k = 0; k < cuts.length; k += 1) if (pageIdx >= cuts[k].start) c = k
      return c
    }
    const chapters: ReportChapter[] = cuts.map((c) => ({ title: c.title, pages: [] }))
    const perPage = new Map<number, ReportPageDiff>()
    for (const c of changes) {
      let pd = perPage.get(c.page)
      if (!pd) {
        pd = { pageNumber: c.page + 1, notes: [], removed: [], added: [], changedOld: [], changedNew: [], numbers: [] }
        perPage.set(c.page, pd)
        chapters[chapterAt(c.page)].pages.push(pd)
      }
      if (c.kind === 'changed') {
        pd.changedOld.push(c.before ?? '')
        pd.changedNew.push(c.after ?? '')
      } else if (c.kind === 'added') pd.added.push(c.after ?? '')
      else if (c.kind === 'removed') pd.removed.push(c.before ?? '')
      else if (c.kind === 'number')
        pd.numbers.push({ label: c.label ?? '', from: c.from ?? '', to: c.to ?? '', delta: c.delta ?? null, pct: c.pct ?? null })
      else if (c.kind === 'page-added') pd.notes.push('Deze pagina is toegevoegd')
      else if (c.kind === 'page-removed') pd.notes.push('Deze pagina is verwijderd')
    }
    for (const ch of chapters) ch.pages.sort((a, b) => a.pageNumber - b.pageNumber)
    const changedChapters = chapters.filter((c) => c.pages.length)
    const total = changes.length

    // 2) PDF opbouwen.
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const [rb, bb] = await Promise.all([fontRegularUrl, fontBoldUrl].map((u) => fetch(u).then((r) => r.arrayBuffer())))
    const regular = await doc.embedFont(rb, { subset: true })
    const bold = await doc.embedFont(bb, { subset: true })
    const W = 595.28
    const H = 841.89
    const M = 56
    const ink = rgb(0.13, 0.15, 0.19)
    const dim = rgb(0.45, 0.48, 0.54)
    const red = rgb(0.72, 0.15, 0.15)
    const green = rgb(0.1, 0.5, 0.22)
    const amber = rgb(0.72, 0.5, 0.05)
    // Alleen tekst mag geen rare tekens bevatten die het subset-font niet kent.
    const clean = (s: string): string => s.replace(/[→⇒]/g, '->').replace(/[^\x09\x0A\x0D\x20-￿]/g, '')

    let page = doc.addPage([W, H])
    let y = H - M
    const ensure = (need: number): void => {
      if (y - need < M) {
        page = doc.addPage([W, H])
        y = H - M
      }
    }
    // Schrijft een (afbrekende) regel; met een optionele gekleurde balk links
    // (rood = verwijderd, groen = toegevoegd, geel = gewijzigd) i.p.v. een vlak.
    const write = (
      text: string,
      opts: { font?: typeof regular; size?: number; color?: typeof ink; indent?: number; bar?: typeof ink } = {}
    ): void => {
      const font = opts.font ?? regular
      const size = opts.size ?? 10.5
      const color = opts.color ?? ink
      const indent = opts.indent ?? 0
      const maxW = W - M * 2 - indent
      const words = clean(text).split(/\s+/)
      let cur = ''
      const flush = (): void => {
        ensure(size + 4)
        if (opts.bar) page.drawRectangle({ x: M + indent - 8, y: y - size, width: 2.5, height: size + 2, color: opts.bar })
        page.drawText(cur, { x: M + indent, y: y - size, size, font, color })
        y -= size + 4
      }
      for (const w of words) {
        const cand = cur ? `${cur} ${w}` : w
        if (font.widthOfTextAtSize(cand, size) > maxW && cur) {
          flush()
          cur = w
        } else cur = cand
      }
      if (cur) flush()
    }
    // Kleine sectiekop met gekleurd bolletje ("Verwijderd" / "Toegevoegd" / ...).
    const sectionTag = (label: string, color: typeof ink): void => {
      ensure(16)
      page.drawRectangle({ x: M + 4, y: y - 10, width: 8, height: 8, color })
      page.drawText(label, { x: M + 18, y: y - 10, size: 9.5, font: bold, color })
      y -= 16
    }

    // Cover.
    page.drawText('Verschilrapport', { x: M, y: y - 26, size: 26, font: bold, color: ink })
    y -= 46
    write(`${left.name}   →   ${right.name}`, { size: 12, color: dim })
    write(
      `${total} wijziging${total === 1 ? '' : 'en'} in ${changedChapters.length} hoofdstuk${changedChapters.length === 1 ? '' : 'ken'}`,
      { size: 11, color: dim }
    )
    y -= 14
    // Legenda met de kleurcodering.
    write('Legenda', { font: bold, size: 11 })
    y -= 2
    sectionTag('Verwijderd (oude tekst)', red)
    sectionTag('Toegevoegd (nieuwe tekst)', green)
    sectionTag('Gewijzigd / gewijzigd bedrag', amber)
    y -= 14

    // Inhoudsopgave (paginanummers worden na de opbouw ingevuld).
    ensure(30)
    page.drawText('Inhoud', { x: M, y: y - 16, size: 16, font: bold, color: ink })
    y -= 30
    const tocSlots: { title: string; count: number; page: typeof page; y: number }[] = []
    if (!changedChapters.length) {
      write('Geen verschillen gevonden — de documenten zijn gelijk.', { size: 11, color: dim })
    }
    for (const ch of changedChapters) {
      const count = ch.pages.reduce(
        (n, p) => n + p.removed.length + p.added.length + Math.max(p.changedOld.length, p.changedNew.length) + p.numbers.length + p.notes.length,
        0
      )
      ensure(18)
      tocSlots.push({ title: ch.title, count, page, y })
      y -= 18
    }
    y -= 10

    // Per hoofdstuk de verschillen, en onthoud op welke rapportpagina het begint.
    const chapterStartPage = new Map<string, number>()
    const pageIndexOf = new Map<typeof page, number>()
    doc.getPages().forEach((p, idx) => pageIndexOf.set(p, idx))
    for (const ch of changedChapters) {
      ensure(44)
      pageIndexOf.clear()
      doc.getPages().forEach((p, idx) => pageIndexOf.set(p, idx))
      chapterStartPage.set(ch.title, (pageIndexOf.get(page) ?? 0) + 1)
      page.drawText(clean(ch.title), { x: M, y: y - 15, size: 15, font: bold, color: ink })
      y -= 8
      page.drawRectangle({ x: M, y: y - 2, width: W - M * 2, height: 1.5, color: rgb(0.85, 0.87, 0.9) })
      y -= 18
      for (const pd of ch.pages) {
        ensure(30)
        write(`Pagina ${pd.pageNumber}`, { font: bold, size: 11.5, color: rgb(0.1, 0.12, 0.16) })
        y -= 2
        for (const note of pd.notes) write(note, { size: 10, color: amber, indent: 8, bar: amber })
        // Gewijzigde regels: oude tekst (rood) met daaronder de nieuwe tekst (groen).
        const pairs = Math.max(pd.changedOld.length, pd.changedNew.length)
        if (pairs) {
          sectionTag('Gewijzigd', amber)
          for (let k = 0; k < pairs; k += 1) {
            if (pd.changedOld[k]) write(`Oud:    ${pd.changedOld[k]}`, { size: 9.5, color: red, indent: 8, bar: red })
            if (pd.changedNew[k]) write(`Nieuw:  ${pd.changedNew[k]}`, { size: 9.5, color: green, indent: 8, bar: green })
            y -= 3
          }
        }
        if (pd.removed.length) {
          sectionTag('Verwijderd', red)
          for (const t of pd.removed) write(t, { size: 9.5, color: red, indent: 8, bar: red })
        }
        if (pd.added.length) {
          sectionTag('Toegevoegd', green)
          for (const t of pd.added) write(t, { size: 9.5, color: green, indent: 8, bar: green })
        }
        if (pd.numbers.length) {
          sectionTag('Gewijzigd bedrag', amber)
          for (const nc of pd.numbers) {
            const mutation =
              nc.delta !== null
                ? `   (${nc.delta > 0 ? '+' : ''}${formatDiffNumber(nc.delta)}${nc.pct !== null ? `, ${nc.pct > 0 ? '+' : ''}${nc.pct}%` : ''})`
                : ''
            write(`${nc.label}:   ${formatDiffNumber(nc.from)}   →   ${formatDiffNumber(nc.to)}${mutation}`, {
              font: bold,
              size: 10,
              color: amber,
              indent: 8,
              bar: amber
            })
          }
        }
        y -= 8
      }
      y -= 10
    }

    // Inhoudsopgave-paginanummers invullen.
    for (const slot of tocSlots) {
      const p = chapterStartPage.get(slot.title)
      slot.page.drawText(slot.title, { x: M, y: slot.y - 12, size: 11, font: regular, color: ink, maxWidth: W - M * 2 - 90 })
      slot.page.drawText(`${slot.count}×`, { x: W - M - 78, y: slot.y - 12, size: 10, font: regular, color: dim })
      if (p) slot.page.drawText(`p. ${p}`, { x: W - M - 34, y: slot.y - 12, size: 11, font: bold, color: ink })
    }

    const bytes = await doc.save()
    const result = await window.api.savePdf('Verschilrapport.pdf', bytes)
    if (result.saved) state.addToast('success', 'Verschilrapport opgeslagen')
  } catch {
    state.addToast('error', 'Verschilrapport maken is mislukt')
  }
}
