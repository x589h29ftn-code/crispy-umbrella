import { getTextLineBoxes, type TextLineBox } from './textLines'
import type { PageRef, SourceFile } from '../types'

export type DiffKind = 'added' | 'removed' | 'changed'

export interface DiffLine {
  kind: DiffKind
  /** Regelvak in visuele eenheden op de betreffende pagina. */
  box: { x: number; y: number; width: number; height: number }
  text: string
}

export interface PageDiff {
  /** Gewijzigde/verwijderde regels op de linkerpagina. */
  left: DiffLine[]
  /** Gewijzigde/toegevoegde regels op de rechterpagina. */
  right: DiffLine[]
  changeCount: number
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
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
  return { left: leftOut, right: rightOut, changeCount }
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
  if (!leftPage) return { left: [], right: rightLines.map((l) => ({ kind: 'added' as const, box: l.visual, text: l.str })), changeCount: rightLines.length }
  if (!rightPage) return { left: leftLines.map((l) => ({ kind: 'removed' as const, box: l.visual, text: l.str })), right: [], changeCount: leftLines.length }
  return diffLines(leftLines, rightLines)
}
