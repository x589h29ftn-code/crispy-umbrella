import type { SignatureRender } from '../types'
import { resampleSmooth, variableWidthOutline, type Pt } from './geometry'

export interface DrawnStroke {
  pts: Pt[]
  /** Timestamp (ms) per punt, voor snelheidsafhankelijke pendikte. */
  times: number[]
}

export interface DrawOptions {
  /** Basis-pendikte in tekenvlak-pixels. */
  penWidth: number
  /** 0 (ruw) .. 1 (heel glad): bepaalt de hersample-stap. */
  smoothing: number
}

/**
 * Schoont een met de hand getekende handtekening op met dezelfde penlook als
 * de generator: gladgestreken centerlines, snelheidsafhankelijke dikte
 * (langzaam = dik, snel = dun) en spits uitlopende streek-einden.
 */
export function renderDrawing(strokes: DrawnStroke[], opts: DrawOptions): SignatureRender | null {
  const usable = strokes.filter((s) => s.pts.length > 1)
  if (usable.length === 0) return null

  const parts: string[] = []
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity

  for (const stroke of usable) {
    // Snelheid per origineel punt (px/ms), daarna overgedragen op de
    // hersamplede punten via dichtstbijzijnde-index-benadering
    const speeds: number[] = stroke.pts.map((p, i) => {
      if (i === 0) return 0
      const dt = Math.max(1, stroke.times[i] - stroke.times[i - 1])
      return Math.hypot(p[0] - stroke.pts[i - 1][0], p[1] - stroke.pts[i - 1][1]) / dt
    })
    if (speeds.length > 1) speeds[0] = speeds[1]
    const vRef = Math.max(0.4, speeds.reduce((a, b) => a + b, 0) / speeds.length) * 1.8

    const step = 2 + (1 - opts.smoothing) * 6
    const dense = resampleSmooth(stroke.pts, step)

    // Cumulatieve lengte voor eind-taper
    const cum: number[] = [0]
    for (let i = 1; i < dense.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
    }
    const total = cum[dense.length - 1]
    const taperLen = Math.min(total * 0.25, opts.penWidth * 5)

    const widths = dense.map((_, i) => {
      const srcIdx = Math.min(
        speeds.length - 1,
        Math.round((i / Math.max(1, dense.length - 1)) * (speeds.length - 1))
      )
      const v = speeds[srcIdx]
      let w = opts.penWidth * (1.15 - 0.55 * Math.min(1, v / vRef))
      const edge = Math.min(cum[i], total - cum[i])
      if (edge < taperLen) w *= Math.max(0.1, edge / taperLen)
      return w
    })

    const d = variableWidthOutline(dense, widths)
    if (d) parts.push(d)

    for (const p of dense) {
      if (p[0] < x1) x1 = p[0]
      if (p[0] > x2) x2 = p[0]
      if (p[1] < y1) y1 = p[1]
      if (p[1] > y2) y2 = p[1]
    }
  }

  if (!parts.length || !isFinite(x1)) return null
  const m = Math.max(12, opts.penWidth * 3)
  return {
    paths: [{ d: parts.join(' '), fill: 'currentColor' }],
    viewBox: { x: x1 - m, y: y1 - m, w: x2 - x1 + m * 2, h: y2 - y1 + m * 2 }
  }
}
