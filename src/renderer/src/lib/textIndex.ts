import { getPdfJsDocument } from './pdfRender'
import { getOcr, hasOcr } from './ocrStore'
import type { DocGroup, PageRef, SourceFile } from '../types'

/** Native (embedded) text per source page, extracted once via pdf.js. */
const nativeTextCache = new Map<string, Promise<string>>()

export function getNativePageText(source: SourceFile, pageIndex: number): Promise<string> {
  const key = `${source.id}::${pageIndex}`
  let cached = nativeTextCache.get(key)
  if (!cached) {
    cached = (async () => {
      const doc = await getPdfJsDocument(source)
      const page = await doc.getPage(pageIndex + 1)
      const content = await page.getTextContent()
      return content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    })()
    nativeTextCache.set(key, cached)
  }
  return cached
}

export interface SearchHit {
  pageId: string
  groupName: string
  /** 1-based position within the document. */
  pageNumber: number
  snippet: string
  count: number
  viaOcr: boolean
}

export interface ScanCandidate {
  pageId: string
  sourceId: string
  sourcePageIndex: number
  rotation: number
  groupName: string
  pageNumber: number
}

export interface SearchOutcome {
  hits: SearchHit[]
  /** Pages without a usable text layer (likely scans) that have not been OCR'd yet. */
  scansWithoutText: ScanCandidate[]
}

function makeSnippet(text: string, index: number, queryLength: number): string {
  const from = Math.max(0, index - 40)
  const to = Math.min(text.length, index + queryLength + 40)
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/**
 * Searches every page of every document (native text layer + OCR results) and
 * reports which pages look like scans that could still be OCR'd.
 */
export async function searchProject(
  groups: DocGroup[],
  sources: Map<string, SourceFile>,
  query: string
): Promise<SearchOutcome> {
  const needle = query.trim().toLowerCase()
  const hits: SearchHit[] = []
  const scansWithoutText: ScanCandidate[] = []

  for (const group of groups) {
    for (let i = 0; i < group.pages.length; i += 1) {
      const page: PageRef = group.pages[i]
      const source = sources.get(page.sourceId)
      if (!source) continue
      const native = await getNativePageText(source, page.sourcePageIndex).catch(() => '')
      const ocr = getOcr(page.sourceId, page.sourcePageIndex)

      if (native.length < 8 && !hasOcr(page.sourceId, page.sourcePageIndex)) {
        scansWithoutText.push({
          pageId: page.id,
          sourceId: page.sourceId,
          sourcePageIndex: page.sourcePageIndex,
          rotation: page.rotation,
          groupName: group.name,
          pageNumber: i + 1
        })
      }

      if (!needle) continue
      const nativeLower = native.toLowerCase()
      const ocrText = (ocr?.text ?? '').replace(/\s+/g, ' ').trim()
      const ocrLower = ocrText.toLowerCase()

      let count = countOccurrences(nativeLower, needle)
      let snippet = ''
      let viaOcr = false
      if (count > 0) {
        snippet = makeSnippet(native, nativeLower.indexOf(needle), needle.length)
      } else {
        count = countOccurrences(ocrLower, needle)
        if (count > 0) {
          snippet = makeSnippet(ocrText, ocrLower.indexOf(needle), needle.length)
          viaOcr = true
        }
      }
      if (count > 0) {
        hits.push({ pageId: page.id, groupName: group.name, pageNumber: i + 1, snippet, count, viaOcr })
      }
    }
  }

  return { hits, scansWithoutText }
}
