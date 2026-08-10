/**
 * Getallen uit een PDF herkennen en in de gewenste vorm terugschrijven.
 * Gedeeld door de Excel- en Word-export, zodat "5.000,00" in beide dezelfde
 * keuze volgt: laten staan zoals in de PDF, zonder decimalen, of altijd twee.
 */

export type NumberFormatChoice = 'auto' | 'none' | 'two'

export const NUMBER_FORMAT_LABELS: Record<NumberFormatChoice, string> = {
  auto: 'Zoals in de PDF',
  none: 'Zonder decimalen',
  two: 'Twee decimalen'
}

export const NUMBER_FORMAT_EXAMPLES: Record<NumberFormatChoice, string> = {
  auto: '5.000,00 blijft 5.000,00',
  none: '5.000,00 wordt 5.000 (Excel rekent met de volledige waarde)',
  two: '5.000 wordt 5.000,00'
}

export interface ParsedNumber {
  value: number
  /** Bedrag (€ of EUR stond erbij). */
  currency: boolean
  /** Percentage: de waarde is al gedeeld door 100. */
  percent: boolean
  /** Aantal decimalen zoals ze in de PDF stonden. */
  decimals: number
}

/**
 * Leest een Nederlands getal, bedrag of percentage. Ondersteunt ook
 * boekhoudkundige negatieven: "(1.234)" en "1.234-".
 */
export function parseDutchNumber(raw: string): ParsedNumber | null {
  const s = String(raw ?? '').trim()
  if (!s || !/\d/.test(s)) return null
  const percent = /%\s*$/.test(s)
  const currency = /€|EUR/i.test(s)
  const paren = /^\(.*\)$/.test(s)
  const trailingMinus = /-\s*$/.test(s.replace(/[)\s]*$/, '')) || /\d[-]$/.test(s.replace(/[€\s%)]|EUR/gi, ''))
  let numPart = s.replace(/[€\s%()]|EUR/gi, '').replace(/-\s*$/, '')
  const negative = paren || trailingMinus || /^-/.test(numPart)
  numPart = numPart.replace(/^-/, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(numPart) && !/^\d+(,\d+)?$/.test(numPart)) return null
  let value = Number(numPart.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(value)) return null
  if (negative) value = -value
  const decimals = numPart.includes(',') ? numPart.split(',')[1].length : 0
  return { value: percent ? value / 100 : value, currency, percent, decimals }
}

/** Aantal decimalen dat bij de keuze hoort. */
function decimalsFor(parsed: ParsedNumber, choice: NumberFormatChoice): number {
  if (choice === 'none') return 0
  if (choice === 'two') return 2
  return parsed.decimals
}

/** Excel-getalopmaak (de "z"-code) voor deze waarde en keuze. */
export function excelNumberFormat(parsed: ParsedNumber, choice: NumberFormatChoice): string {
  if (parsed.percent) {
    const pctDecimals = choice === 'auto' ? Math.max(1, parsed.decimals) : decimalsFor(parsed, choice)
    return pctDecimals > 0 ? `0.${'0'.repeat(pctDecimals)}%` : '0%'
  }
  const decimals = choice === 'auto' ? (Number.isInteger(parsed.value) ? 0 : 2) : decimalsFor(parsed, choice)
  const tail = decimals > 0 ? `.${'0'.repeat(decimals)}` : ''
  if (parsed.currency) return `€ #,##0${tail};[Red]-€ #,##0${tail}`
  return `#,##0${tail};[Red]-#,##0${tail}`
}

/** Schrijft de waarde als Nederlandse tekst (voor Word en Markdown). */
export function formatDutchNumber(parsed: ParsedNumber, choice: NumberFormatChoice): string {
  if (choice === 'auto') return ''
  const decimals = decimalsFor(parsed, choice)
  if (parsed.percent) {
    const pct = (parsed.value * 100).toLocaleString('nl-NL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })
    return `${pct}%`
  }
  const text = parsed.value.toLocaleString('nl-NL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
  return parsed.currency ? `€ ${text}` : text
}

/**
 * Zet een celtekst om volgens de keuze; tekst die geen getal is blijft staan.
 * Bij "auto" verandert er niets.
 */
export function reformatNumberText(raw: string, choice: NumberFormatChoice): string {
  if (choice === 'auto') return raw
  const parsed = parseDutchNumber(raw)
  if (!parsed) return raw
  return formatDutchNumber(parsed, choice)
}
