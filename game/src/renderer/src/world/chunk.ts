import * as THREE from 'three'
import { combineSeed, mulberry32 } from '../core/rng'
import { terrainColor } from './biomes'
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

/** Gedeeld terreinmateriaal: vertex-kleuren, smooth shading. */
export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true })
}
