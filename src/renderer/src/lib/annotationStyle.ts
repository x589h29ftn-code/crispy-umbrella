import type { AnnotationFont } from '../types'

/**
 * CSS equivalents of the annotation fonts for on-screen previews. Arial and
 * Open Sans are embedded in the exported PDF as Liberation Sans / Open Sans
 * (metrically Arial-compatible, open licenses); on screen Windows' own Arial
 * is used when available.
 */
export const ANNOTATION_FONT_CSS: Record<AnnotationFont, string> = {
  arial: "Arial, 'Liberation Sans', Helvetica, sans-serif",
  opensans: "'Open Sans', 'Segoe UI', Calibri, sans-serif",
  helvetica: 'Helvetica, Arial, sans-serif',
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace"
}

export const ANNOTATION_FONT_LABELS: Record<AnnotationFont, string> = {
  arial: 'Arial',
  opensans: 'Open Sans',
  helvetica: 'Helvetica',
  times: 'Times',
  courier: 'Courier'
}

export const HIGHLIGHT_COLORS = ['#ffe100', '#ff5252', '#4cd964', '#3aa0ff', '#ff9500', '#ff4fa3']

/**
 * Kleuren voor tekst, vormen en stempels. Twee rijen van zeven: donkere tinten
 * die op wit papier leesbaar blijven, plus wit voor tekst over een donker vlak.
 */
export const TEXT_COLORS = [
  '#111111',
  '#5f6b7a',
  '#ffffff',
  '#8e1010',
  '#c62828',
  '#e65100',
  '#a67c00',
  '#2e7d32',
  '#00796b',
  '#1565c0',
  '#123a7a',
  '#6a1b9a',
  '#ad1457',
  '#5d4037'
]

/** Namen bij de kleuren, voor de tooltip op een kleurknopje. */
export const TEXT_COLOR_LABELS: Record<string, string> = {
  '#111111': 'Zwart',
  '#5f6b7a': 'Grijs',
  '#ffffff': 'Wit',
  '#8e1010': 'Donkerrood',
  '#c62828': 'Rood',
  '#e65100': 'Oranje',
  '#a67c00': 'Okergeel',
  '#2e7d32': 'Groen',
  '#00796b': 'Turquoise',
  '#1565c0': 'Blauw',
  '#123a7a': 'Donkerblauw',
  '#6a1b9a': 'Paars',
  '#ad1457': 'Framboos',
  '#5d4037': 'Bruin'
}

/** De drie uitlijningen met hun label; de iconen staan in components/icons. */
export const TEXT_ALIGNMENTS: { key: 'left' | 'center' | 'right'; label: string }[] = [
  { key: 'left', label: 'Links uitlijnen' },
  { key: 'center', label: 'Centreren' },
  { key: 'right', label: 'Rechts uitlijnen' }
]

/** CSS-waarde voor onderstrepen en/of doorhalen van een tekstannotatie. */
export function textDecorationOf(style: { underline?: boolean; strike?: boolean }): string {
  const parts: string[] = []
  if (style.underline) parts.push('underline')
  if (style.strike) parts.push('line-through')
  return parts.join(' ')
}

/** Pen widths in PDF points for the draw tool. */
export const INK_WIDTHS = [1.5, 3, 6]
