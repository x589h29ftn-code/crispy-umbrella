import * as THREE from 'three'
import { combineSeed, mulberry32 } from '../core/rng'
import { terrainColor } from './biomes'
import { seasonAutumn, seasonWinter } from './season'
import { CHUNK_SIZE, type World } from './terrain'

const VERTS = CHUNK_SIZE + 1

// Gedeelde index-buffer: het gridpatroon is voor elke chunk identiek.
let sharedIndex: THREE.BufferAttribute | null = null

function getSharedIndex(): THREE.BufferAttribute {
  if (!sharedIndex) {
    const indices = new Uint32Array(CHUNK_SIZE * CHUNK_SIZE * 6)
    let o = 0
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const a = z * VERTS + x
        const b = a + 1
        const c = a + VERTS
        const d = c + 1
        indices[o++] = a
        indices[o++] = c
        indices[o++] = b
        indices[o++] = b
        indices[o++] = c
        indices[o++] = d
      }
    }
    sharedIndex = new THREE.BufferAttribute(indices, 1)
  }
  return sharedIndex
}

/** Deterministische jitter (0..1) per wereld-gridpunt, naadloos over chunkranden. */
function vertexJitter(seed: number, wx: number, wz: number): number {
  return mulberry32(combineSeed(seed, wx | 0, wz | 0))()
}

/**
 * Bouwt de terreingeometrie van één chunk. Vertexposities zijn lokaal
 * (0..CHUNK_SIZE); de mesh wordt op (cx*CHUNK_SIZE, 0, cz*CHUNK_SIZE) gezet.
 * Normalen komen uit de continue terreinfunctie en zijn dus naadloos.
 */
