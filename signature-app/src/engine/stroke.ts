import type { GenerationParams, SignatureRender, SignatureStep, SignatureStyle } from '../types'
import { mulberry32 } from './random'
import { fmt, resampleSmooth, smoothPathThrough, variableWidthOutline, type Pt } from './geometry'

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

/**
 * Bouwt van een centerline een gevulde pen-omtrek: dik op neerhalen, dun op
 * verbindingsstreken, spits uitlopend aan de einden.
 */
function penOutline(center: Pt[], baseWidth: number, taperLen: number): string {
  if (center.length < 2) return ''
  const cum: number[] = [0]
  for (let i = 1; i < center.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(center[i][0] - center[i - 1][0], center[i][1] - center[i - 1][1]))
  }
  const total = cum[center.length - 1]
  const widths = center.map((_, i) => {
    const a = center[Math.max(0, i - 1)]
    const b = center[Math.min(center.length - 1, i + 1)]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    // Pendynamiek: neerhalen (y wijst omlaag) zijn dik, ophalen dun
    const down = Math.max(0, (b[1] - a[1]) / len)
    let w = baseWidth * (0.45 + 0.55 * down)
    const edge = Math.min(cum[i], total - cum[i])
    if (edge < taperLen) w *= Math.max(0.08, edge / taperLen)
    return w
  })
  return variableWidthOutline(center, widths)
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

/** Accenttekens als losse pennenstreken boven/onder de letter (glyph-eenheden,
 *  basislijn op BASELINE). De Hershey-data is ASCII; zo blijven é, ë, ü, ç
 *  gewoon leesbaar in namen als "René" of "Zoë". */
function accentSegments(mark: string, advance: number, isUpper: boolean): Pt[][] {
  const cx = advance * 0.5
  const y = isUpper ? -1 : 10.5
  switch (mark) {
    case '̀': // grave
      return [[[cx - 1.5, y], [cx + 1.5, y + 2.2]]]
    case '̂': // circumflex
      return [[[cx - 2, y + 2.2], [cx, y], [cx + 2, y + 2.2]]]
    case '̃': // tilde
      return [[[cx - 2.2, y + 1.6], [cx - 0.8, y], [cx + 0.8, y + 1.6], [cx + 2.2, y]]]
    case '̈': // trema/umlaut: twee inktpunten
      return [
        [[cx - 2, y + 0.6], [cx - 1.7, y + 0.9]],
        [[cx + 1.7, y + 0.6], [cx + 2, y + 0.9]]
      ]
    case '̊': // ring (å)
      return [[[cx - 1.2, y + 1], [cx, y - 0.2], [cx + 1.2, y + 1], [cx, y + 2.2], [cx - 1.2, y + 1]]]
    case '̧': // cedille (ç)
      return [[[cx, BASELINE + 0.5], [cx + 1, BASELINE + 2], [cx - 0.8, BASELINE + 3.2]]]
    default: // acute en overige
      return [[[cx - 1.5, y + 2.2], [cx + 1.5, y]]]
  }
}

/** Eén penstreek met betekenis, in schrijfvolgorde. */
interface StrokeRec {
  pts: Pt[]
  kind: 'capital' | 'run' | 'mark' | 'flourish'
  text?: string
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

  // Hoofdstreken in schrijfvolgorde; punten/dwarsstreepjes en zwierstreken
  // komen daarna (zoals je ook echt schrijft).
  const mains: StrokeRec[] = []
  const marks: StrokeRec[] = []
  const flourishStrokes: StrokeRec[] = []
  let running: Pt[] = []
  let runText = ''
  let cursor = 0
  let letterIdx = 0

  const flush = () => {
    if (running.length > 1) mains.push({ pts: running, kind: 'run', text: runText })
    running = []
    runText = ''
  }

  for (const plan of plans) {
    if (plan.char === ' ') {
      flush()
      cursor += 8 * unit
      continue
    }

    // Accenten afsplitsen: de ASCII-basisletter door het normale pad,
    // het accent als losse pennenstreek erboven/eronder
    const decomposed = plan.char.normalize('NFD')
    const char = decomposed[0]
    const accents = [...decomposed.slice(1)].filter((c) => {
      const code = c.charCodeAt(0)
      return code >= 0x0300 && code <= 0x036f
    })

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
      runText += char
    } else {
      const segs = glyphSegments(fontId, char)
      if (segs && segs.length > 0) {
        const main = segs.reduce((a, b) => (b.length > a.length ? b : a))
        if (isLower) {
          for (const p of main) running.push(place(p))
          runText += char
          for (const seg of segs) {
            if (seg !== main && seg.length > 1) marks.push({ pts: seg.map(place), kind: 'mark' })
          }
        } else {
          // Kapitaal of leesteken: losse streken (pen even van het papier)
          flush()
          const placed = segs.map((seg) => seg.map(place))
          if (isUpper) {
            for (const seg of placed) mains.push({ pts: seg, kind: 'capital', text: char })
          } else {
            for (const seg of placed) marks.push({ pts: seg, kind: 'mark' })
          }
        }
      }
    }

