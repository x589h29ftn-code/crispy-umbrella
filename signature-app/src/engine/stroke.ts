import type { GenerationParams, SignatureRender, SignatureStyle } from '../types'
import { mulberry32 } from './random'

/**
 * Penstreek-engine: rendert een naam als één doorlopende penlijn op basis van
 * Hershey Script single-stroke letterdata, met pendynamiek (dikke neerhalen,
 * dunne verbindingen), taper (krimpende eindletters) en "scribble"
 * (tussenletters degenereren tot golfjes) — zodat het resultaat als een echte
 * handtekening voelt in plaats van als font-tekst.
 *
 * Hershey-coördinaten: y omlaag, basislijn op y = 17, kapitaal-top ~1,
 * x-hoogte 13..17, staarten tot ~22. Kleine letters zijn één polyline met
 * in-/uitloopstreek op de basislijn, waardoor ze aaneengesloten geschreven
 * kunnen worden.
 */

type Pt = [number, number]

interface HersheyChar {
  d: string
  o: number
}

interface HersheyFont {
  name: string
  chars: HersheyChar[]
}

type HersheyData = Record<string, HersheyFont>

const BASELINE = 17
const UNITS = 21

let dataPromise: Promise<HersheyData> | null = null
let loaded: HersheyData | null = null

