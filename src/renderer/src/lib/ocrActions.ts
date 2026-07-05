import { getPdfJsDocument } from './pdfRender'
import { getTextLineBoxes } from './textLines'
import { hasOcr } from './ocrStore'
import { ocrAvailable, ocrPage } from './ocr'
import type { DocGroup, SourceFile } from '../types'

/**
 * True zodra minstens één pagina bruikbare tekst heeft — ingebouwde tekstlaag
 * óf al uitgevoerde OCR. Zo weten de tekst-functies of ze iets te doen hebben.
 */
export async function groupHasText(group: DocGroup, sources: Map<string, SourceFile>): Promise<boolean> {
  for (const page of group.pages) {
    const src = sources.get(page.sourceId)
    if (!src) continue
    const lines = await getTextLineBoxes(src, page.sourcePageIndex, page.rotation).catch(() => [])
    if (lines.some((l) => l.str.trim())) return true
  }
  return false
}

/** Heeft de bronpagina een ingebouwde (niet-OCR) tekstlaag? */
async function hasNativeText(source: SourceFile, pageIndex: number): Promise<boolean> {
  try {
    const doc = await getPdfJsDocument(source)
    const page = await doc.getPage(pageIndex + 1)
    const content = await page.getTextContent()
    return content.items.some((i) => 'str' in i && i.str.trim().length > 0)
  } catch {
    return false
  }
}

/**
 * Voert tekstherkenning (OCR) uit op de pagina's van het document die nog geen
 * tekst hebben. Geeft het aantal herkende pagina's terug.
 */
export async function ocrGroup(
  group: DocGroup,
  sources: Map<string, SourceFile>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const todo: { source: SourceFile; pageIndex: number; rotation: number }[] = []
  for (const page of group.pages) {
    const source = sources.get(page.sourceId)
    if (!source) continue
    if (hasOcr(source.id, page.sourcePageIndex)) continue
    if (await hasNativeText(source, page.sourcePageIndex)) continue
    todo.push({ source, pageIndex: page.sourcePageIndex, rotation: page.rotation })
  }
  let done = 0
  for (const t of todo) {
    await ocrPage(t.source, t.pageIndex, t.rotation).catch(() => undefined)
    done += 1
    onProgress?.(done, todo.length)
  }
  return done
}

export { ocrAvailable }
