import type { Watermark } from '../types'

/** Vaste teksten die we in de praktijk gebruiken; "Eigen tekst" staat los. */
export const WATERMARK_PRESETS = ['CONCEPT', 'NIET VOOR PUBLICATIE', 'VOOR INTERN GEBRUIK'] as const

export type WatermarkColor = 'grijs' | 'rood' | 'blauw'

export const WATERMARK_COLOR_LABELS: Record<WatermarkColor, string> = {
  grijs: 'Grijs',
  rood: 'Rood',
  blauw: 'Blauw'
}

/** RGB-waarden (0-1) per kleurnaam, gedeeld door de export en de voorbeeldweergave. */
export const WATERMARK_COLORS: Record<WatermarkColor, [number, number, number]> = {
  grijs: [0.5, 0.5, 0.5],
  rood: [0.8, 0.15, 0.15],
  blauw: [0.15, 0.3, 0.7]
}

export const DEFAULT_WATERMARK: Watermark = {
  text: 'CONCEPT',
  opacity: 0.25,
  style: 'diagonal',
  color: 'grijs',
  firstPageOnly: false
}

export function watermarkCss(color: WatermarkColor | undefined): string {
  const [r, g, b] = WATERMARK_COLORS[color ?? 'grijs']
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}
