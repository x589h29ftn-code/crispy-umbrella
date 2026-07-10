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

// ---- Prototypes op ware grootte (één keer gebouwd, gedeeld door alle chunks) ----

/** Hoge, kale dennenstam: de kroon begint pas op ~5 m. */
function pineTrunkGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.24, 0.4, 5.6, 6)
  geo.translate(0, 2.8, 0)
  return geo
}

/**
 * Dennenkroon in de stijl van de referentie: brede, platgedrukte lagen
 * die naar boven toe smaller worden, met kleine verspringingen.
 */
function pineCanopyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const lobes: [number, number, number, number, number][] = [
    // [x-offset, hoogte, z-offset, straal, y-schaal]
    [0.3, 5.6, 0.1, 2.9, 0.42],
    [-0.25, 7.0, -0.2, 2.5, 0.4],
    [0.15, 8.3, 0.2, 2.1, 0.38],
    [-0.1, 9.5, -0.1, 1.7, 0.36],
    [0.05, 10.6, 0.05, 1.3, 0.34],
    [0, 11.6, 0, 0.8, 0.5]
  ]
  for (const [x, y, z, r, ys] of lobes) {
    const lobe = new THREE.IcosahedronGeometry(r, 0)
    lobe.scale(1, ys, 1)
    lobe.translate(x, y, z)
    parts.push(lobe)
  }
  return mergeGeometries(parts)
}

/** Loofboomstam met een lichte vertakking. */
function leafyTrunkGeometry(): THREE.BufferGeometry {
  const main = new THREE.CylinderGeometry(0.32, 0.5, 5.2, 6)
  main.translate(0, 2.6, 0)
  const branch = new THREE.CylinderGeometry(0.16, 0.22, 2.6, 5)
  branch.rotateZ(0.65)
  branch.translate(1.2, 5.0, 0.2)
  return mergeGeometries([main, branch])
}

/** Grote bolle bladerkroon zoals in de referentie, top op ~11 m. */
function leafyCanopyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const blobs: [number, number, number, number][] = [
    [0, 7.6, 0, 3.3],
    [2.3, 6.6, 0.9, 2.3],
    [-2.2, 6.9, -0.6, 2.2],
    [0.6, 6.2, -2.1, 2.0],
    [-0.8, 6.4, 2.0, 1.9],
    [1.2, 9.2, 0.8, 1.9],
    [-1.3, 9.0, -0.9, 1.8]
  ]
  for (const [x, y, z, r] of blobs) {
    const blob = new THREE.IcosahedronGeometry(r, 0)
    blob.translate(x, y, z)
    parts.push(blob)
  }
  return mergeGeometries(parts)
}

/** Struik: paar lage bladbollen, ~1,2 m hoog. */
function bushGeometry(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(0.85, 0)
  a.translate(0, 0.65, 0)
  const b = new THREE.IcosahedronGeometry(0.6, 0)
  b.translate(0.7, 0.45, 0.3)
  const c = new THREE.IcosahedronGeometry(0.5, 0)
  c.translate(-0.6, 0.4, -0.25)
  return mergeGeometries([a, b, c])
}

/** Weelderig grasplukje: zes uitwaaierende bladen, kniehoog. */
function grassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const h = 0.3 + (i % 3) * 0.09
    const blade = new THREE.ConeGeometry(0.075, h, 4, 1, true)
    blade.translate(0, h / 2, 0)
    blade.rotateX(0.5) // naar buiten hellen
    blade.rotateY(angle)
    parts.push(blade)
  }
  const center = new THREE.ConeGeometry(0.08, 0.5, 4, 1, true)
  center.translate(0, 0.25, 0)
  parts.push(center)
  return mergeGeometries(parts)
}

function stemGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.02, 0.025, 0.42, 4)
  geo.translate(0, 0.21, 0)
  return geo
}

function headGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.09, 0)
  geo.translate(0, 0.46, 0)
  return geo
}

