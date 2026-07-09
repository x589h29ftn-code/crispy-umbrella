import { Document, Packer, Paragraph, TextRun } from 'docx'
import { getTextLineBoxes, type TextLineBox } from './textLines'
import { useStudioStore } from '../store'
import type { DocGroup, SourceFile } from '../types'

/**
 * Exporteert het actieve document naar een bewerkbaar Word-bestand (.docx) met
 * behoud van opmaak: elke tekstregel wordt een alinea met de oorspronkelijke
 * lettergrootte, koppen (duidelijk groter dan de basistekst) worden vet, en
 * elke pagina eindigt met een pagina-einde. Zo houd je in Word dezelfde
 * indeling in plaats van één blok platte tekst.
 */
export async function exportGroupWord(): Promise<void> {
  const state = useStudioStore.getState()
  const group: DocGroup | undefined = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) {
    state.addToast('info', 'Er is geen document om te exporteren')
    return
  }
  try {
    // Per pagina de regels met hun lettergrootte ophalen.
    const pages: TextLineBox[][] = []
    for (const page of group.pages) {
      const source: SourceFile | undefined = state.sources.get(page.sourceId)
      if (!source) continue
      const lines = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [] as TextLineBox[])
      pages.push(lines.filter((l) => l.str.trim()))
    }
    if (!pages.some((p) => p.length)) {
      state.addToast('info', 'Geen tekstlaag gevonden — voer eerst OCR uit voor gescande documenten')
      return
    }

    // Basis-lettergrootte = mediaan; regels die duidelijk groter zijn gelden als kop (vet).
    const sizes = pages.flat().map((l) => l.fontSize).sort((a, b) => a - b)
    const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11
    const headingThreshold = bodySize * 1.25

    const paragraphs: Paragraph[] = []
    pages.forEach((lines, pageIdx) => {
      lines.forEach((line) => {
        const isHeading = line.fontSize >= headingThreshold
        // docx rekent in halve punten; behoud de echte grootte van de PDF-regel.
        const halfPoints = Math.max(12, Math.round(line.fontSize * 2))
        paragraphs.push(
          new Paragraph({
            spacing: { after: isHeading ? 120 : 60 },
            children: [new TextRun({ text: line.str, size: halfPoints, bold: isHeading })]
          })
        )
      })
      // Pagina-einde tussen pagina's (niet na de laatste).
      if (pageIdx < pages.length - 1) paragraphs.push(new Paragraph({ children: [], pageBreakBefore: true }))
    })

    const doc = new Document({
      creator: 'PDF Studio',
      title: group.name,
      sections: [{ children: paragraphs }]
    })
    const blob = await Packer.toBlob(doc)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const base = group.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
    const result = await window.api.saveFile(`${base}.docx`, bytes, 'docx')
    if (result.saved) {
      state.addToast(
        'success',
        `Word-document opgeslagen als "${base}.docx"`,
        result.path && typeof window.api.openPath === 'function'
          ? { label: 'Open Word-bestand', run: () => void window.api.openPath!(result.path!) }
          : undefined
      )
    }
  } catch {
    state.addToast('error', 'Exporteren naar Word is mislukt')
  }
}
