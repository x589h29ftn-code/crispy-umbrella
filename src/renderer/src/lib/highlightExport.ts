import { PDFDocument, rgb } from '@cantoo/pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import fontRegularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url'
import fontBoldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import { getPlacementVisualBox } from './pdfRender'
import { getTextLineBoxes } from './textLines'
import { useStudioStore } from '../store'
import type { HighlightAnnotation } from '../types'

const STYLE_LABEL: Record<string, string> = { fill: 'Markering', underline: 'Onderstreping', strike: 'Doorhaling' }

interface HighlightItem {
  groupName: string
  pageNumber: number
  style: string
  text: string
}

/** Haalt de tekst onder een markering/onderstreping/doorhaling op via overlap met de tekstregels. */
async function collectHighlights(): Promise<HighlightItem[]> {
  const { groups, sources } = useStudioStore.getState()
  const items: HighlightItem[] = []
  for (const group of groups) {
    for (let p = 0; p < group.pages.length; p += 1) {
      const page = group.pages[p]
      const source = sources.get(page.sourceId)
      const highlights = page.annotations.filter((a): a is HighlightAnnotation => a.type === 'highlight')
      if (!source || !highlights.length) continue
      const lines = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [])
      for (const hl of highlights) {
        const box = await getPlacementVisualBox(source, page.sourcePageIndex, page.rotation, {
          x: hl.x,
          y: hl.y,
          width: hl.width,
          height: hl.height
        })
        const top = box.pivotY - box.height
        const bottom = box.pivotY
        const left = box.pivotX
        const right = box.pivotX + box.width
        const pieces: string[] = []
        for (const line of lines) {
          const cy = line.visual.y + line.visual.height / 2
          if (cy < top - 2 || cy > bottom + 2) continue
          const x0 = Math.max(left, line.visual.x)
          const x1 = Math.min(right, line.visual.x + line.visual.width)
          if (x1 - x0 < 2) continue
          const startFrac = (x0 - line.visual.x) / line.visual.width
          const endFrac = (x1 - line.visual.x) / line.visual.width
          const s = Math.floor(startFrac * line.str.length)
          const e = Math.ceil(endFrac * line.str.length)
          const piece = line.str.slice(Math.max(0, s), Math.min(line.str.length, e)).trim()
          if (piece) pieces.push(piece)
        }
        const text = pieces.join(' ').trim()
        if (text) items.push({ groupName: group.name, pageNumber: p + 1, style: hl.style ?? 'fill', text })
      }
    }
  }
  return items
}

/** Genereert een overzichts-PDF van alle gemarkeerde tekst en biedt hem aan om op te slaan. */
export async function exportHighlightSummary(): Promise<void> {
  const state = useStudioStore.getState()
  const items = await collectHighlights()
  if (!items.length) {
    state.addToast('info', 'Geen gemarkeerde tekst gevonden om te exporteren')
    return
  }
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
    const line = (text: string, font = regular, size = 10.5, color = rgb(0.13, 0.15, 0.19), indent = 0): void => {
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
    }
    line('Overzicht markeringen', bold, 20)
    y -= 8
    let currentGroup = ''
    for (const item of items) {
      if (item.groupName !== currentGroup) {
        currentGroup = item.groupName
        y -= 6
        line(currentGroup, bold, 14)
      }
      line(`Pagina ${item.pageNumber} · ${STYLE_LABEL[item.style] ?? 'Markering'}`, bold, 9.5, rgb(0.23, 0.45, 0.85))
      line(item.text, regular, 11)
      y -= 6
    }
    const bytes = await doc.save()
    const result = await window.api.savePdf('Markeringen-overzicht.pdf', bytes)
    if (result.saved) state.addToast('success', 'Markeringen-overzicht opgeslagen')
  } catch {
    state.addToast('error', 'Exporteren van de markeringen is mislukt')
  }
}
