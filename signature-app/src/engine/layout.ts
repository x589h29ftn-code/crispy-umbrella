import type opentype from 'opentype.js'

export interface LayoutOptions {
  fontSize: number
  letterSpacingEm: number
  firstLetterScale: number
  baselineDriftEm: number
  jitter: number
  slantDeg: number
}

export interface BBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface LayoutResult {
  d: string
  bbox: BBox
  /** Per-glyph subpaden in schrijfvolgorde (voor de tekenstappen op het oefenblad). */
  glyphs: { char: string; d: string }[]
}

/** Zet tekst om in één SVG-paddata-string. De schuinte (skew) wordt direct op de
 *  padcoördinaten toegepast zodat de geëxporteerde SVG geen transforms nodig heeft.
 *  Baseline ligt op y = 0; punten boven de baseline hebben negatieve y. */
export function layoutText(
  font: opentype.Font,
  text: string,
  opts: LayoutOptions,
  rng: () => number
): LayoutResult {
  const { fontSize, letterSpacingEm, firstLetterScale, baselineDriftEm, jitter, slantDeg } = opts
  const shear = Math.tan((slantDeg * Math.PI) / 180)
  const glyphs: { char: string; d: string }[] = []
  const bbox: BBox = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }

  let x = 0
  let prevGlyph: opentype.Glyph | null = null
  let isFirstLetter = true

  for (const char of text) {
    const glyph = font.charToGlyph(char)
    const glyphSize = isFirstLetter && char !== ' ' ? fontSize * firstLetterScale : fontSize
    const scale = glyphSize / font.unitsPerEm

    if (prevGlyph) {
      x += (font.getKerningValue(prevGlyph, glyph) * fontSize) / font.unitsPerEm
      x += letterSpacingEm * fontSize
    }

    if (char !== ' ') {
      const drift = baselineDriftEm * fontSize * (rng() - 0.5) * 2 * (0.4 + jitter)
      const path = glyph.getPath(x, drift, glyphSize)
      const parts: string[] = []
      appendPath(parts, bbox, path, shear)
      if (parts.length) glyphs.push({ char, d: parts.join(' ') })
      isFirstLetter = false
    }

    x += (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale
    prevGlyph = glyph
  }

  if (!isFinite(bbox.x1)) {
    bbox.x1 = bbox.y1 = 0
    bbox.x2 = bbox.y2 = 1
  }
  return { d: glyphs.map((g) => g.d).join(' '), bbox, glyphs }
}

const fmt = (n: number) => Math.round(n * 100) / 100

/** Voegt de commando's van een opentype-pad toe, met skew op elke coördinaat. */
function appendPath(parts: string[], bbox: BBox, path: opentype.Path, shear: number): void {
  const tx = (px: number, py: number): [number, number] => {
    const nx = px - py * shear
    if (nx < bbox.x1) bbox.x1 = nx
    if (nx > bbox.x2) bbox.x2 = nx
    if (py < bbox.y1) bbox.y1 = py
    if (py > bbox.y2) bbox.y2 = py
    return [nx, py]
  }
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M': {
        const [nx, ny] = tx(cmd.x, cmd.y)
        parts.push(`M${fmt(nx)} ${fmt(ny)}`)
        break
      }
      case 'L': {
        const [nx, ny] = tx(cmd.x, cmd.y)
        parts.push(`L${fmt(nx)} ${fmt(ny)}`)
        break
      }
      case 'Q': {
        const [cx, cy] = tx(cmd.x1, cmd.y1)
        const [nx, ny] = tx(cmd.x, cmd.y)
        parts.push(`Q${fmt(cx)} ${fmt(cy)} ${fmt(nx)} ${fmt(ny)}`)
        break
      }
      case 'C': {
        const [c1x, c1y] = tx(cmd.x1, cmd.y1)
        const [c2x, c2y] = tx(cmd.x2, cmd.y2)
        const [nx, ny] = tx(cmd.x, cmd.y)
        parts.push(`C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(nx)} ${fmt(ny)}`)
        break
      }
      case 'Z':
        parts.push('Z')
        break
    }
  }
}
