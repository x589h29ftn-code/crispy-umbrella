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
  private nMeadow: NoiseFunction2D
  private nPath: NoiseFunction2D
  private nLake: NoiseFunction2D

  constructor(seedText: string) {
    this.seed = hashString(seedText)
    this.nContinent = seededNoise2D(this.seed, 1)
    this.nHillMask = seededNoise2D(this.seed, 2)
    this.nHills = seededNoise2D(this.seed, 3)
    this.nDetail = seededNoise2D(this.seed, 4)
    this.nMoisture = seededNoise2D(this.seed, 5)
    this.nForest = seededNoise2D(this.seed, 6)
    this.nMeadow = seededNoise2D(this.seed, 7)
    this.nPath = seededNoise2D(this.seed, 8)
    this.nLake = seededNoise2D(this.seed, 9)
  }

  /** Terreinhoogte in meters (zeeniveau = 0). */
  height(x: number, z: number): number {
    // Grote landmassa's en zeeën.
    const continent = fbm(this.nContinent, x, z, 4, 1 / 1400)
    const base = continent * 30 - 2

    // Berggebieden: alleen waar het bergmasker actief is. Ridged ruis geeft
    // scherpe graten en echte toppen tot zo'n 110 m.
    const mask = smoothstep(0.15, 0.65, fbm01(this.nHillMask, x, z, 2, 1 / 900))
    const hills = ridged(this.nHills, x, z, 4, 1 / 260) * 86 * mask

    // Klein reliëf voor een levendig, glooiend oppervlak.
    const detail = fbm(this.nDetail, x, z, 4, 1 / 30) * 1.6

    // Vlakke stranden: reliëf pas laten meedoen boven het strand.
    const land = smoothstep(0, 4, base)
    let h = base + (hills + detail) * land

    // Meertjes: kommen die in laag, vlak terrein tot onder het waterpeil
    // worden uitgesleten. Het globale watervlak (y=0) vult ze vanzelf.
    // Smalle overgangsband = steile oevers, dus gras tot aan de waterlijn.
    const lake = smoothstep(0.6, 0.68, fbm01(this.nLake, x, z, 2, 1 / 420))
    if (lake > 0) {
      const lowland = smoothstep(11, 4.5, h)
      const carve = lake * lowland
      h = h * (1 - carve) + -3.8 * carve
    }
    return h
  }

  /** Meermasker in [0, 1]: 1 midden in een meertje (voor plaatsing/structuren). */
  lakeness(x: number, z: number): number {
    return smoothstep(0.55, 0.66, fbm01(this.nLake, x, z, 2, 1 / 420))
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
    const f = fbm01(this.nForest, x, z, 3, 1 / 420)
    return smoothstep(0.32, 0.5, m * 0.5 + f * 0.5)
  }

  /** Sterkte van het heuvellandschap (0 = vlak, 1 = vol heuvelgebied). */
  hilliness(x: number, z: number): number {
    return smoothstep(0.15, 0.65, fbm01(this.nHillMask, x, z, 2, 1 / 900))
  }

  /**
   * Weidepatronen in [0, 1]: middelgrote kleurvlekken (frisse veldjes,
   * kruidenrijke plekken, bloemenweides) die het grasland levendig maken.
   */
  meadow(x: number, z: number): number {
    return fbm01(this.nMeadow, x, z, 2, 1 / 42)
  }

  /**
   * Kronkelende zandpaadjes in [0, 1]: 1 midden op het pad, 0 ernaast.
   * De nullijn van een ruisveld vormt vanzelf lange, slingerende banen.
   */
  path(x: number, z: number, knownHeight?: number): number {
    const n = fbm(this.nPath, x, z, 2, 1 / 230)
    const band = 1 - smoothstep(0.012, 0.05, Math.abs(n))
    if (band <= 0) return 0
    // Alleen op land: paden lopen door het gras én de bergen op.
    const h = knownHeight ?? this.height(x, z)
    return band * smoothstep(1.6, 2.6, h) * smoothstep(52, 42, h)
  }
}
