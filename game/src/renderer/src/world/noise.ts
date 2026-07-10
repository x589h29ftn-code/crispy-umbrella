import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'
import { mulberry32, combineSeed } from '../core/rng'

/** Maakt een geseede 2D-simplexruis met eigen sub-seed. */
export function seededNoise2D(seed: number, salt: number): NoiseFunction2D {
  return createNoise2D(mulberry32(combineSeed(seed, salt)))
}

/** Fractale Brownse beweging: gestapelde octaven ruis, resultaat in ~[-1, 1]. */
export function fbm(
  noise: NoiseFunction2D,
  x: number,
  y: number,
  octaves: number,
  frequency: number,
  lacunarity = 2,
  gain = 0.5
): number {
  let sum = 0
  let amp = 1
  let ampSum = 0
  let freq = frequency
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp
    ampSum += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / ampSum
}

/** fbm herschaald naar [0, 1]. */
export function fbm01(
  noise: NoiseFunction2D,
  x: number,
  y: number,
  octaves: number,
  frequency: number
): number {
  return fbm(noise, x, y, octaves, frequency) * 0.5 + 0.5
}

/** Ridged ruis: scherpe bergkammen, resultaat in [0, 1]. */
export function ridged(
  noise: NoiseFunction2D,
  x: number,
  y: number,
  octaves: number,
  frequency: number
): number {
  let sum = 0
  let amp = 0.5
  let ampSum = 0
  let freq = frequency
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * freq, y * freq))
    sum += n * n * amp
    ampSum += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / ampSum
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
