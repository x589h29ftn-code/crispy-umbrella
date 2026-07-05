import { nanoid } from 'nanoid'
import {
  getPageVisualSize,
  visualPointToContentPoint,
  visualRectToContentRect,
  TEXT_LINE_HEIGHT
} from './pdfEngine'
import { getTextLineBoxes } from './textLines'
import { useStudioStore } from '../store'
import type { Annotation, DocGroup, SourceFile, TextAnnotation } from '../types'

export interface ReplacePlan {
  /** Aantal treffers in de paginatekst (worden overschreven met een witvlak + nieuwe tekst). */
  bodyMatches: number
  /** Aantal treffers in eerder toegevoegde tekstvakken (worden direct vervangen). */
  annotationMatches: number
  apply: () => void
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  let i = haystack.toLowerCase().indexOf(needle.toLowerCase())
  while (i !== -1) {
    n += 1
    i = haystack.toLowerCase().indexOf(needle.toLowerCase(), i + needle.length)
  }
  return n
}

/**
 * Bereidt "zoeken & vervangen" voor het actieve document voor: treffers in de
 * paginatekst worden bij toepassen overschreven met een witvlak + de nieuwe
 * tekst (op de plek en grootte van de regel), en treffers in eerder geplaatste
 * tekstvakken worden direct in de tekst vervangen.
 */
export async function planFindReplace(group: DocGroup, sources: Map<string, SourceFile>, find: string, replace: string): Promise<ReplacePlan> {
  const needle = find.trim()
  const bulkAnnotations: { pageId: string; annotation: Annotation }[] = []
  const annotationEdits: { pageId: string; annotationId: string; text: string }[] = []
  let annotationMatches = 0

  if (needle) {
    for (const page of group.pages) {
      const source = sources.get(page.sourceId)
      if (!source) continue

      // Eerder toegevoegde tekstvakken: directe tekstvervanging.
      for (const a of page.annotations) {
        if (a.type === 'text' && a.text.toLowerCase().includes(needle.toLowerCase())) {
          const occ = countOccurrences(a.text, needle)
          annotationMatches += occ
          const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
          annotationEdits.push({ pageId: page.id, annotationId: a.id, text: a.text.replace(re, replace) })
        }
      }

      // Paginatekst: witvlak + vervangende tekst per regel-treffer.
      const lines = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [])
      const size = await getPageVisualSize(source, page.sourcePageIndex, page.rotation)
      for (const line of lines) {
        const hay = line.str
        const lower = hay.toLowerCase()
        let idx = lower.indexOf(needle.toLowerCase())
        while (idx !== -1) {
          const startFrac = idx / Math.max(1, hay.length)
          const widthFrac = needle.length / Math.max(1, hay.length)
          const pad = line.visual.height * 0.12
          const boxX = line.visual.x + line.visual.width * startFrac - pad
          const boxY = line.visual.y - pad
          const boxW = line.visual.width * widthFrac + pad * 2
          const boxH = line.visual.height + pad * 2
          const rect = await visualRectToContentRect(source, page.sourcePageIndex, page.rotation, {
            xPct: boxX / size.width,
            yPct: boxY / size.height,
            wPct: boxW / size.width,
            hPct: boxH / size.height
          })
          bulkAnnotations.push({ pageId: page.id, annotation: { id: nanoid(), type: 'redact', ...rect, fill: 'white' } })
          if (replace) {
            const fontSize = Math.max(6, Math.round(line.fontSize))
            const textVisualY = line.visual.y + fontSize * TEXT_LINE_HEIGHT
            const { x, y } = await visualPointToContentPoint(
              source,
              page.sourcePageIndex,
              page.rotation,
              line.visual.x + line.visual.width * startFrac,
              textVisualY
            )
            const textAnn: TextAnnotation = {
              id: nanoid(),
              type: 'text',
              x,
              y,
              text: replace,
              font: 'arial',
              size: fontSize,
              bold: false,
              italic: false,
              color: '#111111'
            }
            bulkAnnotations.push({ pageId: page.id, annotation: textAnn })
          }
          idx = lower.indexOf(needle.toLowerCase(), idx + needle.length)
        }
      }
    }
  }

  const bodyMatches = bulkAnnotations.filter((e) => e.annotation.type === 'redact').length
  return {
    bodyMatches,
    annotationMatches,
    apply: () => {
      const store = useStudioStore.getState()
      if (annotationEdits.length) {
        store.markHistory()
        for (const edit of annotationEdits) store.updateAnnotation(edit.pageId, edit.annotationId, { text: edit.text })
      }
      if (bulkAnnotations.length) store.addAnnotationsBulk(bulkAnnotations)
    }
  }
}
