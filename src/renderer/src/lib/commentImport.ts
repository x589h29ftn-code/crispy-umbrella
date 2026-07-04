import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString } from '@cantoo/pdf-lib'
import { nanoid } from 'nanoid'
import { getPdfLibDocument } from './pdfEngine'
import type { PageComment, SourceFile } from '../types'

function decodeText(value: unknown): string {
  if (value instanceof PDFHexString || value instanceof PDFString) {
    try {
      return value.decodeText()
    } catch {
      return String(value)
    }
  }
  return ''
}

/** Parses a PDF date string like D:20260704123000+02'00' to epoch ms. */
function parsePdfDate(value: unknown): number {
  const raw = decodeText(value)
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw)
  if (!m) return Date.now()
  const [, y, mo, d, h, mi, se] = m
  const date = new Date(
    Number(y),
    Number(mo ?? '1') - 1,
    Number(d ?? '1'),
    Number(h ?? '12'),
    Number(mi ?? '0'),
    Number(se ?? '0')
  )
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime()
}

/**
 * Reads existing sticky-note comments (Subtype /Text) with their /IRT reply
 * threads and Review state out of a source PDF, so comments placed by others
 * (e.g. in Adobe) appear in our timeline and threads.
 */
export async function extractComments(source: SourceFile): Promise<Map<number, PageComment[]>> {
  const result = new Map<number, PageComment[]>()
  try {
    const doc = await getPdfLibDocument(source)
    doc.getPages().forEach((page, pageIndex) => {
      const annotsRaw = page.node.get(PDFName.of('Annots'))
      const annots = annotsRaw instanceof PDFArray ? annotsRaw : null
      if (!annots) return

      interface Parsed {
        ref: PDFRef | null
        dict: PDFDict
        contents: string
        author: string
        date: number
        irt: PDFRef | null
        state: string
      }
      const parsed: Parsed[] = []
      for (let i = 0; i < annots.size(); i += 1) {
        const entry = annots.get(i)
        const ref = entry instanceof PDFRef ? entry : null
        const dict = ref ? doc.context.lookup(ref) : entry
        if (!(dict instanceof PDFDict)) continue
        const subtype = dict.get(PDFName.of('Subtype'))
        if (String(subtype) !== '/Text') continue
        const irtRaw = dict.get(PDFName.of('IRT'))
        parsed.push({
          ref,
          dict,
          contents: decodeText(dict.get(PDFName.of('Contents'))),
          author: decodeText(dict.get(PDFName.of('T'))),
          date: parsePdfDate(dict.get(PDFName.of('M'))),
          irt: irtRaw instanceof PDFRef ? irtRaw : null,
          state: decodeText(dict.get(PDFName.of('State')))
        })
      }

      const comments: PageComment[] = []
      const byRef = new Map<string, PageComment>()
      for (const item of parsed) {
        if (item.irt) continue
        const rect = item.dict.get(PDFName.of('Rect'))
        let x = 40
        let y = 40
        if (rect instanceof PDFArray && rect.size() >= 4) {
          const nums = rect.asArray().map((n) => Number(n.toString()))
          x = (nums[0] + nums[2]) / 2
          y = nums[1]
        }
        const comment: PageComment = {
          id: nanoid(),
          x,
          y,
          text: item.contents,
          createdAt: item.date,
          resolved: false,
          replies: [],
          author: item.author || undefined
        }
        comments.push(comment)
        if (item.ref) byRef.set(item.ref.toString(), comment)
      }
      for (const item of parsed) {
        if (!item.irt) continue
        const parent = byRef.get(item.irt.toString())
        if (!parent) continue
        if (item.state) {
          if (item.state === 'Completed' || item.state === 'Accepted') parent.resolved = true
          continue
        }
        parent.replies.push({
          id: nanoid(),
          text: item.contents,
          createdAt: item.date,
          author: item.author || undefined
        })
      }
      // Comments without text and without replies are usually artifacts.
      const meaningful = comments.filter((c) => c.text.trim() || c.replies.length)
      if (meaningful.length) result.set(pageIndex, meaningful)
    })
  } catch {
    // Malformed annotations should never block an import.
  }
  return result
}
