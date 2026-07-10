import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { chunkRng } from '../core/rng'
import type { BlockAabb } from '../player/controller'
import type { Chunk } from './chunkManager'
import { CHUNK_SIZE, type World } from './terrain'
import { bladeGeometry, swayMaterial } from './vegetation'

// Materialen voor alle bouwwerken (gedeeld).
const MATS = {
  // Sprookjesachtige cottage-look: crème pleisterwerk, donker hout, terracotta.
  wall: new THREE.MeshLambertMaterial({ color: 0xdcc9a4, flatShading: true }),
  beam: new THREE.MeshLambertMaterial({ color: 0x63482e, flatShading: true }),
  roof: new THREE.MeshLambertMaterial({ color: 0xb5533c, flatShading: true }),
  glass: new THREE.MeshPhongMaterial({
    color: 0xcfe8f0,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide
  }),
  soil: new THREE.MeshLambertMaterial({ color: 0x5d452c, flatShading: true }),
  crop: new THREE.MeshLambertMaterial({ color: 0x4f9c38, flatShading: true }),
  carrot: new THREE.MeshLambertMaterial({ color: 0xe67e22, flatShading: true })
}
type MatKey = keyof typeof MATS

const wheatStalkMat = swayMaterial(
  { color: 0xb8a850, vertexColors: true, side: THREE.DoubleSide },
  0.07
)
const wheatHeadMat = swayMaterial({ color: 0xe8c25a, flatShading: true }, 0.07)

/** Graanpol: drie gebogen halmen met kleurverloop. */
function wheatStalkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const blade = bladeGeometry(0.05, 0.8 + (i % 2) * 0.12, 0.12, 0.55)
    blade.rotateY((i / 3) * Math.PI * 2)
    blade.translate((i - 1) * 0.05, 0, ((i * 7) % 3 - 1) * 0.05)
    parts.push(blade)
  }
  return mergeGeometries(parts)
}

/** Aar: gekruiste korrelblokjes met een naaldje erboven. */
function wheatHeadGeometry(): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(0.11, 0.3, 0.05)
  a.translate(0, 0.98, 0)
  const b = new THREE.BoxGeometry(0.05, 0.3, 0.11)
  b.translate(0, 0.98, 0)
  const awn = new THREE.CylinderGeometry(0.008, 0.012, 0.22, 3)
  awn.translate(0.02, 1.22, 0)
  return mergeGeometries([a, b, awn])
}
const wheatStalkGeo = wheatStalkGeometry()
const wheatHeadGeo = wheatHeadGeometry()

/**
 * Bouwset voor één bouwwerk: verzamelt boxen per materiaal in lokale
 * coördinaten en zet ze bij `finish()` om naar één mesh per materiaal, met
 * bijbehorende wereld-AABB's voor botsing. Rotatie in kwartslagen zodat de
 * botsingsboxen as-uitgelijnd blijven.
 */
class Kit {
  private geos = new Map<MatKey, THREE.BufferGeometry[]>()
  readonly colliders: BlockAabb[] = []
  readonly group = new THREE.Group()

  constructor(
    private worldX: number,
    private baseY: number,
    private worldZ: number,
    private quarter: number
  ) {
    this.group.position.set(worldX, baseY, worldZ)
    this.group.rotation.y = (quarter * Math.PI) / 2
  }

  private rot(x: number, z: number): [number, number] {
    switch (this.quarter & 3) {
      case 1:
        return [-z, x]
      case 2:
        return [-x, -z]
      case 3:
        return [z, -x]
      default:
        return [x, z]
    }
  }

  /** Lokaal punt naar wereldcoördinaten (voor plaatsing van sub-structuren). */
  toWorld(x: number, z: number): { x: number; z: number } {
    const [rx, rz] = this.rot(x, z)
    return { x: this.worldX + rx, z: this.worldZ + rz }
  }

  box(
    mat: MatKey,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    collide: boolean
  ): void {
    const geo = new THREE.BoxGeometry(sx, sy, sz)
    geo.translate(cx, cy, cz)
    this.pushGeo(mat, geo)
    if (collide) {
      const [wx, wz] = this.rot(cx, cz)
      const [sxq, szq] = this.quarter % 2 === 1 ? [sz, sx] : [sx, sz]
      this.colliders.push({
        minX: this.worldX + wx - sxq / 2,
        minY: this.baseY + cy - sy / 2,
        minZ: this.worldZ + wz - szq / 2,
        maxX: this.worldX + wx + sxq / 2,
        maxY: this.baseY + cy + sy / 2,
        maxZ: this.worldZ + wz + szq / 2
      })
    }
  }