/** Paddenstoelsteel + hoed (apart, zodat de hoed een eigen kleur krijgt). */
function mushroomStemGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.05, 0.07, 0.22, 5)
  geo.translate(0, 0.11, 0)
  return geo
}

function mushroomCapGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.17, 0.16, 6)
  geo.translate(0, 0.3, 0)
  return geo
}

/** Rietstengel met sigaar, ~1,6 m. */
function reedStemGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.025, 0.035, 1.5, 4)
  geo.translate(0, 0.75, 0)
  return geo
}

function reedTopGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.05, 0.05, 0.38, 5)
  geo.translate(0, 1.62, 0)
  return geo
}

function rockGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(0.55, 0)
}

/** Clustertje platte kiezels, zoals langs de paadjes in de referentie. */
function pebblesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const spots: [number, number, number][] = [
    [0, 0, 0.14],
    [0.22, 0.12, 0.1],
    [-0.18, 0.14, 0.09],
    [0.05, -0.2, 0.11],
    [-0.08, 0.24, 0.07]
  ]
  for (const [x, z, r] of spots) {
    const pebble = new THREE.IcosahedronGeometry(r, 0)
    pebble.scale(1, 0.55, 1)
    pebble.translate(x, r * 0.35, z)
    parts.push(pebble)
  }
  return mergeGeometries(parts)
}

/** Omgevallen boomstam op de bosbodem. */
function logGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.2, 0.24, 2.8, 6)
  geo.rotateZ(Math.PI / 2)
  geo.rotateY(0.3)
  geo.translate(0, 0.2, 0)
  return geo
}

const FLOWER_COLORS = [0xffffff, 0xffd54a, 0xff6d75, 0xb987ff, 0xff9a3d, 0x7fb2ff]
const PINE_COLORS = [0x2c6e26, 0x35802c, 0x256022, 0x3f8f33, 0x4da03a]
const LEAFY_COLORS = [0x4f9c38, 0x5fae3f, 0x74c24a, 0x88cc55]
const GRASS_COLORS = [0x4e9a3a, 0x5fae3f, 0x74c24a, 0x458c33, 0x86c957]
const CAP_COLORS = [0xc0392b, 0xd35400, 0x9a6b3f, 0xe07b54]

interface Placement {
  x: number
  y: number
  z: number
  yaw: number
  scale: number
  color?: number
}

/** Boomstam als botsingscirkel, zodat je niet door bomen heen loopt. */
export interface TreeCollider {
  x: number
  z: number
  r: number
}

/**
 * Vult chunks met instanced bomen (dennen met gestapelde kroonlagen en bolle
 * loofbomen), een weelderig grastapijt met detailring rond de speler,
 * bloemen, struiken, paddenstoelen, kiezels, omgevallen stammen en riet —
 * deterministisch per chunk uit de wereldseed.
 */
export class Vegetation {
  private world: World
  private scene: THREE.Scene
  private colliders = new Map<string, TreeCollider[]>()
  private colliderScratch: TreeCollider[] = []
  private denseGrass = new Map<string, { cx: number; cz: number; mesh: THREE.InstancedMesh }>()
  /** Chebyshev-afstand (in chunks) waarbinnen het dichte gras zichtbaar is. */
  detailRadius = 4

  private pineTrunkGeo = pineTrunkGeometry()
  private pineCanopyGeo = pineCanopyGeometry()
  private leafyTrunkGeo = leafyTrunkGeometry()
  private leafyCanopyGeo = leafyCanopyGeometry()
  private bushGeo = bushGeometry()
  private grassGeo = grassGeometry()
  private stemGeo = stemGeometry()
  private headGeo = headGeometry()
  private mushStemGeo = mushroomStemGeometry()
  private mushCapGeo = mushroomCapGeometry()
  private reedStemGeo = reedStemGeometry()
  private reedTopGeo = reedTopGeometry()
  private rockGeo = rockGeometry()
  private pebblesGeo = pebblesGeometry()
  private logGeo = logGeometry()

