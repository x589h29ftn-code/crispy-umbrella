import { analyzeDocument, type Block, type StructureStats } from './docStructure'
import { useStudioStore } from '../store'
import type { DocGroup, SourceFile } from '../types'

/**
 * PDF → Markdown. De structuurherkenning zit in docStructure (gedeeld met de
 * Word- en Excel-export); hier wordt die structuur naar Markdown geschreven.
 */

export interface MarkdownOptions {
  headings: boolean
  lists: boolean
  tables: boolean
  joinParagraphs: boolean
  dropRunningHeads: boolean
  /** Wat er tussen twee pagina's komt. */
  pageBreaks: 'none' | 'rule' | 'comment'
  /** YAML-kop met titel, datum en aantal pagina's (voor Obsidian e.d.). */
  frontMatter: boolean
  /** Documentnaam als titel (# …) bovenaan. */
  titleHeading: boolean
}

export const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = {
  headings: true,
  lists: true,
  tables: true,
  joinParagraphs: true,
  dropRunningHeads: true,
  pageBreaks: 'comment',
  frontMatter: false,
  titleHeading: true
}

export type MarkdownStats = StructureStats

function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\`*_{}[\]<>])/g, '\\$1')
    .replace(/^(\s*)#/, '$1\\#')
    .replace(/^(\s*)>/, '$1\\>')
}

function escapeCell(text: string): string {
  return escapeMarkdown(text).replace(/\|/g, '\\|')
}

function tableToMarkdown(grid: string[][]): string[] {
  const header = grid[0].map(escapeCell)
  const rows = grid.slice(1).map((r) => r.map(escapeCell))
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`)
  ]
}

function blockToMarkdown(block: Block, headingOffset: number): string[] {
  switch (block.kind) {
    case 'heading':
      return [`${'#'.repeat(Math.min(6, block.level + headingOffset))} ${escapeMarkdown(block.text)}`, '']
    case 'paragraph':
      return [escapeMarkdown(block.text), '']
    case 'list':
      return [
        ...block.items.map(
          (item) => `${'  '.repeat(item.indent)}${block.ordered ? `${item.marker ?? '1'}.` : '-'} ${escapeMarkdown(item.text)}`
        ),
        ''
      ]
    case 'table':
      return [...tableToMarkdown(block.grid), '']
    case 'note':
      return [`> _${block.text}_`, '']
  }
}

/** Bouwt de Markdown voor een document (puur rekenwerk, voor het voorbeeld). */
export async function buildMarkdown(
  group: DocGroup,
  sources: Map<string, SourceFile>,
  options: MarkdownOptions
): Promise<{ markdown: string; stats: MarkdownStats }> {
  const { pages, stats } = await analyzeDocument(
    group,
    sources,
    {
      headings: options.headings,
      lists: options.lists,
      tables: options.tables,
      joinParagraphs: options.joinParagraphs,
      dropRunningHeads: options.dropRunningHeads,
      dropTitleLine: options.titleHeading
    },
    group.name
  )

  const out: string[] = []
  if (options.frontMatter) {
    const today = new Date().toISOString().slice(0, 10)
    out.push('---', `title: "${group.name.replace(/"/g, "'")}"`, `pages: ${group.pages.length}`, `exported: ${today}`, '---', '')
  }
  if (options.titleHeading) out.push(`# ${escapeMarkdown(group.name)}`, '')

  const headingOffset = options.titleHeading ? 1 : 0
  pages.forEach((blocks, pageIndex) => {
    if (pageIndex > 0) {
      if (options.pageBreaks === 'rule') out.push('---', '')
      else if (options.pageBreaks === 'comment') out.push(`<!-- pagina ${pageIndex + 1} -->`, '')
    }
    for (const block of blocks) out.push(...blockToMarkdown(block, headingOffset))
  })

  const markdown = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { markdown: `${markdown}\n`, stats }
}

/** Slaat de Markdown van het actieve document op als .md-bestand. */
export async function saveMarkdown(markdown: string, name: string): Promise<void> {
  const state = useStudioStore.getState()
  const base = name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
  const bytes = new TextEncoder().encode(markdown)
  const result = await window.api.saveFile(`${base}.md`, bytes, 'md')
  if (result.saved) {
    state.addToast(
      'success',
      `Markdown opgeslagen als "${base}.md"`,
      result.path && typeof window.api.openPath === 'function'
        ? { label: 'Openen', run: () => void window.api.openPath!(result.path!) }
        : undefined
    )
  }
}
