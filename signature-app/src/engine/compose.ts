import type { GenerationParams, SignatureRender, SignatureStyle } from '../types'
import { FLOURISH_GENERATORS } from './flourishes'
import { getLoadedFont } from './fontManager'
import { layoutText, type BBox } from './layout'
import { mulberry32 } from './random'
import { renderStrokeSignature } from './stroke'

export const DEFAULT_PARAMS: GenerationParams = {
  slantDeg: 8,
  strokeScale: 1,
  sizeScale: 1,
  jitter: 0.3,
  flourishIntensity: 0.6,
  underlineBias: 1,
  legibility: 'gemengd'
}

/** Past de casing-transform van een stijl toe op de gekozen naamvariant. */
export function applyCase(text: string, transform: SignatureStyle['caseTransform']): string {
  switch (transform) {
    case 'lower':
      return text.charAt(0) + text.slice(1).toLowerCase()
    case 'initialsOnly': {
      const parts = text.split(/\s+/).filter(Boolean)
      if (parts.length === 1) return parts[0].slice(0, 2)
      return parts.map((p) => p[0]).join('')
    }
    default:
      return text
  }
}

/** Kern van de engine: stijl + gebruikersparameters + tekst + seed → vector-paden.
 *  Synchroon; het font moet vooraf met ensureFont(style.fontId) geladen zijn. */
export function renderSignature(
  style: SignatureStyle,
  params: GenerationParams,
  text: string,
  seed: number
): SignatureRender | null {
  if (style.engine === 'stroke') {
    return renderStrokeSignature(style, params, applyCase(text, style.caseTransform), seed)
  }
  const font = getLoadedFont(style.fontId)
  if (!font) return null

  const rng = mulberry32(seed)
  const fontSize = 100 * params.sizeScale
  const displayText = applyCase(text, style.caseTransform)

  // Stijl en gebruiker gemengd: de stijl geeft de basis, de antwoorden sturen bij.
  const slantDeg = style.baseSlantDeg + 0.6 * params.slantDeg
  const { d, bbox } = layoutText(
    font,
    displayText,
    {
      fontSize,
      letterSpacingEm: style.letterSpacingEm,
      firstLetterScale: style.firstLetterScale,
      baselineDriftEm: style.baselineDriftEm,
      jitter: params.jitter,
      slantDeg
    },
    rng
  )

  const inkWidth = style.strokeWidthEm * fontSize * params.strokeScale
  const paths: SignatureRender['paths'] = [
    { d, fill: 'currentColor', stroke: 'currentColor', strokeWidth: inkWidth }
  ]

  const flourishWidth = Math.max(inkWidth, fontSize * 0.014 * params.strokeScale)
  let usedStrikeOrEllipse = false
  for (const spec of style.flourishes) {
    let probability = spec.probability * (0.35 + params.flourishIntensity)
    if (spec.kind === 'underline') probability *= params.underlineBias
    if ((spec.kind === 'strike' || spec.kind === 'ellipse') && usedStrikeOrEllipse) continue
    if (rng() >= probability) continue
    if (spec.kind === 'strike' || spec.kind === 'ellipse') usedStrikeOrEllipse = true

    const intensity = Math.min(1, spec.intensity * (0.5 + params.flourishIntensity * 0.7))
    for (const d2 of FLOURISH_GENERATORS[spec.kind]({ bbox, rng, intensity })) {
      paths.push({ d: d2, fill: 'none', stroke: 'currentColor', strokeWidth: flourishWidth })
    }
  }

  return { paths, viewBox: viewBoxFor(paths, bbox, fontSize) }
}

/** Werkelijke grenzen van alle paden (coördinatenparen in de d-strings; Bézier-
 *  controlepunten omsluiten de curve) plus een kleine ademruimte-marge. */
function viewBoxFor(paths: SignatureRender['paths'], textBBox: BBox, fontSize: number) {
  let { x1, y1, x2, y2 } = textBBox
  for (const p of paths) {
    const nums = p.d.match(/-?\d+(?:\.\d+)?/g)
    if (!nums) continue
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const px = parseFloat(nums[i])
      const py = parseFloat(nums[i + 1])
      if (px < x1) x1 = px
      if (px > x2) x2 = px
      if (py < y1) y1 = py
      if (py > y2) y2 = py
    }
  }
  const m = fontSize * 0.12
  return { x: x1 - m, y: y1 - m, w: x2 - x1 + m * 2, h: y2 - y1 + m * 2 }
}