  private trunkMat = new THREE.MeshLambertMaterial({ color: 0x7d4a30, flatShading: true })
  private leafyTrunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5b38, flatShading: true })
  private pineCanopyMat = swayMaterial({ flatShading: true }, 0.004)
  private leafyCanopyMat = swayMaterial({ flatShading: true }, 0.006)
  private bushMat = swayMaterial({ flatShading: true }, 0.02)
  private grassMat = swayMaterial({ flatShading: true }, 0.14)
  private stemMat = swayMaterial({ color: 0x4c8f36 }, 0.1)
  private headMat = swayMaterial({ flatShading: true }, 0.1)
  private mushStemMat = new THREE.MeshLambertMaterial({ color: 0xe8e0cf, flatShading: true })
  private mushCapMat = new THREE.MeshLambertMaterial({ flatShading: true })
  private reedStemMat = swayMaterial({ color: 0x5e7c3a }, 0.06)
  private reedTopMat = swayMaterial({ color: 0x6d4a2e, flatShading: true }, 0.06)
  private rockMat = new THREE.MeshLambertMaterial({ color: 0x8d8a83, flatShading: true })
  private pebbleMat = new THREE.MeshLambertMaterial({ color: 0x9d968c, flatShading: true })
  private logMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c, flatShading: true })

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    this.scene = scene
  }

  /** Elke frame aanroepen zodat het groen wuift. */
  tick(dt: number): void {
    swayTime.value += dt
  }

  /** Dichte grasring rond de speler bijwerken (goedkoop: visibility-toggle). */
  updateDetail(playerX: number, playerZ: number): void {
    const pcx = Math.floor(playerX / CHUNK_SIZE)
    const pcz = Math.floor(playerZ / CHUNK_SIZE)
    for (const d of this.denseGrass.values()) {
      d.mesh.visible = Math.max(Math.abs(d.cx - pcx), Math.abs(d.cz - pcz)) <= this.detailRadius
    }
  }

  /** Boomstammen in de buurt van een punt (eigen chunk + 8 buren). */
  collidersNear(x: number, z: number): TreeCollider[] {
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    this.colliderScratch.length = 0
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.colliders.get(cx + dx + ',' + (cz + dz))
        if (list) this.colliderScratch.push(...list)
      }
    }
    return this.colliderScratch
  }

  populate(chunk: Chunk): void {
    const rng = chunkRng(this.world.seed, chunk.cx, chunk.cz, 'veg')
    const ox = chunk.cx * CHUNK_SIZE
    const oz = chunk.cz * CHUNK_SIZE

    const pines: Placement[] = []
    const leafies: Placement[] = []
    const bushes: Placement[] = []
    const farGrass: Placement[] = []
    const nearGrass: Placement[] = []
    const flowers: Placement[] = []
    const mushrooms: Placement[] = []
    const reeds: Placement[] = []
    const rocks: Placement[] = []
    const pebbles: Placement[] = []
    const logs: Placement[] = []
    const treeColliders: TreeCollider[] = []

    // Bomen: dichte bossen tot aan de boomgrens, losse bomen in het veld.
    for (let i = 0; i < 170; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const p = rng()
      const typeRoll = rng()
      const h = this.world.height(x, z)
      if (h < 2 || h > 38) continue
      if (this.world.normal(x, z).y < 0.76) continue
      if (this.world.path(x, z, h) > 0.3) continue // paden blijven open
      const forest = this.world.forestness(x, z)
      if (p > forest * 0.95 + 0.03) continue
      const isPine = this.world.hilliness(x, z) > 0.45 ? typeRoll < 0.85 : typeRoll < 0.55
      const scale = 0.8 + rng() * 0.6
      const target = isPine ? pines : leafies
      target.push({
        x,
        y: h - 0.2,
        z,
        yaw: rng() * Math.PI * 2,
        scale,
        color: (isPine ? PINE_COLORS : LEAFY_COLORS)[Math.floor(rng() * 4)]
      })
      treeColliders.push({ x, z, r: (isPine ? 0.34 : 0.44) * scale })
    }

    // Struiken: bosranden en kruidenrijke veldjes.
    for (let i = 0; i < 44; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 1.8 || h > 28) continue
      if (this.world.normal(x, z).y < 0.78) continue
      if (this.world.path(x, z, h) > 0.35) continue
      const forest = this.world.forestness(x, z)
      const edge = forest > 0.15 && forest < 0.6
      if (rng() > (edge ? 0.45 : 0.16)) continue
      bushes.push({
        x,
        y: h - 0.05,
        z,
        yaw: rng() * Math.PI * 2,
        scale: 0.6 + rng() * 0.9,
        color: LEAFY_COLORS[Math.floor(rng() * LEAFY_COLORS.length)]
      })
    }

    // Gras: weelderig tapijt. Een basislaag die altijd zichtbaar is en een
    // dichte dethaillaag die alleen rond de speler aanstaat.
    for (let i = 0; i < 3000; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      const colorRoll = rng()
      const sizeRoll = rng()
      if (h < 1.6 || h > 34) continue
      if (this.world.normal(x, z).y < 0.76) continue
      if (this.world.path(x, z, h) > 0.4) continue
      const placement = {
        x,
        y: h - 0.06,
        z,
        yaw: colorRoll * Math.PI * 2,
        scale: 0.8 + sizeRoll * 0.7,
        color: GRASS_COLORS[Math.floor(colorRoll * GRASS_COLORS.length)]
      }
      // 1 op 6 in de altijd-zichtbare verte-laag, de rest in de detailring.
      if (i % 6 === 0) farGrass.push(placement)
      else nearGrass.push(placement)
    }

    // Bloemen: plukken op weideplekken + losse bloemetjes door het gras.
    for (let c = 0; c < 7; c++) {
      const cxw = ox + rng() * CHUNK_SIZE
      const czw = oz + rng() * CHUNK_SIZE
      const clusterColor = FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]
      if (this.world.meadow(cxw, czw) < 0.5) continue
      if (this.world.forestness(cxw, czw) > 0.4) continue
      const n = 10 + Math.floor(rng() * 14)
      for (let i = 0; i < n; i++) {
        const x = cxw + (rng() - 0.5) * 12
        const z = czw + (rng() - 0.5) * 12
        const h = this.world.height(x, z)
        if (h < 1.8 || h > 24) continue
        if (this.world.normal(x, z).y < 0.82) continue
        if (this.world.path(x, z, h) > 0.4) continue
        const color = rng() < 0.8 ? clusterColor : FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]
        flowers.push({ x, y: h, z, yaw: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5, color })
      }
    }
    for (let i = 0; i < 80; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 1.8 || h > 26) continue
      if (this.world.normal(x, z).y < 0.8) continue
      if (this.world.path(x, z, h) > 0.4 || rng() > 0.45) continue
      flowers.push({
        x,
        y: h,
        z,
        yaw: rng() * Math.PI * 2,
        scale: 0.7 + rng() * 0.4,
        color: FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]
      })
    }

    // Paddenstoelen: groepjes op de bosbodem.
    for (let i = 0; i < 14; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 2 || h > 26) continue
      if (this.world.forestness(x, z) < 0.5 || rng() > 0.5) continue
      const capColor = CAP_COLORS[Math.floor(rng() * CAP_COLORS.length)]
      const n = 1 + Math.floor(rng() * 3)
      for (let j = 0; j < n; j++) {
        const mx = x + (rng() - 0.5) * 1.2
        const mz = z + (rng() - 0.5) * 1.2
        mushrooms.push({
          x: mx,
          y: this.world.height(mx, mz),
          z: mz,
          yaw: rng() * Math.PI * 2,
          scale: 0.7 + rng() * 0.9,
          color: capColor
        })
      }
    }

    // Kiezelclusters: vooral langs de paadjes, af en toe los in het veld.
    for (let i = 0; i < 40; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 1.6 || h > 30) continue
      const onPathEdge = this.world.path(x, z, h)
      const chance = onPathEdge > 0.15 && onPathEdge < 0.85 ? 0.5 : 0.05
      if (rng() > chance) continue
      pebbles.push({ x, y: h - 0.03, z, yaw: rng() * Math.PI * 2, scale: 0.6 + rng() * 1.1 })
    }

    // Omgevallen stammen op de bosbodem.
    for (let i = 0; i < 6; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 2 || h > 28) continue
      if (this.world.forestness(x, z) < 0.45 || rng() > 0.3) continue
      if (this.world.path(x, z, h) > 0.3) continue
      logs.push({ x, y: h - 0.05, z, yaw: rng() * Math.PI * 2, scale: 0.7 + rng() * 0.8 })
    }

    // Riet: zomen langs het water.
    for (let i = 0; i < 40; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 0.15 || h > 1.1) continue
      if (rng() > 0.75) continue
      reeds.push({ x, y: h - 0.05, z, yaw: rng() * Math.PI * 2, scale: 0.75 + rng() * 0.6 })
    }

    // Rotsen: vooral in de bergen, af en toe een grote zwerfkei.
    for (let i = 0; i < 20; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const h = this.world.height(x, z)
      if (h < 1) continue
      const hilly = this.world.hilliness(x, z)
      if (rng() > hilly * 1.1 + 0.08) continue
      rocks.push({ x, y: h - 0.2, z, yaw: rng() * Math.PI * 2, scale: 0.4 + rng() * rng() * 3.4 })
    }

    if (treeColliders.length > 0) this.colliders.set(chunk.key, treeColliders)
    chunk.disposables.push({ dispose: () => this.colliders.delete(chunk.key) })

    this.addInstances(chunk, this.pineTrunkGeo, this.trunkMat, pines, true, false, 'pijnstam')
    this.addInstances(chunk, this.pineCanopyGeo, this.pineCanopyMat, pines, true, true, 'pijnkroon')
    this.addInstances(chunk, this.leafyTrunkGeo, this.leafyTrunkMat, leafies, true, false, 'loofstam')
    this.addInstances(chunk, this.leafyCanopyGeo, this.leafyCanopyMat, leafies, true, true, 'loofkroon')
    this.addInstances(chunk, this.bushGeo, this.bushMat, bushes, true, true, 'struik')
    this.addInstances(chunk, this.grassGeo, this.grassMat, farGrass, false, true, 'gras-ver')
    const dense = this.addInstances(chunk, this.grassGeo, this.grassMat, nearGrass, false, true, 'gras-dicht')
    if (dense) {
      this.denseGrass.set(chunk.key, { cx: chunk.cx, cz: chunk.cz, mesh: dense })
      chunk.disposables.push({ dispose: () => this.denseGrass.delete(chunk.key) })
    }
    this.addInstances(chunk, this.stemGeo, this.stemMat, flowers, false, false, 'bloemsteel')
    this.addInstances(chunk, this.headGeo, this.headMat, flowers, false, true, 'bloemhoofd')
    this.addInstances(chunk, this.mushStemGeo, this.mushStemMat, mushrooms, false, false, 'padsteel')
    this.addInstances(chunk, this.mushCapGeo, this.mushCapMat, mushrooms, false, true, 'padhoed')
    this.addInstances(chunk, this.pebblesGeo, this.pebbleMat, pebbles, false, false, 'kiezels')
    this.addInstances(chunk, this.logGeo, this.logMat, logs, true, false, 'boomstam')
    this.addInstances(chunk, this.reedStemGeo, this.reedStemMat, reeds, false, false, 'rietstengel')
    this.addInstances(chunk, this.reedTopGeo, this.reedTopMat, reeds, false, false, 'riettop')
    this.addInstances(chunk, this.rockGeo, this.rockMat, rocks, true, false, 'rots')
  }

  private addInstances(
    chunk: Chunk,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    placements: Placement[],
    shadows: boolean,
    useColor: boolean,
    label: string
  ): THREE.InstancedMesh | null {
    if (placements.length === 0) return null
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
    mesh.name = `veg:${label}:${chunk.key}`
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
    return mesh
  }
}
