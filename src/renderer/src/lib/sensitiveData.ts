import { getTextLineBoxes } from './textLines'
import { getPageVisualSize, visualRectToContentRect } from './pdfEngine'
import type { PageRef, SourceFile } from '../types'

export type SensitiveKind = 'bsn' | 'iban' | 'email' | 'phone'

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  bsn: 'BSN',
  iban: 'IBAN',
  email: 'E-mailadres',
  phone: 'Telefoonnummer'
}

export interface SensitiveMatch {
  id: string
  kind: SensitiveKind
  text: string
  pageId: string
  pageNumber: number
  /** Content-space redigeer-rechthoek (zelfde conventie als redact-annotaties). */
  rect: { x: number; y: number; width: number; height: number }
}

/** BSN: 9 cijfers die aan de 11-proef voldoen (9·d1 + 8·d2 + … + 2·d8 − d9 ≡ 0 mod 11). */
function isValidBsn(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 8; i += 1) sum += (9 - i) * Number(digits[i])
  sum -= Number(digits[8])
  return sum % 11 === 0
}

/** IBAN mod-97 controle (verplaatst de landcode+controle naar achter en toetst ≡ 1). */
function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{6,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const value = /\d/.test(ch) ? ch : (ch.charCodeAt(0) - 55).toString()
    for (const d of value) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

interface Detector {
  kind: SensitiveKind
  regex: RegExp
  valid?: (match: string) => boolean
}

// Woordgrenzen voorkomen dat we midden in langere getallen/tekst matchen.
const DETECTORS: Detector[] = [
  { kind: 'bsn', regex: /\b\d{9}\b/g, valid: isValidBsn },
  // Landcode + 2 controlecijfers + 10–30 alfanumerieke tekens (spaties toegestaan).
  { kind: 'iban', regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/g, valid: isValidIban },
  { kind: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'phone', regex: /(?:\+31[\s-]?|\b0)(?:\d[\s-]?){8,9}\d\b/g }
]

/**
 * Scant een pagina op gevoelige gegevens (AVG): BSN, IBAN, e-mail, telefoon.
 * Per treffer wordt een redigeer-rechthoek berekend op basis van de plek van
 * de substring binnen de tekstregel (proportioneel, zoals bij het zoeken).
 */
export async function scanPageForSensitiveData(source: SourceFile, page: PageRef): Promise<SensitiveMatch[]> {
  const lines = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [])
  if (!lines.length) return []
  const size = await getPageVisualSize(source, page.sourcePageIndex, page.rotation)
  const matches: SensitiveMatch[] = []

  for (const line of lines) {
    const hay = line.str
    if (!hay.trim()) continue
    for (const detector of DETECTORS) {
      detector.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = detector.regex.exec(hay)) !== null) {
        const text = m[0]
        if (detector.valid && !detector.valid(text)) continue
        const startFrac = m.index / Math.max(1, hay.length)
        const widthFrac = text.length / Math.max(1, hay.length)
        // Iets marge zodat het hele nummer/adres bedekt wordt.
        const pad = line.visual.height * 0.15
        const rectVisual = {
          x: Math.max(0, line.visual.x + line.visual.width * startFrac - pad),
          y: Math.max(0, line.visual.y - pad),
          width: line.visual.width * widthFrac + pad * 2,
          height: line.visual.height + pad * 2
        }
        const rect = await visualRectToContentRect(source, page.sourcePageIndex, page.rotation, {
          xPct: rectVisual.x / size.width,
          yPct: rectVisual.y / size.height,
          wPct: rectVisual.width / size.width,
          hPct: rectVisual.height / size.height
        })
        matches.push({
          id: `${page.id}:${detector.kind}:${m.index}:${text}`,
          kind: detector.kind,
          text,
          pageId: page.id,
          pageNumber: 0,
          rect
        })
      }
    }
  }
  return matches
}