  pushGeo(mat: MatKey, geo: THREE.BufferGeometry): void {
    let list = this.geos.get(mat)
    if (!list) {
      list = []
      this.geos.set(mat, list)
    }
    list.push(geo)
  }

  finish(chunk: Chunk, scene: THREE.Scene): void {
    for (const [mat, list] of this.geos) {
      const merged = mergeGeometries(list)
      for (const g of list) g.dispose()
      const mesh = new THREE.Mesh(merged, MATS[mat])
      mesh.castShadow = mat !== 'glass'
      mesh.receiveShadow = true
      this.group.add(mesh)
      chunk.disposables.push({ dispose: () => merged.dispose() })
    }
    scene.add(this.group)
    chunk.attachments.push(this.group)
  }
}

/** Hut met deuropening, twee raamkanten (glas, met uitzicht) en meubels. */
function buildCabin(kit: Kit, width = 5, depth = 4): void {
  const W = width / 2
  const D = depth / 2
  const T = 0.16 // wanddikte
  const H = 2.4 // wandhoogte

  // Vloer met opstap en korte poten in het terrein.
  kit.box('beam', 0, -0.11, 0, width + 0.4, 0.22, depth + 0.4, true)
  kit.box('beam', 1.15, -0.35, D + 0.55, 1.3, 0.2, 0.9, true) // traptrede bij de deur
  for (const [px, pz] of [
    [-W + 0.25, -D + 0.25],
    [W - 0.25, -D + 0.25],
    [-W + 0.25, D - 0.25],
    [W - 0.25, D - 0.25]
  ]) {
    kit.box('beam', px, -1.4, pz, 0.3, 2.6, 0.3, false)
  }
  // Lage plint rondom zodat je op een helling niet onder de vloer kijkt.
  kit.box('beam', 0, -0.55, -D, width + 0.3, 0.7, 0.12, false)
  kit.box('beam', 0, -0.55, D, width + 0.3, 0.7, 0.12, false)
  kit.box('beam', -W, -0.55, 0, 0.12, 0.7, depth + 0.3, false)
  kit.box('beam', W, -0.55, 0, 0.12, 0.7, depth + 0.3, false)

  // Voorwand (+z) met deuropening x 0.6..1.7.
  kit.box('wall', (-W + 0.6) / 2, H / 2, D, W + 0.6, H, T, true)
  kit.box('wall', (1.7 + W) / 2, H / 2, D, W - 1.7, H, T, true)
  kit.box('wall', 1.15, 2.2, D, 1.1, 0.4, T, true)

  // Achterwand (-z) met raam x -0.8..0.8, y 1.05..1.95.
  kit.box('wall', (-W - 0.8) / 2, H / 2, -D, W - 0.8, H, T, true)
  kit.box('wall', (W + 0.8) / 2, H / 2, -D, W - 0.8, H, T, true)
  kit.box('wall', 0, 0.525, -D, 1.6, 1.05, T, true)
  kit.box('wall', 0, (1.95 + H) / 2, -D, 1.6, H - 1.95, T, true)
  kit.box('glass', 0, 1.5, -D, 1.6, 0.9, 0.05, true)

  // Zijwanden (±x) met raam z -0.7..0.7.
  for (const side of [-1, 1]) {
    const x = side * W
    kit.box('wall', x, H / 2, (-D - 0.7) / 2, T, H, D - 0.7, true)
    kit.box('wall', x, H / 2, (D + 0.7) / 2, T, H, D - 0.7, true)
    kit.box('wall', x, 0.525, 0, T, 1.05, 1.4, true)
    kit.box('wall', x, (1.95 + H) / 2, 0, T, H - 1.95, 1.4, true)
    kit.box('glass', x, 1.5, 0, 0.05, 0.9, 1.4, true)
  }

  // Balklaag + schilddak (vierzijdige piramide met overstek).
  kit.box('beam', 0, H + 0.08, 0, width + 0.5, 0.16, depth + 0.5, true)
  const roof = new THREE.ConeGeometry(1, 1, 4, 1)
  roof.rotateY(Math.PI / 4) // randen evenwijdig aan de muren
  // Basisvertices liggen na rotatie op ±1/√2: opschalen naar de overstek.
  const overhangX = (width / 2 + 0.75) * Math.SQRT2
  const overhangZ = (D + 0.75) * Math.SQRT2
  roof.scale(overhangX, 1.5, overhangZ)
  roof.translate(0, H + 0.16 + 0.75, 0)
  kit.pushGeo('roof', roof)

  // Meubels: tafel, bankje en bed.
  kit.box('beam', -1.5, 0.4, -1.1, 0.95, 0.8, 0.65, true)
  kit.box('beam', -1.45, 0.22, -0.2, 0.85, 0.44, 0.4, true)
  kit.box('beam', 1.6, 0.22, -0.9, 0.95, 0.44, 2.0, true)
  kit.box('wall', 1.6, 0.5, -0.9, 0.85, 0.14, 1.9, false)
}

