import type { FlourishKind } from '../types'
import type { BBox } from './layout'
import { smoothPathThrough as smoothPath } from './geometry'

export interface FlourishInput {
  bbox: BBox
  rng: () => number
  intensity: number
}

type Generator = (input: FlourishInput) => string[]

/** Zwierige onderstreping: van rechtsonder in één beweging naar links,
 *  met een dip in het midden; bij hoge intensiteit een tweede, kortere lijn. */
function underline({ bbox, rng, intensity }: FlourishInput): string[] {
  const w = bbox.x2 - bbox.x1
  const h = bbox.y2 - bbox.y1
  const y = bbox.y2 + h * (0.18 + rng() * 0.1)
  const overL = w * (0.06 + rng() * 0.08)
  const overR = w * (0.04 + rng() * 0.08)
  const dip = h * (0.1 + intensity * 0.15) * (0.6 + rng() * 0.8)
  const main = smoothPath([
    [bbox.x2 + overR, y - h * 0.05],
    [bbox.x1 + w * 0.55, y + dip * 0.6],
    [bbox.x1 + w * 0.25, y + dip],
    [bbox.x1 - overL, y + dip * 0.2]
  ])
  const paths = [main]
  if (intensity > 0.7) {
    const y2 = y + dip + h * 0.16
    paths.push(
      smoothPath([
        [bbox.x1 + w * (0.55 + rng() * 0.1), y2],
        [bbox.x1 + w * 0.35, y2 + h * 0.05],
        [bbox.x1 + w * (0.12 + rng() * 0.05), y2 - h * 0.02]
      ])
    )
  }
  return paths
}

/** Doorhaling dwars door het midden (T.Fenlon-stijl): licht stijgende golflijn
 *  die links en rechts voorbij de naam uitloopt. */
function strike({ bbox, rng, intensity }: FlourishInput): string[] {
  const w = bbox.x2 - bbox.x1
  const h = bbox.y2 - bbox.y1
  const midY = bbox.y1 + h * (0.45 + rng() * 0.1)
  const rise = h * (0.1 + intensity * 0.18)
  // Bij hoge intensiteit loopt de lijn ver door, zoals de lange doorhaal-streek
  // in klassieke handtekeningen ("Bankey F.", "Tamsyn").
  const overL = w * (0.1 + intensity * 0.2 + rng() * 0.08)
  const overR = w * (0.12 + intensity * 0.22 + rng() * 0.1)
  return [
    smoothPath([
      [bbox.x1 - overL, midY + rise * 0.7],
      [bbox.x1 + w * 0.3, midY + rise * 0.15],
      [bbox.x1 + w * 0.65, midY - rise * 0.15],
      [bbox.x2 + overR, midY - rise]
    ])
  ]
}

/** Omcirkeling (H.Ramuth-stijl): ± 1,25 omwenteling om de naam, als spiraal
 *  die iets uitzet, beginnend rechts bij het einde van de naam. */
function ellipse({ bbox, rng, intensity }: FlourishInput): string[] {
  const w = bbox.x2 - bbox.x1
  const h = bbox.y2 - bbox.y1
  const cx = bbox.x1 + w / 2
  const cy = bbox.y1 + h * (0.42 + rng() * 0.1)
  const rx0 = w * (0.58 + intensity * 0.1)
  const ry0 = h * (0.75 + intensity * 0.25)
  const tilt = (rng() - 0.5) * 0.2
  const points: [number, number][] = []
  const startDeg = -10 + rng() * 30
  const totalDeg = 380 + intensity * 90
  for (let deg = 0; deg <= totalDeg; deg += 20) {
    const t = ((startDeg + deg) * Math.PI) / 180
    const grow = 0.9 + (deg / totalDeg) * 0.18
    const px = Math.cos(t) * rx0 * grow
    const py = Math.sin(t) * ry0 * grow
    points.push([cx + px + py * tilt, cy + py])
  }
  return [smoothPath(points)]
}

/** Aanloopstreek: komt van linksonder omhoog de eerste letter in. */
function leadIn({ bbox, rng, intensity }: FlourishInput): string[] {
  const w = bbox.x2 - bbox.x1
  const h = bbox.y2 - bbox.y1
  const len = w * (0.12 + intensity * 0.12)
  return [
    smoothPath([
      [bbox.x1 - len, bbox.y2 + h * (0.05 + rng() * 0.1)],
      [bbox.x1 - len * 0.45, bbox.y1 + h * 0.75],
      [bbox.x1 + w * 0.02, bbox.y1 + h * (0.5 + rng() * 0.1)]
    ])
  ]
}

/** Uitloper: vanaf het einde van de naam naar rechts met een opwaartse zwiep. */
function tail({ bbox, rng, intensity }: FlourishInput): string[] {
  const w = bbox.x2 - bbox.x1
  const h = bbox.y2 - bbox.y1
  const len = w * (0.14 + intensity * 0.18)
  const lift = h * (0.3 + intensity * 0.5) * (rng() > 0.4 ? -1 : 1)
  return [
    smoothPath([
      [bbox.x2 - w * 0.02, bbox.y1 + h * (0.55 + rng() * 0.15)],
      [bbox.x2 + len * 0.55, bbox.y2 + h * 0.05],
      [bbox.x2 + len, bbox.y1 + h * 0.5 + lift]
    ])
  ]
}

export const FLOURISH_GENERATORS: Record<FlourishKind, Generator> = {
  underline,
  strike,
  ellipse,
  leadIn,
  tail
}