export function buildChunkGeometry(world: World, cx: number, cz: number): THREE.BufferGeometry {
  const positions = new Float32Array(VERTS * VERTS * 3)
  const normals = new Float32Array(VERTS * VERTS * 3)
  const colors = new Float32Array(VERTS * VERTS * 3)

  const ox = cx * CHUNK_SIZE
  const oz = cz * CHUNK_SIZE
  const rgb: [number, number, number] = [0, 0, 0]

  // Eerst één hoogtegrid met een rand van 1 cel: de normalen komen dan uit
  // buurverschillen in plaats van vier extra ruis-evaluaties per vertex.
  const G = VERTS + 2
  const heights = new Float32Array(G * G)
  for (let z = 0; z < G; z++) {
    for (let x = 0; x < G; x++) {
      heights[z * G + x] = world.height(ox + x - 1, oz + z - 1)
    }
  }

  let p = 0
  for (let z = 0; z < VERTS; z++) {
    for (let x = 0; x < VERTS; x++) {
      const wx = ox + x
      const wz = oz + z
      const gi = (z + 1) * G + (x + 1)
      const h = heights[gi]
      positions[p] = x
      positions[p + 1] = h
      positions[p + 2] = z

      // Central differences over het grid (stap 1 m), zoals world.normal.
      const nx = heights[gi - 1] - heights[gi + 1]
      const nz = heights[gi - G] - heights[gi + G]
      const inv = 1 / Math.hypot(nx, 2, nz)
      normals[p] = nx * inv
      normals[p + 1] = 2 * inv
      normals[p + 2] = nz * inv

      terrainColor(world, wx, wz, h, normals[p + 1], vertexJitter(world.seed, wx, wz), rgb)
      colors[p] = rgb[0]
      colors[p + 1] = rgb[1]
      colors[p + 2] = rgb[2]
      p += 3
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(getSharedIndex())
  // Bounding sphere handmatig: scheelt een pass over alle vertices.
  const half = CHUNK_SIZE / 2
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(half, 0, half), half * 1.9 + 50)
  return geometry
}

// Gedeelde tijd-uniform voor het stromen van beken.
export const riverTime = { value: 0 }

/** Gedeeld beekmateriaal: transparant blauwgroen met stromende glinstering. */
let riverMaterial: THREE.MeshLambertMaterial | null = null

function getRiverMaterial(): THREE.MeshLambertMaterial {
  if (riverMaterial) return riverMaterial
  riverMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  riverMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uRiverTime = riverTime
    shader.vertexShader =
      'varying vec3 vRiverWorld;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRiverWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      )
    shader.fragmentShader =
      'uniform float uRiverTime;\nvarying vec3 vRiverWorld;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float flow = sin(vRiverWorld.x * 2.1 + vRiverWorld.z * 1.7 - uRiverTime * 3.2)
                     + sin((vRiverWorld.x - vRiverWorld.z) * 3.3 - uRiverTime * 2.1);
          diffuseColor.rgb += flow * 0.045;
        }`
      )
  }
  return riverMaterial
}

/**
 * Beek-watermesh voor een chunk: quads boven de uitgesleten bedding, met
 * witte schuimvlakken waar het water >1,2 m per cel valt (watervalletjes).
 * Retourneert null als er geen beek door de chunk loopt.
 */
export function buildRiverMesh(world: World, cx: number, cz: number): THREE.Mesh | null {
  const ox = cx * CHUNK_SIZE
  const oz = cz * CHUNK_SIZE
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  // Waterhoogte per rivier-cel (lazy, gedeeld tussen buurchecks).
  const levels = new Map<number, number>()
  const levelAt = (x: number, z: number): number | null => {
    const key = x * 128 + z
    const cached = levels.get(key)
    if (cached !== undefined) return cached === -9999 ? null : cached
    const wx = ox + x + 0.5
    const wz = oz + z + 0.5
    const h = world.height(wx, wz)
    const mask = world.river(wx, wz, h)
    const level = mask > 0.45 && h > 0.2 ? h + 0.25 : null
    levels.set(key, level ?? -9999)
    return level
  }

  const quad = (a: number[], b: number[], c: number[], d: number[], col: number[]): void => {
    const base = positions.length / 3
    positions.push(...a, ...b, ...c, ...d)
    for (let i = 0; i < 4; i++) colors.push(...col)
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }

  const WATER: number[] = [0.36, 0.58, 0.62]
  const FOAM: number[] = [0.95, 0.97, 0.98]

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const level = levelAt(x, z)
      if (level === null) continue
      // Wateroppervlak van deze cel (lokaal aan de chunk).
      quad([x, level, z], [x + 1, level, z], [x, level, z + 1], [x + 1, level, z + 1], WATER)
      // Watervalletjes: verticaal schuimvlak naar een veel lagere buurcel.
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE || nz >= CHUNK_SIZE) continue
        const nLevel = levelAt(nx, nz)
        if (nLevel === null || level - nLevel < 1.2) continue
        const ex = dx > 0 ? x + 1 : x
        const ez = dz > 0 ? z + 1 : z
        if (dx !== 0) {
          quad([ex, level, z], [ex, level, z + 1], [ex, nLevel - 0.15, z], [ex, nLevel - 0.15, z + 1], FOAM)
        } else {
          quad([x, level, ez], [x + 1, level, ez], [x, nLevel - 0.15, ez], [x + 1, nLevel - 0.15, ez], FOAM)
        }
      }
    }
  }

  if (positions.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, getRiverMaterial())
  mesh.position.set(ox, 0, oz)
  mesh.renderOrder = 1
  return mesh
}

/**
 * Tegelbare grijswaarden-ruistextuur (valuenoise, 3 octaven) voor
 * oppervlaktedetail op het terrein — proceduraal, dus geen assetbestanden.
 */
function generateDetailTexture(): THREE.DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)

  const octaves = [
    { cells: 8, weight: 0.5 },
    { cells: 32, weight: 0.3 },
    { cells: 128, weight: 0.2 }
  ].map((o) => ({
    ...o,
    lattice: Float32Array.from({ length: o.cells * o.cells }, () => Math.random())
  }))

  const smooth = (t: number): number => t * t * (3 - 2 * t)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      for (const { cells, weight, lattice } of octaves) {
        const gx = (x / size) * cells
        const gy = (y / size) * cells
        const x0 = Math.floor(gx) % cells
        const y0 = Math.floor(gy) % cells
        const x1 = (x0 + 1) % cells
        const y1 = (y0 + 1) % cells
        const fx = smooth(gx - Math.floor(gx))
        const fy = smooth(gy - Math.floor(gy))
        const a = lattice[y0 * cells + x0]
        const b = lattice[y0 * cells + x1]
        const c = lattice[y1 * cells + x0]
        const d = lattice[y1 * cells + x1]
        v += weight * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy)
      }
      const g = Math.round(v * 255)
      const i = (y * size + x) * 4
      data[i] = g
      data[i + 1] = g
      data[i + 2] = g
      data[i + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/**
 * Gedeeld terreinmateriaal: vertex-kleuren, smooth shading, plus een
 * wereld-uitgelijnde detailtextuur op twee schalen (grove vlekken ~6 m en
 * fijn "sprietjes"-detail ~1 m) die de vlakke kleuren doorbreekt.
 */
export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  const detail = generateDetailTexture()
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail }
    shader.uniforms.uAutumn = seasonAutumn
    shader.uniforms.uWinter = seasonWinter
    shader.vertexShader =
      'varying vec3 vDetailWorld;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDetailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      )
    shader.fragmentShader =
      'uniform sampler2D uDetail;\nuniform float uAutumn;\nuniform float uWinter;\nvarying vec3 vDetailWorld;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float coarse = texture2D(uDetail, vDetailWorld.xz * 0.031).r;
          float mid = texture2D(uDetail, vDetailWorld.xz * 0.085).r;
          float fine = texture2D(uDetail, vDetailWorld.xz * 0.21).r;
          diffuseColor.rgb *= 0.72 + coarse * 0.32 + (mid - 0.5) * 0.18 + (fine - 0.5) * 0.2;
          // Seizoenen: herfsttint op het groen; in de winter zakt de
          // sneeuwgrens tot vlak boven het strand.
          float greenness = smoothstep(0.08, 0.2, diffuseColor.g - diffuseColor.r);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 0.9, 0.55), uAutumn * 0.4 * greenness);
          float snowLine = mix(76.0, 2.5, uWinter);
          float snow = smoothstep(snowLine, snowLine + 8.0, vDetailWorld.y) * step(0.05, uWinter);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.93, 0.96) * (0.9 + fine * 0.2), snow * 0.92);
        }`
      )
  }
  return material
}
