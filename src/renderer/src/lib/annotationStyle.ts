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

export const TEXT_COLORS = ['#111111', '#c62828', '#1565c0', '#2e7d32']

/** Pen widths in PDF points for the draw tool. */
export const INK_WIDTHS = [1.5, 3, 6]
