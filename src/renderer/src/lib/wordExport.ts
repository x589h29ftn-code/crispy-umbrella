import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import { analyzeDocument, DEFAULT_STRUCTURE_OPTIONS, type Block } from './docStructure'
import { useStudioStore } from '../store'
import type { DocGroup } from '../types'

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]

/** Getallen rechts uitlijnen in tabellen, net als in Excel. */
function looksNumeric(text: string): boolean {
  return /^[€\s]*-?\(?\d[\d.,\s]*\)?-?\s*%?$/.test(text.trim()) && /\d/.test(text)
}

function tableToDocx(grid: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 2, color: 'D0D5DD' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const rows = grid.map((cells, rowIndex) => {
    const header = rowIndex === 0
    return new TableRow({
      tableHeader: header,
      children: cells.map(
        (cell) =>
          new TableCell({
            borders,
            shading: header ? { fill: 'EFF2F7' } : undefined,
            children: [
              new Paragraph({
                alignment: !header && looksNumeric(cell) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                spacing: { before: 20, after: 20 },
                children: [new TextRun({ text: cell, bold: header, size: 20 })]
              })
            ]
          })
      )
    })
  })
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

function blockToDocx(block: Block): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'heading':
      return [
        new Paragraph({
          heading: HEADINGS[Math.min(HEADINGS.length, block.level) - 1],
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: block.text })]
        })
      ]
    case 'paragraph':
      return [
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: block.text, bold: block.bold })]
        })
      ]
    case 'list':
      return block.items.map(
        (item) =>
          new Paragraph({
            spacing: { after: 60 },
            ...(block.ordered
              ? { numbering: { reference: 'genummerd', level: Math.min(2, item.indent) } }
              : { bullet: { level: Math.min(2, item.indent) } }),
            children: [new TextRun({ text: item.text })]
          })
      )
    case 'table':
      return [tableToDocx(block.grid), new Paragraph({ text: '', spacing: { after: 120 } })]
    case 'note':
      return [new Paragraph({ children: [new TextRun({ text: block.text, italics: true, color: '888888' })] })]
  }
}

/**
 * Exporteert het actieve document naar een bewerkbaar Word-bestand (.docx) mét
 * structuur: koppen worden echte Word-kopstijlen (dus bruikbaar in het
 * navigatievenster en voor een inhoudsopgave), opsommingen worden echte
 * lijsten, herkende tabellen worden echte Word-tabellen, en alinea's lopen door
 * in plaats van per regel af te breken.
 */
export async function exportGroupWord(): Promise<void> {
  const state = useStudioStore.getState()
  const group: DocGroup | undefined = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) {
    state.addToast('info', 'Er is geen document om te exporteren')
    return
  }
  try {
    const { pages, stats } = await analyzeDocument(group, state.sources, DEFAULT_STRUCTURE_OPTIONS, group.name)
    if (stats.words === 0) {
      state.addToast('info', 'Geen tekstlaag gevonden — voer eerst OCR uit voor gescande documenten')
      return
    }

    const children: (Paragraph | Table)[] = []
    pages.forEach((blocks, pageIndex) => {
      for (const block of blocks) children.push(...blockToDocx(block))
      // Pagina-einde tussen pagina's (niet na de laatste).
      if (pageIndex < pages.length - 1) children.push(new Paragraph({ children: [], pageBreakBefore: true }))
    })

    const doc = new Document({
      creator: 'PDF Studio',
      title: group.name,
      numbering: {
        config: [
          {
            reference: 'genummerd',
            levels: [0, 1, 2].map((level) => ({
              level,
              format: LevelFormat.DECIMAL,
              text: `%${level + 1}.`,
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } }
            }))
          }
        ]
      },
      sections: [{ children }]
    })
    const blob = await Packer.toBlob(doc)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const base = group.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
    const result = await window.api.saveFile(`${base}.docx`, bytes, 'docx')
    if (result.saved) {
      const parts = [`${stats.headings} koppen`, `${stats.tables} tabellen`, `${stats.listItems} lijstregels`]
      state.addToast(
        'success',
        `Word-document opgeslagen als "${base}.docx" (${parts.join(' · ')})`,
        result.path && typeof window.api.openPath === 'function'
          ? { label: 'Open Word-bestand', run: () => void window.api.openPath!(result.path!) }
          : undefined
      )
    }
  } catch {
    state.addToast('error', 'Exporteren naar Word is mislukt')
  }
}
