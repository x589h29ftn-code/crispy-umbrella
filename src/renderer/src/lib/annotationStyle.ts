import type { AnnotationFont } from '../types'

/** CSS approximations of the PDF standard fonts, for on-screen annotation previews. */
export const ANNOTATION_FONT_CSS: Record<AnnotationFont, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace"
}

export const ANNOTATION_FONT_LABELS: Record<AnnotationFont, string> = {
  helvetica: 'Helvetica',
  times: 'Times',
  courier: 'Courier'
}

export const HIGHLIGHT_COLORS = ['#ffe100', '#ff5252', '#4cd964', '#3aa0ff', '#ff9500', '#ff4fa3']

export const TEXT_COLORS = ['#111111', '#c62828', '#1565c0', '#2e7d32']
