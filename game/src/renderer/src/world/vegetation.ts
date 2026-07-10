import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { chunkRng } from '../core/rng'
import type { Chunk } from './chunkManager'
import { CHUNK_SIZE, type World } from './terrain'

// Gedeelde tijd-uniform voor het wuiven van gras, bloemen en boomkruinen.
const swayTime = { value: 0 }

/** Lambert-materiaal met een vertex-sway in de shader (top wuift, voet niet). */
function swayMaterial(params: THREE.MeshLambertMaterialParameters, amount: number): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial(params)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayTime
    shader.vertexShader =
      'uniform float uSwayTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 swayWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          float swayPhase = uSwayTime * 1.7 + swayWorld.x * 0.9 + swayWorld.z * 0.7;
          float swayAmp = max(transformed.y, 0.0) * ${amount.toFixed(4)};
          transformed.x += sin(swayPhase) * swayAmp;
          transformed.z += cos(swayPhase * 0.83) * swayAmp * 0.6;
        }`
      )
  }
  return mat
}

// ---- Prototypes (één keer gebouwd, gedeeld door alle chunks) ----

function trunkGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.13, 0.2, 2.2, 5)
  geo.translate(0, 1.1, 0)
  return geo
}

function canopyGeometry(): THREE.BufferGeometry {
  const a = new THREE.ConeGeometry(1.5, 2.4, 6)
  a.translate(0, 3.1, 0)
  const b = new THREE.ConeGeometry(1.05, 1.9, 6)
  b.translate(0, 4.5, 0)
  return mergeGeometries([a, b])
}

function grassGeometry(): THREE.BufferGeometry {
  // Plukje van drie smalle kegeltjes: leest vanuit elke hoek als gras en
  // krijgt mooie low-poly schaduwvlakken (platte quads werden donkere platen).
  const parts: THREE.BufferGeometry[] = []
  const offsets: [number, number, number][] = [
    [0, 0.42, 0],
    [-0.13, 0.3, 0.08],
    [0.11, 0.34, -0.09]
  ]
  for (const [x, h, z] of offsets) {
    const blade = new THREE.ConeGeometry(0.09, h, 4)
    blade.translate(x, h / 2, z)
    parts.push(blade)
  }
  return mergeGeometries(parts)
}

function stemGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.02, 0.025, 0.38, 4)
  geo.translate(0, 0.19, 0)
  return geo
}

function headGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.09, 0)
  geo.translate(0, 0.42, 0)
  return geo
}

function rockGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(0.55, 0)
}

const FLOWER_COLORS = [0xffffff, 0xffd54a, 0xff6d75, 0xb987ff, 0xff9a3d]
const CANOPY_COLORS = [0x3f7d2e, 0x4c8f36, 0x35702a, 0x5da03f]
const GRASS_COLORS = [0x6fb54c, 0x7dc257, 0x63a844, 0x8acb62]

interface Placement {
  x: number
  y: number
  z: number
  yaw: number
  scale: number
  color?: number
}

/**
 * Vult chunks met instanced bomen, graspollen, bloemen en rotsen —
 * deterministisch per chunk uit de wereldseed, dichtheid per bioom.
 */
export class Vegetation {
  private world: World
  private scene: THREE.Scene
  private trunkGeo = trunkGeometry()
  private canopyGeo = canopyGeometry()
  private grassGeo = grassGeometry()
  private stemGeo = stemGeometry()
  private headGeo = headGeometry()
  private rockGeo = rockGeometry()

  private trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5b38, flatShading: true })
  private canopyMat = swayMaterial({ flatShading: true }, 0.012)
  // Kleur komt volledig uit de instantiekleur (materiaal wit laten, anders
  // vermenigvuldigen de kleuren en wordt het gras bijna zwart).
  private grassMat = swayMaterial({ flatShading: true }, 0.12)
  private stemMat = swayMaterial({ color: 0x4c8f36 }, 0.1)
  private headMat = swayMaterial({ flatShading: true }, 0.1)
  private rockMat = new THREE.MeshLambertMaterial({ color: 0x8d8a83, flatShading: true })

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    this.scene = scene
  }

  /** Elke frame aanroepen zodat het groen wuift. */
  tick(dt: number): void {
    swayTime.value += dt
  }

  populate(chunk: Chunk): void {
    const rng = chunkRng(this.world.seed, chunk.cx, chunk.cz, 'veg')
    const ox = chunk.cx * CHUNK_SIZE
    const oz = chunk.cz * CHUNK_SIZE

    const trees: Placement[] = []
    const grass: Placement[] = []
    const flowers: Placement[] = []
    const rocks: Placement[] = []

    // Bomen: kans per kandidaat volgt de bosdichtheid.
    for (let i = 0; i < 48; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const p = rng()
      const h = this.world.height(x, z)
      if (h < 2 || h > 32) continue
      if (this.world.normal(x, z).y < 0.76) continue
      const forest = this.world.forestness(x, z)
      if (p > forest * 0.9 + 0.02) continue
      trees.push({
        x,
        y: h - 0.15,
        z,
        yaw: rng() * Math.PI * 2,
        scale: 0.75 + rng() * 0.7,
        color: CANOPY_COLORS[Math.floor(rng() * CANOPY_COLORS.length)]
      })
    }

    // Gras: overal op begroeibare grond, dichter buiten het bos.
    for (let i = 0; i < 220; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 1.6 || h > 30) continue
      if (this.world.normal(x, z).y < 0.78) continue
      grass.push({
        x,
        y: h,
        z,
        yaw: rng() * Math.PI * 2,
        scale: 0.6 + rng() * 0.6,
        color: GRASS_COLORS[Math.floor(rng() * GRASS_COLORS.length)]
      })
    }

    // Bloemen: vrolijke plukjes in het open grasland.
    for (let i = 0; i < 70; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 1.8 || h > 24) continue
      if (this.world.forestness(x, z) > 0.45) continue
      if (this.world.normal(x, z).y < 0.85) continue
      flowers.push({
        x,
        y: h,
        z,
        yaw: rng() * Math.PI * 2,
        scale: 0.8 + rng() * 0.5,
        color: FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]
      })
    }

    // Rotsen: vooral in de heuvels.
    for (let i = 0; i < 12; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 1) continue
      const hilly = this.world.hilliness(x, z)
      if (rng() > hilly * 0.8 + 0.06) continue
      rocks.push({ x, y: h - 0.1, z, yaw: rng() * Math.PI * 2, scale: 0.4 + rng() * 1.4 })
    }

    this.addInstances(chunk, this.trunkGeo, this.trunkMat, trees, true, false)
    this.addInstances(chunk, this.canopyGeo, this.canopyMat, trees, true, true)
    this.addInstances(chunk, this.grassGeo, this.grassMat, grass, false, true)
    this.addInstances(chunk, this.stemGeo, this.stemMat, flowers, false, false)
    this.addInstances(chunk, this.headGeo, this.headMat, flowers, false, true)
    this.addInstances(chunk, this.rockGeo, this.rockMat, rocks, true, false)
  }

  private addInstances(
    chunk: Chunk,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    placements: Placement[],
    shadows: boolean,
    useColor: boolean
  ): void {
    if (placements.length === 0) return
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const s = new THREE.Vector3()
    const color = new THREE.Color()
    placements.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw)
      s.setScalar(p.scale)
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, s)
      mesh.setMatrixAt(i, m)
      if (useColor) {
        color.set(p.color ?? 0xffffff)
        mesh.setColorAt(i, color)
      }
    })
    mesh.castShadow = shadows
    mesh.receiveShadow = false
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // Instances staan op wereldposities: bounding sphere zelf berekenen,
    // anders wordt de mesh op de verkeerde plek weggeculld.
    mesh.computeBoundingSphere()
    this.scene.add(mesh)
    chunk.attachments.push(mesh)
    chunk.disposables.push({ dispose: () => mesh.dispose() })
  }
}
