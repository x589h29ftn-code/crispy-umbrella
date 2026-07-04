import { PDFDocument, PDFFont, rgb } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import fontRegularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url'
import fontBoldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import { useStudioStore } from '../store'
import { formatCommentTime } from '../components/Lightbox'
import type { DocGroup } from '../types'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 56
const BODY_SIZE = 10.5
const LINE_GAP = 4

/** Splits text into lines that fit the given width (wraps on words, hard-breaks long words). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const words = rawLine.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      // A single word wider than the column is broken mid-word.
      let piece = ''
      for (const char of word) {
        if (font.widthOfTextAtSize(piece + char, size) > maxWidth && piece) {
          lines.push(piece)
          piece = char
        } else {
          piece += char
        }
      }
      current = piece
    }
    if (current) lines.push(current)
  }
  return lines
}

/**
 * Builds a standalone overview PDF of every comment (grouped per document,
 * in page order) with author, time, replies and status — handy to send along
 * with the reviewed piece or archive with the dossier.
 */
export async function buildCommentSummaryPdf(groups: DocGroup[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const [regularBytes, boldBytes] = await Promise.all(
    [fontRegularUrl, fontBoldUrl].map((url) => fetch(url).then((res) => res.arrayBuffer()))
  )
  const regular = await doc.embedFont(regularBytes, { subset: true })
  const bold = await doc.embedFont(boldBytes, { subset: true })

  const ink = rgb(0.13, 0.15, 0.19)
  const muted = rgb(0.45, 0.48, 0.54)
  const accent = rgb(0.23, 0.45, 0.85)
  const contentWidth = PAGE_WIDTH - MARGIN * 2

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  function ensureRoom(needed: number): void {
    if (y - needed >= MARGIN) return
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = PAGE_HEIGHT - MARGIN
  }

  function drawLines(text: string, font: PDFFont, size: number, color = ink, indent = 0): void {
    const lines = wrapText(text, font, size, contentWidth - indent)
    for (const line of lines) {
      ensureRoom(size + LINE_GAP)
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color })
      y -= size + LINE_GAP
    }
  }

  drawLines('Overzicht opmerkingen', bold, 20)
  y -= 6
  const totals = groups.flatMap((g) => g.pages.flatMap((p) => p.comments))
  const openCount = totals.filter((c) => !c.resolved).length
  drawLines(
    `${totals.length} ${totals.length === 1 ? 'opmerking' : 'opmerkingen'} · ${openCount} open · ${totals.length - openCount} afgehandeld`,
    regular,
    BODY_SIZE,
    muted
  )
  y -= 12

  for (const group of groups) {
    const entries = group.pages.flatMap((p, pageIndex) => p.comments.map((comment) => ({ comment, pageIndex })))
    if (!entries.length) continue

    ensureRoom(40)
    drawLines(group.name, bold, 14)
    y -= 4

    for (const { comment, pageIndex } of entries) {
      ensureRoom(48)
      const author = comment.author?.trim() || 'Onbekend'
      const status = comment.resolved ? '  ·  afgehandeld' : ''
      drawLines(`Pagina ${pageIndex + 1}  ·  ${author}  ·  ${formatCommentTime(comment.createdAt)}${status}`, bold, BODY_SIZE, accent)
      drawLines(comment.text || '(geen tekst)', regular, BODY_SIZE, ink)
      for (const reply of comment.replies) {
        const replyAuthor = reply.author?.trim() || 'Onbekend'
        drawLines(`${replyAuthor}  ·  ${formatCommentTime(reply.createdAt)}`, bold, BODY_SIZE - 0.5, muted, 18)
        drawLines(reply.text, regular, BODY_SIZE - 0.5, ink, 18)
      }
      y -= 10
    }
    y -= 8
  }

  const bytes = await doc.save()
  return bytes
}

/** Generates the comment overview and offers it via the native save dialog. */
export async function exportCommentSummary(): Promise<void> {
  const state = useStudioStore.getState()
  const hasComments = state.groups.some((g) => g.pages.some((p) => p.comments.length))
  if (!hasComments) {
    state.addToast('info', 'Er zijn nog geen opmerkingen om te exporteren')
    return
  }
  try {
    const bytes = await buildCommentSummaryPdf(state.groups)
    const result = await window.api.savePdf('Opmerkingen-overzicht.pdf', bytes)
    if (result.saved) state.addToast('success', 'Opmerkingen-overzicht opgeslagen')
  } catch {
    state.addToast('error', 'Exporteren van het opmerkingen-overzicht is mislukt')
  }
}