/** Steiger het water in: dek op palen. */
function buildJetty(kit: Kit, length: number): void {
  kit.box('beam', 0, 0.32, length / 2, 1.5, 0.14, length, true)
  for (let z = 0.8; z < length; z += 2) {
    kit.box('beam', -0.6, -0.6, z, 0.16, 2, 0.16, false)
    kit.box('beam', 0.6, -0.6, z, 0.16, 2, 0.16, false)
  }
}

/** Omheinde moestuin met aarden bedden, gewassen en worteltjes. */
function buildGarden(kit: Kit): void {
  const w = 5.6
  const d = 4.6
  // Hek: paaltjes + twee liggers, met een opening aan de voorkant.
  const half = { x: w / 2, z: d / 2 }
  for (let x = -half.x; x <= half.x; x += 1.4) {
    kit.box('beam', x, 0.42, -half.z, 0.09, 0.84, 0.09, false)
    if (Math.abs(x - 0.7) > 0.9) kit.box('beam', x, 0.42, half.z, 0.09, 0.84, 0.09, false)
  }
  for (let z = -half.z; z <= half.z; z += 1.4) {
    kit.box('beam', -half.x, 0.42, z, 0.09, 0.84, 0.09, false)
    kit.box('beam', half.x, 0.42, z, 0.09, 0.84, 0.09, false)
  }
  for (const y of [0.35, 0.68]) {
    kit.box('beam', 0, y, -half.z, w, 0.06, 0.05, true)
    kit.box('beam', -1.35, y, half.z, w - 2.7 - 1.4, 0.06, 0.05, true)
    kit.box('beam', -half.x, y, 0, 0.05, 0.06, d, true)
    kit.box('beam', half.x, y, 0, 0.05, 0.06, d, true)
  }
  // Bedden met gewassen.
  for (let row = 0; row < 4; row++) {
    const x = -1.8 + row * 1.2
    kit.box('soil', x, 0.09, 0, 0.8, 0.18, d - 1, false)
    for (let i = 0; i < 5; i++) {
      const z = -d / 2 + 0.8 + i * 0.75
      const plant = new THREE.IcosahedronGeometry(0.16, 0)
      plant.translate(x + (i % 2) * 0.08, 0.28, z)
      kit.pushGeo('crop', plant)
      if ((row + i) % 3 === 0) {
        const carrot = new THREE.IcosahedronGeometry(0.07, 0)
        carrot.translate(x - 0.1, 0.32, z + 0.15)
        kit.pushGeo('carrot', carrot)
      }
    }
  }
}

export interface LakeHouseSpot {
  x: number
  z: number
  quarter: number // kwartslag waarvan +z richting het water wijst
}

/**
 * Bouwwerken in de wereld: verspreide hutjes waar je in kunt (deterministisch
 * per chunk) en één met de hand samengesteld tafereel aan een meertje:
 * huisje met steiger, moestuin en een graanveld.
 */
