import type { NoiseFunction2D } from 'simplex-noise'
import { hashString } from '../core/rng'
import { seededNoise2D, fbm, fbm01, ridged, smoothstep } from './noise'

export const SEA_LEVEL = 0
export const CHUNK_SIZE = 64

/**
 * Pure terreinfuncties: hoogte, normaal en vochtigheid als continue functies
 * van wereldcoördinaten. Physics én mesh-generatie gebruiken exact dezelfde
 * functie, dus de speler loopt altijd perfect op het zichtbare terrein.
 */
export class World {
  readonly seed: number
  private nContinent: NoiseFunction2D
  private nHillMask: NoiseFunction2D
  private nHills: NoiseFunction2D
  private nDetail: NoiseFunction2D
  private nMoisture: NoiseFunction2D
  private nForest: NoiseFunction2D

  constructor(seedText: string) {
    this.seed = hashString(seedText)
    this.nContinent = seededNoise2D(this.seed, 1)
    this.nHillMask = seededNoise2D(this.seed, 2)
    this.nHills = seededNoise2D(this.seed, 3)
    this.nDetail = seededNoise2D(this.seed, 4)
    this.nMoisture = seededNoise2D(this.seed, 5)
    this.nForest = seededNoise2D(this.seed, 6)
  }

  /** Terreinhoogte in meters (zeeniveau = 0). */
  height(x: number, z: number): number {
    // Grote landmassa's en zeeën.
    const continent = fbm(this.nContinent, x, z, 4, 1 / 1400)
    const base = continent * 30 - 2

    // Heuvelgebieden: alleen waar het heuvelmasker actief is.
    const mask = smoothstep(0.15, 0.65, fbm01(this.nHillMask, x, z, 2, 1 / 900))
    const hills = ridged(this.nHills, x, z, 4, 1 / 160) * 26 * mask

    // Klein reliëf voor een levendig, glooiend oppervlak.
    const detail = fbm(this.nDetail, x, z, 3, 1 / 28) * 1.4

    // Vlakke stranden: reliëf pas laten meedoen boven het strand.
    const land = smoothstep(0, 4, base)
    return base + (hills + detail) * land
  }

  /** Genormaliseerde terreinnormaal via central differences. */
  normal(x: number, z: number, out?: { x: number; y: number; z: number }): {
    x: number
    y: number
    z: number
  } {
    const eps = 0.5
    const hx = this.height(x + eps, z) - this.height(x - eps, z)
    const hz = this.height(x, z + eps) - this.height(x, z - eps)
    const nx = -hx
    const ny = 2 * eps
    const nz = -hz
    const inv = 1 / Math.hypot(nx, ny, nz)
    const n = out ?? { x: 0, y: 0, z: 0 }
    n.x = nx * inv
    n.y = ny * inv
    n.z = nz * inv
    return n
  }

  /** Vochtigheid in [0, 1]: stuurt grasland vs. bos. */
  moisture(x: number, z: number): number {
    return fbm01(this.nMoisture, x, z, 3, 1 / 500)
  }

  /** Bosdichtheid in [0, 1]: aparte laag zodat bosranden organisch zijn. */
  forestness(x: number, z: number): number {
    const m = this.moisture(x, z)
    const f = fbm01(this.nForest, x, z, 3, 1 / 260)
    return smoothstep(0.45, 0.62, m * 0.5 + f * 0.5)
  }

  /** Sterkte van het heuvellandschap (0 = vlak, 1 = vol heuvelgebied). */
  hilliness(x: number, z: number): number {
    return smoothstep(0.15, 0.65, fbm01(this.nHillMask, x, z, 2, 1 / 900))
  }
}