    for (const accent of accents) {
      for (const seg of accentSegments(accent, advanceUnits, isUpper)) {
        marks.push({ pts: seg.map(place), kind: 'mark' })
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
  for (const s of [...mains, ...marks]) {
    for (const p of s.pts) {
      if (p[0] < x1) x1 = p[0]
      if (p[0] > x2) x2 = p[0]
      if (p[1] < y1) y1 = p[1]
      if (p[1] > y2) y2 = p[1]
    }
  }
  if (!isFinite(x1)) return null
  const w = x2 - x1

  const strikeSpec = flourishWanted.get('strike')
  const ellipseSpec = flourishWanted.get('ellipse')
  const underlineSpec = flourishWanted.get('underline')
  const lastMain = mains[mains.length - 1]
  const anchor: Pt = lastMain ? lastMain.pts[lastMain.pts.length - 1] : [x2, (y1 + y2) / 2]
  if (ellipseSpec && rng() < ellipseSpec.probability * (0.35 + params.flourishIntensity)) {
    // Omcirkeling (H.Ramuth-look): vanuit het einde van de naam ~1,2 omwenteling
    // om de hele naam, met licht uitzettende straal
    const inten = ellipseSpec.intensity * (0.5 + params.flourishIntensity * 0.7)
    const cx = x1 + w / 2
    const cy = y1 + (y2 - y1) * (0.42 + rng() * 0.08)
    const rx = w * (0.6 + inten * 0.12)
    const ry = (y2 - y1) * (0.85 + inten * 0.35)
    const tilt = (rng() - 0.5) * 0.18
    const startDeg = -8 + rng() * 20
    const totalDeg = 395 + inten * 55
    const pts: Pt[] = [[anchor[0] + unit, anchor[1] - unit]]
    for (let deg = 0; deg <= totalDeg; deg += 18) {
      const t = ((startDeg + deg) * Math.PI) / 180
      const grow = 0.92 + (deg / totalDeg) * 0.16
      const py = Math.sin(t) * ry * grow
      pts.push([cx + Math.cos(t) * rx * grow + py * tilt, cy + py])
    }
    flourishStrokes.push({ kind: 'flourish', pts })
  } else if (strikeSpec && rng() < strikeSpec.probability * (0.35 + params.flourishIntensity)) {
    // Lange doorhaal-streek die begint bij het einde van de naam en over de
    // hele naam terugzwiept (Bankey F./Tamsyn-look)
    const inten = strikeSpec.intensity * (0.5 + params.flourishIntensity * 0.7)
    const yMid = y1 + (y2 - y1) * (0.32 + rng() * 0.12)
    flourishStrokes.push({
      kind: 'flourish',
      pts: [
        [anchor[0] + unit * 2, anchor[1] - unit * 2],
        [x2 + w * (0.12 + inten * 0.18), yMid - unit * (1 + rng() * 2)],
        [x1 + w * 0.45, yMid + unit * (rng() - 0.5) * 2],
        [x1 - w * (0.1 + inten * 0.2), yMid + unit * (1.5 + rng() * 1.5)]
      ]
    })
  } else if (underlineSpec && params.underlineBias > 0 && rng() < underlineSpec.probability * (0.35 + params.flourishIntensity) * params.underlineBias) {
    const yLine = y2 + unit * (2 + rng() * 1.5)
    flourishStrokes.push({
      kind: 'flourish',
      pts: [
        [anchor[0] + unit, anchor[1]],
        [x2 + w * 0.08, yLine - unit],
        [x1 + w * 0.4, yLine + unit * 1.2],
        [x1 - w * 0.08, yLine]
      ]
    })
  }

  const leadSpec = flourishWanted.get('leadIn')
  if (leadSpec && rng() < leadSpec.probability * (0.35 + params.flourishIntensity)) {
    flourishStrokes.push({
      kind: 'flourish',
      pts: [
        [x1 - w * 0.14, y2 + unit * 2],
        [x1 - w * 0.05, (y1 + y2) / 2],
        [x1 + unit * 2, y1 + (y2 - y1) * 0.4]
      ]
    })
  }

  const allStrokes = [...mains, ...marks, ...flourishStrokes]

  // ── Centerlines → vloeiende pen-omtrekken (Bézier, resolutie-onafhankelijk) ──
  const penWidth = (style.penWidthEm ?? 0.035) * fontSize * params.strokeScale
  const sampleStep = fontSize / 30
  const outlineOf = (rec: StrokeRec): string => {
    let len = 0
    for (let i = 1; i < rec.pts.length; i++) {
      len += Math.hypot(rec.pts[i][0] - rec.pts[i - 1][0], rec.pts[i][1] - rec.pts[i - 1][1])
    }
    if (len < penWidth * 2.5) {
      // Te kort voor een streek (bv. de punt na een voorletter): een inktpunt
      const cx = rec.pts.reduce((a, p) => a + p[0], 0) / rec.pts.length
      const cy = rec.pts.reduce((a, p) => a + p[1], 0) / rec.pts.length
      const r = penWidth * 0.65
      return `M${fmt(cx - r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)} Z`
    }
    return penOutline(resampleSmooth(rec.pts, sampleStep), penWidth, fontSize * 0.12)
  }

  const outlines = allStrokes.map((rec) => ({ rec, d: outlineOf(rec) })).filter((o) => o.d)

  // ── Tekenstappen voor het oefenblad (in schrijfvolgorde, gegroepeerd) ──
  const steps: SignatureStep[] = []
  const pushStep = (label: string, group: typeof outlines) => {
    if (!group.length) return
    const first = group[0].rec.pts
    const dir: Pt = first.length > 1 ? [first[1][0] - first[0][0], first[1][1] - first[0][1]] : [1, 0]
    // Centerline-gids voor de teken-animatie: het pad dat de pen aflegt
    let guideLen = 0
    const guideParts: string[] = []
    for (const g of group) {
      const dense = resampleSmooth(g.rec.pts, sampleStep * 2)
      for (let j = 1; j < dense.length; j++) {
        guideLen += Math.hypot(dense[j][0] - dense[j - 1][0], dense[j][1] - dense[j - 1][1])
      }
      const gd = smoothPathThrough(dense)
      if (gd) guideParts.push(gd)
    }
    steps.push({
      label,
      paths: [{ d: group.map((g) => g.d).join(' '), fill: 'currentColor' }],
      start: [first[0][0], first[0][1]],
      dir,
      guide: guideParts.length ? { d: guideParts.join(' '), len: guideLen, width: penWidth * 1.8 } : undefined
    })
  }
  let i = 0
  while (i < outlines.length) {
    const { rec } = outlines[i]
    if (rec.kind === 'capital') {
      const group = []
      while (i < outlines.length && outlines[i].rec.kind === 'capital' && outlines[i].rec.text === rec.text) group.push(outlines[i++])
      pushStep(`Zet de hoofdletter ${rec.text ?? ''}`.trim(), group)
    } else if (rec.kind === 'run') {
      pushStep(`Schrijf "${rec.text ?? ''}" in één vloeiende beweging`, [outlines[i++]])
    } else if (rec.kind === 'mark') {
      const group = []
      while (i < outlines.length && outlines[i].rec.kind === 'mark') group.push(outlines[i++])
      pushStep('Zet de puntjes en dwarsstreepjes', group)
    } else {
      const group = []
      while (i < outlines.length && outlines[i].rec.kind === 'flourish') group.push(outlines[i++])
      pushStep('Sluit af met de zwierstreek', group)
    }
  }

  // Werkelijke grenzen inclusief flourishes + marge
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity
  for (const s of allStrokes) {
    for (const p of s.pts) {
      if (p[0] < bx1) bx1 = p[0]
      if (p[0] > bx2) bx2 = p[0]
      if (p[1] < by1) by1 = p[1]
      if (p[1] > by2) by2 = p[1]
    }
  }
  const m = fontSize * 0.14
  return {
    paths: [{ d: outlines.map((o) => o.d).join(' '), fill: 'currentColor' }],
    viewBox: { x: bx1 - m, y: by1 - m, w: bx2 - bx1 + m * 2, h: by2 - by1 + m * 2 },
    steps
  }
}
