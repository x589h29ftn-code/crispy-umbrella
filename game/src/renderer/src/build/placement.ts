import * as THREE from 'three'
import type { Input } from '../core/input'
import type { PlayerController } from '../player/controller'
import type { World } from '../world/terrain'
import { BLOCK_TYPES } from './blockTypes'
import type { BlockStore } from './blockStore'

const REACH = 6

export interface RayHit {
  gx: number
  gy: number
  gz: number
  nx: number
  ny: number
  nz: number
  distance: number
  isBlock: boolean
}

/**
 * Richten, plaatsen en weghalen van blokken. Hotbar-slot 0 is "hand" (niets
 * plaatsen); rechtsklikken haalt altijd het aangekeken blok weg.
 */
export class BuildSystem {
  selectedSlot = 0 // 0 = hand, 1..BLOCK_TYPES.length = bloktype
  private world: World
  private store: BlockStore
  private input: Input
  private player: PlayerController
  private ghost: THREE.Mesh
  private ghostEdges: THREE.LineSegments
  private origin = new THREE.Vector3()
  private dir = new THREE.Vector3()
  onSelectionChanged: ((slot: number) => void) | null = null

  constructor(scene: THREE.Scene, world: World, store: BlockStore, input: Input, player: PlayerController) {
    this.world = world
    this.store = store
    this.input = input
    this.player = player

    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002)
    this.ghost = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x77ff88, transparent: true, opacity: 0.28, depthWrite: false })
    )
    this.ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    )
    this.ghost.add(this.ghostEdges)
    this.ghost.visible = false
    scene.add(this.ghost)
  }

  get slotCount(): number {
    return BLOCK_TYPES.length + 2 // hand + blokken + hengel
  }

  /** Index van het hengel-slot (laatste). */
  get rodSlot(): number {
    return this.slotCount - 1
  }

  /** Klik terwijl de hengel vast wordt gehouden (0 = links, 2 = rechts). */
  onRodClick: ((button: number) => void) | null = null

  update(presses: string[]): void {
    // Hotbar: cijfertoetsen en scrollwiel.
    for (const code of presses) {
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5))
        if (n >= 1 && n <= this.slotCount) this.select(n - 1)
      }
    }
    const wheel = this.input.consumeWheel()
    if (wheel !== 0) {
      this.select((this.selectedSlot + wheel + this.slotCount) % this.slotCount)
    }

    // Richten vanuit de camera door het crosshair.
    this.player.getEyePosition(this.origin)
    this.player.getLookDirection(this.dir)
    const blockHit = this.raycastBlocks()
    const terrainHit = this.raycastTerrain()
    let hit: RayHit | null = blockHit
    if (terrainHit && (!hit || terrainHit.distance < hit.distance)) hit = terrainHit

    // Ghost-preview van de plaatsingspositie.
    const placing = this.selectedSlot > 0 && this.selectedSlot !== this.rodSlot && hit !== null
    if (placing && hit) {
      const target = this.placementCell(hit)
      if (target) {
        this.ghost.visible = true
        this.ghost.position.set(target.gx + 0.5, target.gy + 0.5, target.gz + 0.5)
        const valid = this.isValidPlacement(target.gx, target.gy, target.gz)
        ;(this.ghost.material as THREE.MeshBasicMaterial).color.set(valid ? 0x77ff88 : 0xff6655)
      } else {
        this.ghost.visible = false
      }
    } else {
      this.ghost.visible = false
    }

    // Klikken: links = plaatsen, rechts = weghalen; hengel = werpen.
    for (const click of this.input.consumeClicks()) {
      if (this.selectedSlot === this.rodSlot) {
        this.onRodClick?.(click.button)
      } else if (click.button === 0 && this.selectedSlot > 0 && hit) {
        const target = this.placementCell(hit)
        if (target && this.isValidPlacement(target.gx, target.gy, target.gz)) {
          this.store.set(target.gx, target.gy, target.gz, this.selectedSlot - 1)
        }
      } else if (click.button === 2 && blockHit) {
        this.store.remove(blockHit.gx, blockHit.gy, blockHit.gz)
      }
    }
  }

  private select(slot: number): void {
    this.selectedSlot = slot
    this.onSelectionChanged?.(slot)
  }

  /** Doelcel voor plaatsing: naast het geraakte blokvlak, of in de terreincel. */
  private placementCell(hit: RayHit): { gx: number; gy: number; gz: number } | null {
    if (hit.isBlock) {
      return { gx: hit.gx + hit.nx, gy: hit.gy + hit.ny, gz: hit.gz + hit.nz }
    }
    return { gx: hit.gx, gy: hit.gy, gz: hit.gz }
  }

  private isValidPlacement(gx: number, gy: number, gz: number): boolean {
    if (this.store.get(gx, gy, gz) !== undefined) return false
    // Niet in de speler zelf bouwen.
    const p = this.player.getAabb()
    if (
      gx + 1 > p.minX &&
      gx < p.maxX &&
      gy + 1 > p.minY &&
      gy < p.maxY &&
      gz + 1 > p.minZ &&
      gz < p.maxZ
    ) {
      return false
    }
    // Niet volledig onder het terrein begraven.
    const h = this.world.height(gx + 0.5, gz + 0.5)
    if (h > gy + 0.95) return false
    return true
  }

  /** 3D-DDA (Amanatides–Woo) door het 1m-grid, test elke cel op een blok. */
  private raycastBlocks(): RayHit | null {
    if (this.store.size === 0) return null
    const o = this.origin
    const d = this.dir

    let gx = Math.floor(o.x)
    let gy = Math.floor(o.y)
    let gz = Math.floor(o.z)

    const stepX = d.x > 0 ? 1 : -1
    const stepY = d.y > 0 ? 1 : -1
    const stepZ = d.z > 0 ? 1 : -1

    const tDeltaX = d.x !== 0 ? Math.abs(1 / d.x) : Infinity
    const tDeltaY = d.y !== 0 ? Math.abs(1 / d.y) : Infinity
    const tDeltaZ = d.z !== 0 ? Math.abs(1 / d.z) : Infinity

    let tMaxX = d.x !== 0 ? ((d.x > 0 ? gx + 1 - o.x : o.x - gx) / Math.abs(d.x)) : Infinity
    let tMaxY = d.y !== 0 ? ((d.y > 0 ? gy + 1 - o.y : o.y - gy) / Math.abs(d.y)) : Infinity
    let tMaxZ = d.z !== 0 ? ((d.z > 0 ? gz + 1 - o.z : o.z - gz) / Math.abs(d.z)) : Infinity

    let nx = 0
    let ny = 0
    let nz = 0
    let t = 0

    while (t <= REACH) {
      if (this.store.get(gx, gy, gz) !== undefined) {
        return { gx, gy, gz, nx, ny, nz, distance: t, isBlock: true }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX
        tMaxX += tDeltaX
        gx += stepX
        nx = -stepX
        ny = 0
        nz = 0
      } else if (tMaxY < tMaxZ) {
        t = tMaxY
        tMaxY += tDeltaY
        gy += stepY
        nx = 0
        ny = -stepY
        nz = 0
      } else {
        t = tMaxZ
        tMaxZ += tDeltaZ
        gz += stepZ
        nx = 0
        ny = 0
        nz = -stepZ
      }
    }
    return null
  }

  /** Ray-march tegen de terreinfunctie, met bisectie-verfijning. */
  private raycastTerrain(): RayHit | null {
    const o = this.origin
    const d = this.dir
    const step = 0.4
    let prevT = 0
    let prevAbove = o.y - this.world.height(o.x, o.z) > 0
    if (!prevAbove) return null

    for (let t = step; t <= REACH; t += step) {
      const x = o.x + d.x * t
      const y = o.y + d.y * t
      const z = o.z + d.z * t
      const above = y - this.world.height(x, z) > 0
      if (!above) {
        // Bisectie tussen prevT en t.
        let lo = prevT
        let hi = t
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2
          const my = o.y + d.y * mid
          if (my - this.world.height(o.x + d.x * mid, o.z + d.z * mid) > 0) lo = mid
          else hi = mid
        }
        const ht = (lo + hi) / 2
        const hx = o.x + d.x * ht
        const hy = o.y + d.y * ht
        const hz = o.z + d.z * ht
        // Doelcel: net vóór het raakpunt zodat het blok op het oppervlak ligt.
        return {
          gx: Math.floor(hx - d.x * 0.05),
          gy: Math.floor(hy - d.y * 0.05),
          gz: Math.floor(hz - d.z * 0.05),
          nx: 0,
          ny: 1,
          nz: 0,
          distance: ht,
          isBlock: false
        }
      }
      prevT = t
      prevAbove = above
    }
    return null
  }
}
