import { getPdfJsDocument } from './pdfRender'
import type { DocGroup, SourceFile } from '../types'

export interface OutlineNode {
  title: string
  /** Page index in the source document, or -1 if the destination didn't resolve. */
  pageIndex: number
  children: OutlineNode[]
}

const outlineCache = new Map<string, Promise<OutlineNode[]>>()

export function forgetOutline(sourceId: string): void {
  outlineCache.delete(sourceId)
}

/** The bookmark tree (inhoudsopgave) of a source PDF, with resolved page indexes. */
export function getSourceOutline(source: SourceFile): Promise<OutlineNode[]> {
  let cached = outlineCache.get(source.id)
  if (!cached) {
    cached = readOutline(source).catch(() => [])
    outlineCache.set(source.id, cached)
  }
  return cached
}

async function readOutline(source: SourceFile): Promise<OutlineNode[]> {
  const doc = await getPdfJsDocument(source)
  const outline = await doc.getOutline()
  if (!outline || !outline.length) return []

  async function resolvePageIndex(dest: unknown): Promise<number> {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || !explicit.length) return -1
      const ref = explicit[0]
      if (typeof ref === 'number') return ref
      return await doc.getPageIndex(ref)
    } catch {
      return -1
    }
  }

  interface PdfJsOutlineItem {
    title: string
    dest: unknown
    items?: PdfJsOutlineItem[]
  }

  async function convert(items: PdfJsOutlineItem[], depth: number): Promise<OutlineNode[]> {
    if (depth > 6) return []
    const nodes: OutlineNode[] = []
    for (const item of items) {
      nodes.push({
        title: item.title || '(zonder titel)',
        pageIndex: await resolvePageIndex(item.dest),
        children: item.items ? await convert(item.items, depth + 1) : []
      })
    }
    return nodes
  }

  return convert(outline as unknown as PdfJsOutlineItem[], 0)
}

export interface GroupBookmark {
  title: string
  /** Page id inside the group to jump to. */
  pageId: string
  depth: number
}

/**
 * Flattened bookmark list for one document group: the outlines of all source
 * files it uses, mapped onto the pages that are actually in the group. When
 * the group mixes multiple sources, each source gets a top-level entry.
 */
export async function getGroupBookmarks(group: DocGroup, sources: Map<string, SourceFile>): Promise<GroupBookmark[]> {
  const result: GroupBookmark[] = []
  const seenSources: string[] = []
  for (const page of group.pages) {
    if (!seenSources.includes(page.sourceId)) seenSources.push(page.sourceId)
  }
  const multi = seenSources.length > 1

  // First page in the group for (sourceId, sourcePageIndex).
  const pageFor = new Map<string, string>()
  for (const page of group.pages) {
    const key = `${page.sourceId}:${page.sourcePageIndex}`
    if (!pageFor.has(key)) pageFor.set(key, page.id)
  }

  for (const sourceId of seenSources) {
    const source = sources.get(sourceId)
    if (!source) continue
    const firstPage = group.pages.find((p) => p.sourceId === sourceId)
    if (multi && firstPage) {
      result.push({ title: source.name.replace(/\.pdf$/i, ''), pageId: firstPage.id, depth: 0 })
    }
    const outline = await getSourceOutline(source)
    const baseDepth = multi ? 1 : 0
    const walk = (nodes: OutlineNode[], depth: number): void => {
      for (const node of nodes) {
        const pageId = node.pageIndex >= 0 ? pageFor.get(`${sourceId}:${node.pageIndex}`) : undefined
        if (pageId) result.push({ title: node.title, pageId, depth })
        // Children stay visible even when the parent's page was removed.
        walk(node.children, pageId ? depth + 1 : depth)
      }
    }
    walk(outline, baseDepth)
  }
  return result
}