export function ensureStrokeFont(): Promise<HersheyData> {
  if (!dataPromise) {
    dataPromise = fetch(`${import.meta.env.BASE_URL}fonts/hershey-script.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`hershey-script.json kon niet worden geladen (${res.status})`)
        return res.json() as Promise<HersheyData>
      })
      .then((json) => {
        loaded = json
        return json
      })
    dataPromise.catch(() => {
      dataPromise = null
    })
  }
  return dataPromise
}

export function strokeFontLoaded(): boolean {
  return loaded !== null
}

/** Parset de Hershey-paddata ("M4,3 L8,5 10,7 …") naar polylines. */
function parseGlyph(d: string): Pt[][] {
  const segments: Pt[][] = []
  for (const chunk of d.split('M')) {
    const nums = chunk.match(/-?\d+(?:\.\d+)?/g)
    if (!nums || nums.length < 4) continue
    const pts: Pt[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])])
    }
    segments.push(pts)
  }
  return segments
}

const glyphCache = new Map<string, Pt[][]>()

function glyphSegments(fontId: string, char: string): Pt[][] | null {
  const font = loaded?.[fontId]
  if (!font) return null
  const idx = char.charCodeAt(0) - 33
  if (idx < 0 || idx >= font.chars.length) return null
  const key = `${fontId}:${char}`
  let segs = glyphCache.get(key)
  if (!segs) {
    segs = parseGlyph(font.chars[idx].d)
    glyphCache.set(key, segs)
  }
  return segs
}

function glyphAdvance(fontId: string, char: string): number {
  const font = loaded?.[fontId]
  if (!font) return 10
  const idx = char.charCodeAt(0) - 33
  if (idx < 0 || idx >= font.chars.length) return 10
  return font.chars[idx].o
}

/** Catmull-Rom-hersampling van een polyline naar een dichte, vloeiende puntenreeks. */
function smoothResample(pts: Pt[], steps = 8): Pt[] {
  if (pts.length < 3) return pts.slice()
  const out: Pt[] = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
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

const fmt = (n: number) => Math.round(n * 100) / 100

/**
 * Bouwt van een centerline een gevulde pen-omtrek: per punt een breedte
 * (dik op neerhalen, dun op verbindingsstreken, uitlopend aan de einden)
 * en offset langs de normalen aan beide zijden.
 */
function penOutline(center: Pt[], baseWidth: number, taperLen: number): string {
  const pts: Pt[] = []
  for (const p of center) {
    const prev = pts[pts.length - 1]
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.05) pts.push(p)
  }
  if (pts.length < 2) return ''

  // Cumulatieve lengte voor eind-taper (pen komt van het papier)
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  const total = cum[pts.length - 1]

  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const len = Math.hypot(tx, ty) || 1
    tx /= len
    ty /= len
    // Pendynamiek: neerhalen (ty > 0, y wijst omlaag) zijn dik, ophalen dun
    const down = Math.max(0, ty)
    let w = baseWidth * (0.45 + 0.55 * down)
    // Eind-taper aan beide kanten van de streek
    const edge = Math.min(cum[i], total - cum[i])
    if (edge < taperLen) w *= Math.max(0.12, edge / taperLen)
    const nx = -ty * (w / 2)
    const ny = tx * (w / 2)
    left.push([pts[i][0] + nx, pts[i][1] + ny])
    right.push([pts[i][0] - nx, pts[i][1] - ny])
  }

  let d = `M${fmt(left[0][0])} ${fmt(left[0][1])}`
  for (let i = 1; i < left.length; i++) d += ` L${fmt(left[i][0])} ${fmt(left[i][1])}`
  for (let i = right.length - 1; i >= 0; i--) d += ` L${fmt(right[i][0])} ${fmt(right[i][1])}`
  return d + ' Z'
}

interface LetterPlan {
  char: string
  isWordStart: boolean
  isWordEnd: boolean
}

function planLetters(text: string): LetterPlan[] {
  const plans: LetterPlan[] = []
  const words = text.split(' ')
  for (let w = 0; w < words.length; w++) {
    const word = words[w]
    for (let i = 0; i < word.length; i++) {
      plans.push({ char: word[i], isWordStart: i === 0, isWordEnd: i === word.length - 1 })
    }
    if (w < words.length - 1) plans.push({ char: ' ', isWordStart: false, isWordEnd: false })
  }
  return plans
}

/** Vervangt een letter door n vloeiende golfjes ("minims") met dezelfde breedte. */
function scribbleWave(advance: number, rng: () => number): Pt[] {
  const humps = Math.max(1, Math.round(advance / 5))
  const pts: Pt[] = [[0, BASELINE + 1.5]]
  for (let i = 0; i < humps; i++) {
    const x0 = (advance * i) / humps
    const x1 = (advance * (i + 1)) / humps
    const top = BASELINE - (3 + rng() * 2.5)
    pts.push([x0 + (x1 - x0) * 0.35, top])
    pts.push([x1, BASELINE + (rng() - 0.3)])
  }
  // Uitloopstreek voorbij de eigen breedte, zoals echte Hershey-letters
  pts.push([advance + 4, BASELINE - 1])
  return pts
}

export function renderStrokeSignature(
  style: SignatureStyle,
  params: GenerationParams,
  text: string,
  seed: number
): SignatureRender | null {
  if (!loaded) return null
  const fontId = style.strokeFontId ?? 'scripts'
  const rng = mulberry32(seed)

  const fontSize = 100 * params.sizeScale
  const unit = fontSize / UNITS
  const slantDeg = style.baseSlantDeg + 0.6 * params.slantDeg
  const shear = Math.tan((slantDeg * Math.PI) / 180)
  const taper = style.taper ?? 0.8
  const jitterAmp = unit * 1.2 * params.jitter
  const wavePhase = rng() * Math.PI * 2

  // Leesbaarheid dempt of versterkt het scribble-effect van de stijl
  const legibilityFactor = params.legibility === 'leesbaar' ? 0.35 : params.legibility === 'abstract' ? 1.15 : 0.8
  const scribbleAmount = Math.min(1, (style.scribble ?? 0) * legibilityFactor)

  const plans = planLetters(text)
  const letterCount = plans.filter((p) => p.char !== ' ').length

  // Eén "lopende" centerline per aaneengeschreven stuk; kapitalen en losse
  // segmenten (t-streepjes, punten) worden aparte streken.
  const strokes: Pt[][] = []
  let running: Pt[] = []
  let cursor = 0
  let letterIdx = 0

  const flush = () => {
    if (running.length > 1) strokes.push(running)
    running = []
  }

  for (const plan of plans) {
    const { char } = plan
    if (char === ' ') {
      flush()
      cursor += 8 * unit
      continue
    }

    const isUpper = char.toUpperCase() === char && char.toLowerCase() !== char
    const isLower = !isUpper && /[a-zà-ž]/i.test(char)
    const taperScale = 1 - taper * 0.3 * (letterIdx / Math.max(1, letterCount - 1))
    const letterScale = unit * taperScale * (isUpper ? style.firstLetterScale : 1)
    const advanceUnits = glyphAdvance(fontId, char)
    const drift = jitterAmp * (rng() - 0.5) * 2 + unit * 0.8 * Math.sin(cursor / (fontSize * 0.9) + wavePhase) * (0.3 + params.jitter)

    const place = (p: Pt): Pt => {
      const px = cursor + p[0] * letterScale
      const py = (p[1] - BASELINE) * letterScale + drift
      return [px - py * shear, py]
    }

    if (isLower && scribbleAmount > 0 && !plan.isWordStart && !plan.isWordEnd && rng() < scribbleAmount) {
      // Degeneratie: golfjes in plaats van de letter, blijft verbonden
      for (const p of scribbleWave(advanceUnits, rng)) running.push(place(p))
    } else {
      const segs = glyphSegments(fontId, char)
      if (segs && segs.length > 0) {
        const main = segs.reduce((a, b) => (b.length > a.length ? b : a))
        if (isLower) {
          for (const p of main) running.push(place(p))
        } else {
          // Kapitaal of leesteken: losse streken (pen even van het papier)
          flush()
          for (const seg of segs) strokes.push(seg.map(place))
        }
        if (isLower) {
          for (const seg of segs) {
            if (seg !== main && seg.length > 1) strokes.push(seg.map(place))
          }
        }
      }
    }

    cursor += advanceUnits * letterScale + style.letterSpacingEm * fontSize
    letterIdx++
  }

  // ── Flourishes, geïntegreerd in de penlijn ──
  const flourishWanted = new Map(style.flourishes.map((f) => [f.kind, f]))
  const endPoint: Pt | null = running.length ? running[running.length - 1] : null

  const tailSpec = flourishWanted.get('tail')
  if (tailSpec && endPoint && rng() < tailSpec.probability * (0.35 + params.flourishIntensity)) {
    // Staart loopt dóór vanuit de laatste letter
    const len = fontSize * (0.5 + tailSpec.intensity * params.flourishIntensity * 0.9)
    const up = rng() > 0.35 ? -1 : 1
    running.push([endPoint[0] + len * 0.4, endPoint[1] - unit * 1.5])
    running.push([endPoint[0] + len * 0.75, endPoint[1] + unit * 3 * up * -1])
    running.push([endPoint[0] + len, endPoint[1] + up * unit * 6])
  }
  flush()

  // Bbox van de hoofdstreken voor strike/underline/leadIn
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const s of strokes) {
    for (const p of s) {
      if (p[0] < x1) x1 = p[0]
      if (p[0] > x2) x2 = p[0]
      if (p[1] < y1) y1 = p[1]
      if (p[1] > y2) y2 = p[1]
    }
  }
  if (!isFinite(x1)) return null
  const w = x2 - x1

  const strikeSpec = flourishWanted.get('strike')
  const underlineSpec = flourishWanted.get('underline')
  const anchor: Pt = endPoint ?? [x2, (y1 + y2) / 2]
  if (strikeSpec && rng() < strikeSpec.probability * (0.35 + params.flourishIntensity)) {
    // Lange doorhaal-streek die begint bij het einde van de naam en over de
    // hele naam terugzwiept (Bankey F./Tamsyn-look)
    const inten = strikeSpec.intensity * (0.5 + params.flourishIntensity * 0.7)
    const yMid = y1 + (y2 - y1) * (0.32 + rng() * 0.12)
    strokes.push([
      [anchor[0] + unit * 2, anchor[1] - unit * 2],
      [x2 + w * (0.12 + inten * 0.18), yMid - unit * (1 + rng() * 2)],
      [x1 + w * 0.45, yMid + unit * (rng() - 0.5) * 2],
      [x1 - w * (0.1 + inten * 0.2), yMid + unit * (1.5 + rng() * 1.5)]
    ])
  } else if (underlineSpec && params.underlineBias > 0 && rng() < underlineSpec.probability * (0.35 + params.flourishIntensity) * params.underlineBias) {
    const yLine = y2 + unit * (2 + rng() * 1.5)
    strokes.push([
      [anchor[0] + unit, anchor[1]],
      [x2 + w * 0.08, yLine - unit],
      [x1 + w * 0.4, yLine + unit * 1.2],
      [x1 - w * 0.08, yLine]
    ])
  }

  const leadSpec = flourishWanted.get('leadIn')
  if (leadSpec && rng() < leadSpec.probability * (0.35 + params.flourishIntensity)) {
    strokes.push([
      [x1 - w * 0.14, y2 + unit * 2],
      [x1 - w * 0.05, (y1 + y2) / 2],
      [x1 + unit * 2, y1 + (y2 - y1) * 0.4]
    ])
  }

  // ── Centerlines → vloeiende pen-omtrekken ──
  const penWidth = (style.penWidthEm ?? 0.035) * fontSize * params.strokeScale
  const parts: string[] = []
  for (const s of strokes) {
    let len = 0
    for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1])
    if (len < penWidth * 2.5) {
      // Te kort voor een streek (bv. de punt na een voorletter): teken een inktpunt
      const cx = s.reduce((a, p) => a + p[0], 0) / s.length
      const cy = s.reduce((a, p) => a + p[1], 0) / s.length
      const r = penWidth * 0.65
      parts.push(
        `M${fmt(cx - r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)} Z`
      )
      continue
    }
    const dense = smoothResample(s)
    const outline = penOutline(dense, penWidth, fontSize * 0.12)
    if (outline) parts.push(outline)
  }

  const render: SignatureRender = {
    paths: [{ d: parts.join(' '), fill: 'currentColor' }],
    viewBox: { x: 0, y: 0, w: 1, h: 1 }
  }

  // Werkelijke grenzen inclusief flourishes + marge
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity
  for (const s of strokes) {
    for (const p of s) {
      if (p[0] < bx1) bx1 = p[0]
      if (p[0] > bx2) bx2 = p[0]
      if (p[1] < by1) by1 = p[1]
      if (p[1] > by2) by2 = p[1]
    }
  }
  const m = fontSize * 0.14
  render.viewBox = { x: bx1 - m, y: by1 - m, w: bx2 - bx1 + m * 2, h: by2 - by1 + m * 2 }
  return render
}
