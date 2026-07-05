import { PDFDocument, rgb } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import fontRegularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url'
import fontBoldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import { getTextLineBoxes, type TextLineBox } from './textLines'
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

/** Genereert een verschilrapport-PDF tussen twee documenten en biedt het aan om op te slaan. */
export async function exportDiffReport(left: DocGroup, right: DocGroup, sources: Map<string, SourceFile>): Promise<void> {
  const state = useStudioStore.getState()
  try {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const [rb, bb] = await Promise.all([fontRegularUrl, fontBoldUrl].map((u) => fetch(u).then((r) => r.arrayBuffer())))
    const regular = await doc.embedFont(rb, { subset: true })
    const bold = await doc.embedFont(bb, { subset: true })
    const W = 595.28
    const H = 841.89
    const M = 56
    let page = doc.addPage([W, H])
    let y = H - M
    const write = (text: string, font = regular, size = 10.5, color = rgb(0.13, 0.15, 0.19), indent = 0): void => {
      const maxW = W - M * 2 - indent
      const words = text.split(/\s+/)
      let cur = ''
      const flush = (): void => {
        if (y - size < M) {
          page = doc.addPage([W, H])
          y = H - M
        }
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
      else {
        y -= size + 4
      }
    }
    write('Verschilrapport', bold, 20)
    write(`${left.name}  ↔  ${right.name}`, regular, 11, rgb(0.45, 0.48, 0.54))
    y -= 8
    const maxPages = Math.max(left.pages.length, right.pages.length)
    let total = 0
    for (let i = 0; i < maxPages; i += 1) {
      const lp = left.pages[i]
      const rp = right.pages[i]
      const diff = await diffPages(lp ? sources.get(lp.sourceId) : undefined, lp, rp ? sources.get(rp.sourceId) : undefined, rp)
      if (!diff.left.length && !diff.right.length) continue
      total += diff.changeCount
      write(`Pagina ${i + 1} — ${diff.changeCount} wijziging${diff.changeCount === 1 ? '' : 'en'}`, bold, 13, rgb(0.1, 0.12, 0.16))
      for (const d of diff.left) {
        if (d.kind === 'removed') write(`− ${d.text}`, regular, 10, rgb(0.7, 0.15, 0.15), 6)
      }
      for (const d of diff.right) {
        if (d.kind === 'added') write(`+ ${d.text}`, regular, 10, rgb(0.13, 0.5, 0.2), 6)
      }
      for (const d of diff.left) {
        if (d.kind === 'changed') write(`~ ${d.text}`, regular, 10, rgb(0.72, 0.45, 0.05), 6)
      }
      for (const nc of diff.numbers) {
        write(`€ ${nc.label}: ${nc.from} → ${nc.to}`, bold, 10, rgb(0.13, 0.3, 0.6), 6)
      }
      y -= 6
    }
    if (total === 0) write('Geen tekstverschillen gevonden.', regular, 11)
    const bytes = await doc.save()
    const result = await window.api.savePdf('Verschilrapport.pdf', bytes)
    if (result.saved) state.addToast('success', 'Verschilrapport opgeslagen')
  } catch {
    state.addToast('error', 'Verschilrapport maken is mislukt')
  }
}