export class Structures {
  readonly lakeHouse: LakeHouseSpot | null
  private world: World
  private scene: THREE.Scene
  private colliders = new Map<string, BlockAabb[]>()
  private scratch: BlockAabb[] = []

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    this.scene = scene
    this.lakeHouse = this.findLakeHouseSpot()
  }

  /** Zoekt spiraalsgewijs een meeroever met vlak land erachter. */
  private findLakeHouseSpot(): LakeHouseSpot | null {
    for (let r = 30; r < 1400; r += 14) {
      const steps = Math.max(8, Math.floor((r * Math.PI * 2) / 22))
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        const x = Math.round(Math.cos(a) * r)
        const z = Math.round(Math.sin(a) * r)
        if (this.world.lakeness(x, z) < 0.35) continue
        const h = this.world.height(x, z)
        if (h < 0.3 || h > 1.4) continue
        if (this.world.normal(x, z).y < 0.9) continue
        // Waterkant: één kwartslag-richting moet het diepe in lopen,
        // de tegenovergestelde kant moet bouwbaar vlak land zijn.
        const dirs: [number, number][] = [
          [0, 1],
          [-1, 0],
          [0, -1],
          [1, 0]
        ]
        for (let q = 0; q < 4; q++) {
          const [dx, dz] = dirs[q]
          if (this.world.height(x + dx * 9, z + dz * 9) > -0.9) continue
          const bx = x - dx * 10
          const bz = z - dz * 10
          const bh = this.world.height(bx, bz)
          if (bh < 1 || bh > 7) continue
          if (this.world.normal(bx, bz).y < 0.88) continue
          if (this.world.forestness(bx, bz) > 0.4) continue // open erf, geen dicht bos
          const fh = this.world.height(x - dx * 24, z - dz * 24)
          if (fh < 1 || fh > 9) continue
          if (this.world.forestness(x - dx * 24, z - dz * 24) > 0.45) continue
          return { x, z, quarter: q }
        }
      }
    }
    return null
  }

  /** Middelpunt en straal van het erf: daarbinnen kapt de vegetatie een open plek. */
  clearing(): { x: number; z: number; radius: number } | null {
    if (!this.lakeHouse) return null
    const anchor = new Kit(this.lakeHouse.x, 0, this.lakeHouse.z, this.lakeHouse.quarter)
    const c = anchor.toWorld(2, -14)
    return { x: c.x, z: c.z, radius: 27 }
  }

  /** Mooie startplek bij het meerhuisje: zijaanzicht op huis, steiger en meer. */
  lakeSpawnPoint(): { x: number; z: number; lookX: number; lookZ: number } | null {
    if (!this.lakeHouse) return null
    const anchor = new Kit(this.lakeHouse.x, 0, this.lakeHouse.z, this.lakeHouse.quarter)
    const p = anchor.toWorld(11, -17)
    const look = anchor.toWorld(-1.5, -10)
    return { x: p.x, z: p.z, lookX: look.x, lookZ: look.z }
  }

  /** Botsingsboxen in de buurt van een punt (eigen chunk + 8 buren). */
  collidersInAABB(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): BlockAabb[] {
    const cx = Math.floor((minX + maxX) / 2 / CHUNK_SIZE)
    const cz = Math.floor((minZ + maxZ) / 2 / CHUNK_SIZE)
    this.scratch.length = 0
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.colliders.get(cx + dx + ',' + (cz + dz))
        if (!list) continue
        for (const b of list) {
          if (
            b.minX < maxX &&
            b.maxX > minX &&
            b.minY < maxY &&
            b.maxY > minY &&
            b.minZ < maxZ &&
            b.maxZ > minZ
          ) {
            this.scratch.push(b)
          }
        }
      }
    }
    return this.scratch
  }

  populate(chunk: Chunk): void {
    const chunkColliders: BlockAabb[] = []

    // Het meerhuisje-tafereel, als het in deze chunk ligt.
    const lh = this.lakeHouse
    if (lh && Math.floor(lh.x / CHUNK_SIZE) === chunk.cx && Math.floor(lh.z / CHUNK_SIZE) === chunk.cz) {
      this.buildLakeHouseScene(chunk, lh, chunkColliders)
    }

    // Verspreide hutjes: kleine kans per chunk, op een vlakke open plek.
    const rng = chunkRng(this.world.seed, chunk.cx, chunk.cz, 'hut')
    if (rng() < 0.05) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const x = chunk.cx * CHUNK_SIZE + 8 + rng() * (CHUNK_SIZE - 16)
        const z = chunk.cz * CHUNK_SIZE + 8 + rng() * (CHUNK_SIZE - 16)
        const h = this.world.height(x, z)
        if (h < 2.5 || h > 30) continue
        if (this.world.normal(x, z).y < 0.93) continue
        if (this.world.forestness(x, z) > 0.55) continue
        if (this.world.path(x, z, h) > 0.25) continue
        if (lh && (x - lh.x) ** 2 + (z - lh.z) ** 2 < 60 * 60) break
        const quarter = Math.floor(rng() * 4)
        const kit = new Kit(x, h + 0.42, z, quarter)
        buildCabin(kit)
        kit.finish(chunk, this.scene)
        chunkColliders.push(...kit.colliders)
        break
      }
    }

    if (chunkColliders.length > 0) {
      this.colliders.set(chunk.key, chunkColliders)
      chunk.disposables.push({ dispose: () => this.colliders.delete(chunk.key) })
    }
  }

  private buildLakeHouseScene(chunk: Chunk, lh: LakeHouseSpot, out: BlockAabb[]): void {
    // Anker aan de oever; +z (lokaal) wijst het water in.
    const anchor = new Kit(lh.x, 0, lh.z, lh.quarter)

    // Steiger vanaf de oever het meer op: lang genoeg om echt boven diep
    // water uit te komen.
    const dirs: [number, number][] = [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0]
    ]
    const [wdx, wdz] = dirs[lh.quarter]
    let jettyLen = 8
    for (let d = 3; d <= 22; d += 1) {
      if (this.world.height(lh.x + wdx * d, lh.z + wdz * d) < -1) {
        jettyLen = d + 5
        break
      }
    }
    const jettyKit = new Kit(lh.x, Math.max(this.world.height(lh.x, lh.z), 0.15), lh.z, lh.quarter)
    buildJetty(jettyKit, jettyLen)
    jettyKit.finish(chunk, this.scene)
    out.push(...jettyKit.colliders)

    // Huisje 10 m landinwaarts, deur richting het water.
    const housePos = anchor.toWorld(-1.5, -10)
    const houseH = this.world.height(housePos.x, housePos.z)
    const houseKit = new Kit(housePos.x, houseH + 0.45, housePos.z, (lh.quarter + 2) % 4)
    buildCabin(houseKit, 6, 4.6)
    houseKit.finish(chunk, this.scene)
    out.push(...houseKit.colliders)

    // Moestuin naast het huis.
    const gardenPos = anchor.toWorld(6.5, -11)
    const gardenH = this.world.height(gardenPos.x, gardenPos.z)
    const gardenKit = new Kit(gardenPos.x, gardenH + 0.1, gardenPos.z, lh.quarter)
    buildGarden(gardenKit)
    gardenKit.finish(chunk, this.scene)
    out.push(...gardenKit.colliders)

    // Graanveld achter het huis: wuivende halmen op het terrein.
    const fieldCenter = anchor.toWorld(0, -22)
    const placements: THREE.Matrix4[] = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const rng = chunkRng(this.world.seed, chunk.cx, chunk.cz, 'graan')
    for (let ix = -14; ix <= 14; ix++) {
      for (let iz = -9; iz <= 9; iz++) {
        const local = anchor.toWorld(ix * 0.55 + (rng() - 0.5) * 0.25, -22 + iz * 0.55 + (rng() - 0.5) * 0.25)
        const dx = local.x - fieldCenter.x
        const dz = local.z - fieldCenter.z
        const wx = fieldCenter.x + dx
        const wz = fieldCenter.z + dz
        const h = this.world.height(wx, wz)
        if (h < 1 || this.world.normal(wx, wz).y < 0.86) continue
        q.setFromAxisAngle(up, rng() * Math.PI * 2)
        m.compose(new THREE.Vector3(wx, h - 0.03, wz), q, new THREE.Vector3(1, 0.85 + rng() * 0.35, 1))
        placements.push(m.clone())
      }
    }
    if (placements.length > 0) {
      for (const [geo, mat] of [
        [wheatStalkGeo, wheatStalkMat],
        [wheatHeadGeo, wheatHeadMat]
      ] as const) {
        const wheat = new THREE.InstancedMesh(geo, mat, placements.length)
        placements.forEach((m4, i) => wheat.setMatrixAt(i, m4))
        wheat.instanceMatrix.needsUpdate = true
        wheat.computeBoundingSphere()
        this.scene.add(wheat)
        chunk.attachments.push(wheat)
        chunk.disposables.push({ dispose: () => wheat.dispose() })
      }
    }
  }
}
