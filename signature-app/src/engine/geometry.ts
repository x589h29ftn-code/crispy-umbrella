/** Gedeelde geometrie-helpers voor vloeiende, resolutie-onafhankelijke paden. */

export type Pt = [number, number]

export const fmt = (n: number): number => Math.round(n * 100) / 100

/** Catmull-Rom door de punten → cubic-Bézier-segmenten (zonder leidende M). */
export function bezierSegments(p: Pt[]): string {
  let d = ''
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[Math.min(p.length - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`
  }
  return d
}

/** Volledig vloeiend pad door de punten (M + Bézier-segmenten). */
export function smoothPathThrough(points: Pt[]): string {
  if (points.length < 2) return ''
  return `M${fmt(points[0][0])} ${fmt(points[0][1])}${bezierSegments(points)}`
}

/** Catmull-Rom-hersampling met booglengte-adaptieve dichtheid: lange segmenten
 *  krijgen meer tussenpunten, zodat er nergens facetten ontstaan. */
export function resampleSmooth(pts: Pt[], step: number): Pt[] {
  if (pts.length < 3) return pts.slice()
  const out: Pt[] = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const n = Math.min(32, Math.max(4, Math.ceil(segLen / step)))
    for (let s = 1; s <= n; s++) {
      const t = s / n
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ])
    }
  }
  return out
}
