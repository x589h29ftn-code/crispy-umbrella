import { getTextLineBoxes } from './textLines'
import { getPageVisualSize, visualRectToContentRect } from './pdfEngine'
import type { PageRef, SourceFile } from '../types'

export type SensitiveKind =
  | 'bsn'
  | 'iban'
  | 'email'
  | 'phone'
  | 'postcode'
  | 'kvk'
  | 'date'
  | 'address'
  | 'company'
  | 'name'

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  bsn: 'BSN',
  iban: 'IBAN',
  email: 'E-mailadres',
  phone: 'Telefoonnummer',
  postcode: 'Postcode',
  kvk: 'KVK-nummer',
  date: 'Datum',
  address: 'Adres (straat + nr.)',
  company: 'Bedrijfsnaam',
  name: 'Naam (met aanhef)'
}

/** Volgorde in de UI. */
export const SENSITIVE_KINDS: SensitiveKind[] = [
  'bsn',
  'iban',
  'email',
  'phone',
  'postcode',
  'kvk',
  'address',
  'company',
  'name',
  'date'
]

/**
 * Standaard aangevinkte categorieën: de patroon-precieze soorten staan aan,
 * de heuristische (naam/adres/bedrijf/datum) uit — die geven vaker een
 * vals-positief, dus de gebruiker vinkt ze bewust aan.
 */
export const DEFAULT_SENSITIVE_KINDS: SensitiveKind[] = ['bsn', 'iban', 'email', 'phone', 'postcode', 'kvk']

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
  /** Extra voorwaarde op de hele tekstregel (bv. het woord "KVK" in de buurt). */
  context?: (line: string) => boolean
}

const STREET_SUFFIX = 'straat|laan|weg|plein|kade|dijk|gracht|hof|pad|dreef|singel|steeg|baan|ring|park|hout|molen'
const MONTHS = 'januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december'

// Woordgrenzen voorkomen dat we midden in langere getallen/tekst matchen.
const DETECTORS: Detector[] = [
  // BSN: 9 cijfers, ook geschreven met spaties/punten (123 456 789 / 123.456.789).
  { kind: 'bsn', regex: /\b\d{3}[ .]?\d{3}[ .]?\d{3}\b/g, valid: (m) => isValidBsn(m.replace(/\D/g, '')) },
  // Landcode + 2 controlecijfers + 10–30 alfanumerieke tekens (spaties toegestaan).
  { kind: 'iban', regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/g, valid: isValidIban },
  { kind: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'phone', regex: /(?:\+31[\s-]?|\b0)(?:\d[\s-]?){8,9}\d\b/g },
  // NL-postcode: 1234 AB.
  { kind: 'postcode', regex: /\b\d{4}\s?[A-Z]{2}\b/g },
  // KVK: 8 cijfers, maar alleen als het woord KVK op dezelfde regel staat.
  { kind: 'kvk', regex: /\b\d{8}\b/g, context: (line) => /k\.?\s?v\.?\s?k\.?/i.test(line) },
  // Datums: 01-01-2026 / 1/1/26 en "1 januari 2026".
  { kind: 'date', regex: /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g },
  { kind: 'date', regex: new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}\\b`, 'gi') },
  // Adres: straatnaam met bekend achtervoegsel + huisnummer.
  { kind: 'address', regex: new RegExp(`\\b[A-ZÀ-Ü][a-zà-ÿ]+(?:${STREET_SUFFIX})\\s+\\d+[a-zA-Z]?\\b`, 'g') },
  // Bedrijfsnaam: eindigt op een rechtsvorm (B.V., N.V., V.O.F., C.V.).
  {
    kind: 'company',
    regex: /\b[A-Z][\wÀ-ÿ&.-]*(?:\s+[A-Z0-9][\wÀ-ÿ&.-]*){0,4}\s+(?:B\.?V\.?|N\.?V\.?|V\.?O\.?F\.?|C\.?V\.?)(?=\b|\s|$)/g
  },
  // Naam met aanhef: dhr./mevr./de heer/mevrouw + één tot drie hoofdletterwoorden.
  {
    kind: 'name',
    regex: /\b(?:dhr\.?|mevr\.?|mw\.?|de heer|mevrouw)\s+[A-ZÀ-Ü][a-zà-ÿ]+(?:\s+[A-ZÀ-Ü][a-zà-ÿ.]+){0,3}/gi
  }
]

/**
 * Scant een pagina op gevoelige gegevens (AVG): BSN, IBAN, e-mail, telefoon.
 * Per treffer wordt een redigeer-rechthoek berekend op basis van de plek van
 * de substring binnen de tekstregel (proportioneel, zoals bij het zoeken).
 */
export async function scanPageForSensitiveData(
  source: SourceFile,
  page: PageRef,
  enabled?: Set<SensitiveKind>
): Promise<SensitiveMatch[]> {
  const lines = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [])
  if (!lines.length) return []
  const size = await getPageVisualSize(source, page.sourcePageIndex, page.rotation)
  const matches: SensitiveMatch[] = []
  const detectors = enabled ? DETECTORS.filter((d) => enabled.has(d.kind)) : DETECTORS

  for (const line of lines) {
    const hay = line.str
    if (!hay.trim()) continue
    for (const detector of detectors) {
      if (detector.context && !detector.context(hay)) continue
      detector.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = detector.regex.exec(hay)) !== null) {
        const text = m[0]
        if (detector.valid && !detector.valid(text)) continue
        const startFrac = m.index / Math.max(1, hay.length)
        const widthFrac = text.length / Math.max(1, hay.length)
        // Ruime marge zodat het hele nummer/adres écht bedekt is (AVG): de
        // proportionele schatting kan iets afwijken, dus we lakken wat breder.
        const pad = line.visual.height * 0.22
        const extra = line.visual.width * 0.02
        const rectVisual = {
          x: Math.max(0, line.visual.x + line.visual.width * startFrac - pad - extra),
          y: Math.max(0, line.visual.y - pad),
          width: line.visual.width * widthFrac + pad * 2 + extra * 2,
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
