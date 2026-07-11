import { clamp, lerp, smoothstep } from './noise'
import type { World } from './terrain'

// Vrolijk low-poly palet (RGB in [0,1]).
// Warm, licht limoen-olijf palet zoals de referentie: zonnig gras,
// pastelkleurige rotsen en zandige paden.
const COLORS = {
  sandWet: [0.78, 0.68, 0.5],
  sand: [0.93, 0.85, 0.62],
  grass: [0.5, 0.66, 0.27],
  meadowFresh: [0.65, 0.78, 0.34], // zonnige lichte veldjes
  meadowHerb: [0.42, 0.6, 0.25], // kruidenrijk, iets dieper groen
  forest: [0.33, 0.52, 0.22],
  forestFloor: [0.38, 0.43, 0.2], // strooisellaag onder dichte bomen
  path: [0.68, 0.55, 0.36], // aangestampte zandpaadjes, licht tan
  rock: [0.66, 0.63, 0.58], // pastel beige-grijs
  snow: [0.94, 0.95, 0.97]
} as const

type Rgb = [number, number, number]

function mix(out: Rgb, target: readonly number[], t: number): void {
  out[0] = lerp(out[0], target[0], t)
  out[1] = lerp(out[1], target[1], t)
  out[2] = lerp(out[2], target[2], t)
}

/** Regiogewichten: welke streek-flavour geldt hier (sommen niet tot 1). */
export function regionWeights(
  world: World,
  x: number,
  z: number
): { swamp: number; birch: number; flower: number; autumn: number } {
  const r = world.region(x, z)
  return {
    swamp: smoothstep(0.22, 0.12, r),
    birch: smoothstep(0.36, 0.43, r) * smoothstep(0.56, 0.49, r),
    flower: smoothstep(0.59, 0.64, r) * smoothstep(0.73, 0.68, r),
    autumn: smoothstep(0.78, 0.88, r)
  }
}

/**
 * Vertex-kleur voor een terreinpunt: vloeiende blend tussen biomen op basis
 * van hoogte, bosdichtheid en helling. `jitter` (0..1) geeft per vertex een
 * subtiele variatie voor het handgemaakte low-poly gevoel.
 */
export function terrainColor(
  world: World,
  x: number,
  z: number,
  height: number,
  normalY: number,
  jitter: number,
  out: Rgb
): Rgb {
  // Basis: zand onder/rond zeeniveau, daarboven gras.
  out[0] = COLORS.sandWet[0]
  out[1] = COLORS.sandWet[1]
  out[2] = COLORS.sandWet[2]

  mix(out, COLORS.sand, smoothstep(-1.5, 0.4, height))
  // Bij meertjes groeit het gras tot vlak aan de waterlijn; aan zee is
  // er een breder strand.
  const lakeShore = world.lakeness(x, z)
  mix(out, COLORS.grass, lakeShore > 0.3 ? smoothstep(0.15, 0.8, height) : smoothstep(1.2, 2.6, height))

  // Weidepatronen: vlekken fris en kruidenrijk groen door elkaar,
  // zodat het grasland niet één egale kleur is.
  const grassy = smoothstep(1.4, 2.8, height)
  const patch = world.meadow(x, z)
  mix(out, COLORS.meadowFresh, smoothstep(0.52, 0.78, patch) * 0.85 * grassy)
  mix(out, COLORS.meadowHerb, smoothstep(0.48, 0.22, patch) * 0.75 * grassy)

  // Bos: donkerder groen waar de boslaag actief is, met strooisellaag
  // in de dichtste kernen.
  const forest = world.forestness(x, z) * smoothstep(1.5, 3, height)
  mix(out, COLORS.forest, forest * 0.85)
  mix(out, COLORS.forestFloor, smoothstep(0.75, 1, world.forestness(x, z)) * 0.5 * grassy)

  // Streekkarakter: herfstgoud, fris berkengroen, donker moeras, bloemenvallei.
  const region = regionWeights(world, x, z)
  mix(out, [0.62, 0.53, 0.24], region.autumn * grassy * 0.8)
  mix(out, [0.55, 0.74, 0.3], region.birch * grassy * 0.5)
  mix(out, [0.3, 0.4, 0.21], region.swamp * grassy * 0.75)
  mix(out, [0.61, 0.75, 0.34], region.flower * grassy * 0.5)

  // Kronkelende zandpaadjes door gras en bos.
  mix(out, COLORS.path, smoothstep(0.25, 0.75, world.path(x, z, height)))

  // Natte kiezelbedding van beken.
  mix(out, [0.52, 0.49, 0.42], smoothstep(0.35, 0.8, world.river(x, z, height)))

  // Rots op steile hellingen en hoog in de bergen.
  const steep = smoothstep(0.82, 0.62, normalY)
  const high = smoothstep(46, 64, height)
  mix(out, COLORS.rock, clamp(steep + high * 0.7, 0, 1))

  // Sneeuw op de toppen.
  mix(out, COLORS.snow, smoothstep(72, 86, height) * smoothstep(0.55, 0.8, normalY))

  // Per-vertex kleurjitter.
  const j = 0.93 + jitter * 0.14
  out[0] = clamp(out[0] * j, 0, 1)
  out[1] = clamp(out[1] * j, 0, 1)
  out[2] = clamp(out[2] * j, 0, 1)
  return out
}

/** Naam van het bioom op een punt, voor de HUD. */
export function biomeName(world: World, x: number, z: number): string {
  const h = world.height(x, z)
  if (h < -0.2) return 'Zee'
  if (h < 2.2) return 'Strand'
  if (h > 70) return 'Bergtop'
  const n = world.normal(x, z)
  if (n.y < 0.68 || (world.hilliness(x, z) > 0.6 && h > 26)) return 'Bergen'
  if (world.forestness(x, z) > 0.5) return 'Bos'
  return 'Grasland'
}
