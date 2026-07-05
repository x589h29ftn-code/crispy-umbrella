import { getTextLineBoxes } from './textLines'
import type { DocGroup, SourceFile } from '../types'

export type DocType = 'factuur' | 'bankafschrift' | 'loonstrook' | 'contract' | 'document'

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  factuur: 'Factuur',
  bankafschrift: 'Bankafschrift',
  loonstrook: 'Loonstrook',
  contract: 'Contract',
  document: 'Document'
}

export interface DocFields {
  type: DocType
  date: string | null
  invoiceNumber: string | null
  amount: string | null
  iban: string | null
  supplier: string | null
}

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12
}

/** Leest de tekst van de eerste paar pagina's van een document (voor analyse). */
export async function getGroupText(group: DocGroup, sources: Map<string, SourceFile>, maxPages = 3): Promise<string> {
  const parts: string[] = []
  for (let i = 0; i < Math.min(maxPages, group.pages.length); i += 1) {
    const page = group.pages[i]
    const source = sources.get(page.sourceId)
    if (!source) continue
    const lines = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [])
    for (const line of lines) parts.push(line.str)
  }
  return parts.join('\n')
}

function classify(text: string): DocType {
  const t = text.toLowerCase()
  const has = (...words: string[]): number => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0)
  const scores: [DocType, number][] = [
    ['factuur', has('factuur', 'factuurnummer', 'factuurdatum', 'btw', 'te betalen', 'invoice')],
    ['bankafschrift', has('rekeningafschrift', 'afschrift', 'beginsaldo', 'eindsaldo', 'bij- en afschrijvingen', 'tegenrekening')],
    ['loonstrook', has('loonstrook', 'salarisspecificatie', 'bruto', 'netto', 'loonheffing', 'salaris', 'periode')],
    ['contract', has('overeenkomst', 'ondergetekenden', 'contract', 'partijen', 'komen overeen', 'artikel 1')]
  ]
  scores.sort((a, b) => b[1] - a[1])
  return scores[0][1] >= 2 ? scores[0][0] : 'document'
}

/** Zoekt een datum (dd-mm-jjjj, jjjj-mm-dd of "1 januari 2026") en normaliseert naar jjjj-mm-dd. */
function findDate(text: string): string | null {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/.exec(text)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = /\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/i.exec(text)
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

function findAmount(text: string): string | null {
  // Bedragen met € of "EUR", grootste wint (meestal het totaal).
  const re = /(?:€|eur)\s*([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:,[0-9]{2}))/gi
  let best = -1
  let bestStr: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const num = Number(m[1].replace(/[.\s]/g, '').replace(',', '.'))
    if (!Number.isNaN(num) && num > best) {
      best = num
      bestStr = m[1].trim()
    }
  }
  return bestStr
}

function findInvoiceNumber(text: string): string | null {
  const m = /(?:factuur(?:nummer|nr\.?)|invoice\s*(?:no|number|nr)\.?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{2,20})/i.exec(text)
  return m ? m[1] : null
}

function findIban(text: string): string | null {
  const m = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/.exec(text)
  return m ? m[0].replace(/\s+/g, '') : null
}

/** Best-effort leverancier/afzender: de eerste betekenisvolle regel bovenaan. */
function findSupplier(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length < 3 || line.length > 40) continue
    if (/factuur|invoice|datum|pagina|bedrag|btw|\d{4}/i.test(line)) continue
    if (!/[a-zA-Z]/.test(line)) continue
    return line
  }
  return null
}

export function extractFields(text: string): DocFields {
  return {
    type: classify(text),
    date: findDate(text),
    invoiceNumber: findInvoiceNumber(text),
    amount: findAmount(text),
    iban: findIban(text),
    supplier: findSupplier(text)
  }
}

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Stelt een bestandsnaam voor op basis van type, datum en leverancier/bedrag. */
export function suggestName(fields: DocFields, fallback: string): string {
  const parts: string[] = []
  if (fields.date) parts.push(fields.date)
  parts.push(DOC_TYPE_LABELS[fields.type])
  if (fields.supplier) parts.push(sanitize(fields.supplier))
  if (fields.invoiceNumber) parts.push(sanitize(fields.invoiceNumber))
  else if (fields.amount) parts.push(`EUR ${fields.amount}`)
  const name = sanitize(parts.join(' '))
  return name.length > 4 ? name : fallback
}
