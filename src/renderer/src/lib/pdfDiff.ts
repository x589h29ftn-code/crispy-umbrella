import { PDFDocument, rgb } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import fontRegularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url'
import fontBoldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import { getTextLineBoxes, type TextLineBox } from './textLines'
import { getGroupBookmarks } from './bookmarks'
import { useStudioStore } from '../store'
import type { DocGroup, PageRef, SourceFile } from '../types'

export type DiffKind = 'added' | 'removed' | 'changed'

export interface DiffLine {
  kind: DiffKind
  /** Regelvak in visuele eenheden op de betreffende pagina. */
  box: { x: number; y: number; width: number; height: number }
  text: string
}

/** Een regel waarvan het label gelijk bleef maar een getal veranderde (jaarrekeningen). */
export interface NumberChange {
  /** Regelvak op de rechterpagina (visuele eenheden). */
  box: { x: number; y: number; width: number; height: number }
  /** De tekst vóór/rond het getal (bv. "Eigen vermogen"). */
  label: string
  from: string
  to: string
}

export interface PageDiff {
  /** Gewijzigde/verwijderde regels op de linkerpagina. */
  left: DiffLine[]
  /** Gewijzigde/toegevoegde regels op de rechterpagina. */
  right: DiffLine[]
  changeCount: number
  /** Regels met hetzelfde label maar een gewijzigd bedrag/getal. */
  numbers: NumberChange[]
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

const NUMBER_RE = /-?\d[\d.  ]*(?:,\d+)?/g

/** Getallen uit een regel als genormaliseerde waarde-strings (punt = decimaal). */
function extractNumbers(str: string): string[] {
  const out: string[] = []
  const matches = str.match(NUMBER_RE)
  if (!matches) return out
  for (const raw of matches) {
    const cleaned = raw.replace(/[.  ]/g, '').replace(',', '.')
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned) && cleaned.replace(/[-.]/g, '').length >= 1) out.push(cleaned)
  }
  return out
}

/** Het label van een regel: de tekst zonder de getallen, genormaliseerd. */
function labelOf(str: string): string {
  return normalize(str.replace(NUMBER_RE, ' ').replace(/[€%.,;:]/g, ' '))
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
      changes.push({ box: r.visual, label: r.str.replace(NUMBER_RE, '').replace(/\s+/g, ' ').trim() || label, from: from.join(' '), to: to.join(' ') })
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
  for (const l of leftOut) {
    const match = rightOut.find(
      (r) => r.kind === 'added' && Math.abs(r.box.y - l.box.y) < Math.max(l.box.height, r.box.height)
    )
    if (match) {
      l.kind = 'changed'
      match.kind = 'changed'
    }
  }
  const changeCount = new Set([...leftOut, ...rightOut].map((d) => Math.round(d.box.y))).size
  return { left: leftOut, right: rightOut, changeCount, numbers: numberChanges(left, right) }
}

/** Berekent de tekstverschillen tussen twee pagina's (of alleen één kant als de ander ontbreekt). */
export async function diffPages(
  leftSource: SourceFile | undefined,
  leftPage: PageRef | undefined,
  rightSource: SourceFile | undefined,
  rightPage: PageRef | undefined
): Promise<PageDiff> {
  const leftLines =
    leftSource && leftPage
      ? await getTextLineBoxes(leftSource, leftPage.sourcePageIndex, leftPage.rotation).catch(() => [])
      : []
  const rightLines =
    rightSource && rightPage
      ? await getTextLineBoxes(rightSource, rightPage.sourcePageIndex, rightPage.rotation).catch(() => [])
      : []
  if (!leftPage) return { left: [], right: rightLines.map((l) => ({ kind: 'added' as const, box: l.visual, text: l.str })), changeCount: rightLines.length, numbers: [] }
  if (!rightPage) return { left: leftLines.map((l) => ({ kind: 'removed' as const, box: l.visual, text: l.str })), right: [], changeCount: leftLines.length, numbers: [] }
  return diffLines(leftLines, rightLines)
}

interface ReportPageDiff {
  pageNumber: number
  removed: string[]
  added: string[]
  changedOld: string[]
  changedNew: string[]
  numbers: NumberChange[]
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
 * en de gewijzigde tekst, en de wijziging geel gemarkeerd.
 */
export async function exportDiffReport(left: DocGroup, right: DocGroup, sources: Map<string, SourceFile>): Promise<void> {
  const state = useStudioStore.getState()
  try {
    // 1) Verschillen per pagina berekenen en per hoofdstuk groeperen.
    const cuts = await chaptersFor(right, sources)
    const chapterAt = (pageIdx: number): number => {
      let c = 0
      for (let k = 0; k < cuts.length; k += 1) if (pageIdx >= cuts[k].start) c = k
      return c
    }
    const chapters: ReportChapter[] = cuts.map((c) => ({ title: c.title, pages: [] }))
    const maxPages = Math.max(left.pages.length, right.pages.length)
    let total = 0
    for (let i = 0; i < maxPages; i += 1) {
      const lp = left.pages[i]
      const rp = right.pages[i]
      const diff = await diffPages(lp ? sources.get(lp.sourceId) : undefined, lp, rp ? sources.get(rp.sourceId) : undefined, rp)
      if (!diff.left.length && !diff.right.length && !diff.numbers.length) continue
      total += diff.changeCount + diff.numbers.length
      chapters[chapterAt(i)].pages.push({
        pageNumber: i + 1,
        removed: diff.left.filter((d) => d.kind === 'removed').map((d) => d.text),
        added: diff.right.filter((d) => d.kind === 'added').map((d) => d.text),
        changedOld: diff.left.filter((d) => d.kind === 'changed').map((d) => d.text),
        changedNew: diff.right.filter((d) => d.kind === 'changed').map((d) => d.text),
        numbers: diff.numbers
      })
    }
    const changedChapters = chapters.filter((c) => c.pages.length)

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
      const changes = ch.pages.reduce(
        (n, p) => n + p.removed.length + p.added.length + Math.max(p.changedOld.length, p.changedNew.length) + p.numbers.length,
        0
      )
      ensure(18)
      tocSlots.push({ title: ch.title, count: changes, page, y })
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
            write(`${nc.label}:   ${nc.from}   →   ${nc.to}`, { font: bold, size: 10, color: amber, indent: 8, bar: amber })
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
