import * as THREE from 'three'
import type { Input } from '../core/input'
import { SEA_LEVEL, type World } from '../world/terrain'

// Speler als AABB rond de voetpositie.
const HALF_WIDTH = 0.3
const HEIGHT = 1.8
export const EYE_HEIGHT = 1.62

const WALK_SPEED = 5.5
const SPRINT_SPEED = 8.5
const SWIM_SPEED = 3.2
const GROUND_ACCEL = 45
const AIR_ACCEL = 10
const GRAVITY = 26
const JUMP_VELOCITY = 8.5
const STEEP_NORMAL_Y = 0.4 // steiler dan dit: wegglijden — bergtoppen zijn beklimbaar

export interface BlockAabb {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

/** Levert de AABB's van geplaatste blokken in een gebied (het bouwsysteem). */
export type BlockQuery = (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number
) => BlockAabb[]

/** Botsingscirkels van boomstammen in de buurt (levert de vegetatie). */
export type TreeQuery = (x: number, z: number) => { x: number; z: number; r: number }[]

export class PlayerController {
  readonly position = new THREE.Vector3() // voeten
  readonly velocity = new THREE.Vector3()
  yaw = 0
  pitch = 0
  /** Muisgevoeligheid (1 = standaard). */
  sensitivity = 1
  grounded = false
  swimming = false
  private world: World
  private input: Input
  private blockQuery: BlockQuery | null = null
  private treeQuery: TreeQuery | null = null
  private groundNormal = { x: 0, y: 1, z: 0 }

  constructor(world: World, input: Input) {
    this.world = world
    this.input = input
  }

  setBlockQuery(query: BlockQuery): void {
    this.blockQuery = query
  }

  setTreeQuery(query: TreeQuery): void {
    this.treeQuery = query
  }

  /** Zet de speler net boven het terrein op deze plek. */
  spawn(x: number, z: number): void {
    const h = Math.max(this.world.height(x, z), SEA_LEVEL)
    this.position.set(x, h + 1.5, z)
    this.velocity.set(0, 0, 0)
  }

  /** Muiskijken: één keer per frame met de opgebouwde delta. */
  applyLook(dx: number, dy: number): void {
    const sensitivity = 0.0023 * this.sensitivity
    this.yaw -= dx * sensitivity
    this.pitch -= dy * sensitivity
    const maxPitch = Math.PI / 2 - 0.01
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch))
  }

  /** Camerapositie (ogen), inclusief lichte dobber in het water. */
  getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z)
  }

  /** Kijkrichting als eenheidsvector. */
  getLookDirection(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch)
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
  }

  /** Ogen onder het wateroppervlak? (voor onderwater-beeld en -geluid) */
  get eyesUnderwater(): boolean {
    return this.position.y + EYE_HEIGHT < SEA_LEVEL - 0.08
  }

  /** Eén physics-stap met vaste dt (120 Hz). */
  step(dt: number): void {
    const input = this.input
    const pos = this.position
    const vel = this.velocity

    // Gewenste beweegrichting in wereldruimte vanuit de toetsen.
    let fwd = 0
    let strafe = 0
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) fwd += 1
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) fwd -= 1
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) strafe += 1
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) strafe -= 1

    const sinY = Math.sin(this.yaw)
    const cosY = Math.cos(this.yaw)
    // Kijkrichting geprojecteerd op het grondvlak.
    let wishX = -sinY * fwd + cosY * strafe
    let wishZ = -cosY * fwd - sinY * strafe
    const wishLen = Math.hypot(wishX, wishZ)
    if (wishLen > 1) {
      wishX /= wishLen
      wishZ /= wishLen
    }

    // Zwemmen zodra de romp onder het (rustige) wateroppervlak zit.
    const torsoY = pos.y + HEIGHT * 0.55
    this.swimming = torsoY < SEA_LEVEL && this.world.height(pos.x, pos.z) < SEA_LEVEL - 0.4

    if (this.swimming) {
      this.stepSwim(dt, wishX, wishZ, fwd)
    } else {
      this.stepWalk(dt, wishX, wishZ)
    }

    // Horizontale verplaatsing met botsing tegen geplaatste blokken, per as.
    this.moveAxis(0, vel.x * dt)
    this.moveAxis(2, vel.z * dt)
    this.moveAxis(1, vel.y * dt)

    // Boomstammen: cirkel-uitduwing zodat je niet door bomen heen loopt.
    if (this.treeQuery) {
      for (const tree of this.treeQuery(pos.x, pos.z)) {
        const dx = pos.x - tree.x
        const dz = pos.z - tree.z
        const minDist = tree.r + HALF_WIDTH
        const distSq = dx * dx + dz * dz
        if (distSq < minDist * minDist && distSq > 1e-8) {
          const dist = Math.sqrt(distSq)
          const push = (minDist - dist) / dist
          pos.x += dx * push
          pos.z += dz * push
        }
      }
    }

    // Terrein: de vloer onder alles.
    const groundH = this.world.height(pos.x, pos.z)
    this.world.normal(pos.x, pos.z, this.groundNormal)
    const wasAirborne = !this.grounded
    if (pos.y <= groundH) {
      pos.y = groundH
      if (vel.y < 0) vel.y = 0
      this.grounded = true
      // Steile hellingen: laat de speler afglijden in de dalrichting.
      if (this.groundNormal.y < STEEP_NORMAL_Y && !this.swimming) {
        const slide = 30 * dt
        vel.x += this.groundNormal.x * slide
        vel.z += this.groundNormal.z * slide
      }
    } else if (pos.y < groundH + 0.08 && vel.y <= 0 && wasAirborne === false) {
      // Ground-snap: soepel hellingen aflopen zonder te "stuiteren".
      pos.y = groundH
      this.grounded = true
    }
  }

  private stepWalk(dt: number, wishX: number, wishZ: number): void {
    const vel = this.velocity
    const sprint = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')
    const maxSpeed = sprint ? SPRINT_SPEED : WALK_SPEED
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL

    // Versnellen richting gewenste snelheid.
    vel.x += wishX * accel * dt
    vel.z += wishZ * accel * dt

    // Wrijving op de grond (exponentieel dempen) en topsnelheid begrenzen.
    if (this.grounded) {
      const friction = Math.exp(-10 * dt)
      if (wishX === 0 && wishZ === 0) {
        vel.x *= friction
        vel.z *= friction
      }
    }
    const speed = Math.hypot(vel.x, vel.z)
    if (speed > maxSpeed) {
      const s = maxSpeed / speed
      vel.x *= s
      vel.z *= s
    }

    // Zwaartekracht en springen.
    vel.y -= GRAVITY * dt
    if (this.grounded && this.input.isDown('Space') && this.groundNormal.y >= STEEP_NORMAL_Y) {
      vel.y = JUMP_VELOCITY
      this.grounded = false
    }
    if (this.grounded && vel.y < 0) vel.y = 0
    if (vel.y !== 0) this.grounded = false
  }

  private stepSwim(dt: number, wishX: number, wishZ: number, fwd: number): void {
    const vel = this.velocity
    this.grounded = false

    // Beweging volgt de kijkrichting (ook omhoog/omlaag kijken).
    const pitchY = Math.sin(this.pitch) * fwd
    vel.x += wishX * 14 * dt
    vel.z += wishZ * 14 * dt
    vel.y += pitchY * 10 * dt

    // Drijfvermogen: onder het oppervlak zachtjes omhoog, met demping.
    const depth = SEA_LEVEL - (this.position.y + HEIGHT * 0.75)
    vel.y += Math.min(depth, 1) * 14 * dt - 2.2 * dt
    if (this.input.isDown('Space')) vel.y += 22 * dt

    // Waterweerstand.
    const drag = Math.exp(-2.6 * dt)
    vel.multiplyScalar(drag)

    const speed = vel.length()
    const maxSpeed = this.input.isDown('ShiftLeft') ? SWIM_SPEED * 1.5 : SWIM_SPEED
    if (speed > maxSpeed) vel.multiplyScalar(maxSpeed / speed)
  }

  /** Verplaatst één as en lost overlap met blok-AABB's op (Minecraft-stijl). */
  private moveAxis(axis: 0 | 1 | 2, delta: number): void {
    const pos = this.position
    if (axis === 0) pos.x += delta
    else if (axis === 1) pos.y += delta
    else pos.z += delta

    if (!this.blockQuery || delta === 0) return

    const minX = pos.x - HALF_WIDTH
    const maxX = pos.x + HALF_WIDTH
    const minY = pos.y
    const maxY = pos.y + HEIGHT
    const minZ = pos.z - HALF_WIDTH
    const maxZ = pos.z + HALF_WIDTH

    const blocks = this.blockQuery(minX, minY, minZ, maxX, maxY, maxZ)
    for (const b of blocks) {
      if (
        maxX <= b.minX ||
        minX >= b.maxX ||
        maxY <= b.minY ||
        minY >= b.maxY ||
        maxZ <= b.minZ ||
        minZ >= b.maxZ
      ) {
        continue
      }
      if (axis === 0) {
        pos.x = delta > 0 ? b.minX - HALF_WIDTH : b.maxX + HALF_WIDTH
        this.velocity.x = 0
      } else if (axis === 2) {
        pos.z = delta > 0 ? b.minZ - HALF_WIDTH : b.maxZ + HALF_WIDTH
        this.velocity.z = 0
      } else if (delta < 0) {
        // Landen op een blok.
        pos.y = b.maxY
        this.velocity.y = 0
        this.grounded = true
      } else {
        // Hoofd stoten tegen de onderkant.
        pos.y = b.minY - HEIGHT
        this.velocity.y = 0
      }
    }
  }

  /** AABB van de speler (voor plaatsingschecks van het bouwsysteem). */
  getAabb(): BlockAabb {
    return {
      minX: this.position.x - HALF_WIDTH,
      minY: this.position.y,
      minZ: this.position.z - HALF_WIDTH,
      maxX: this.position.x + HALF_WIDTH,
      maxY: this.position.y + HEIGHT,
      maxZ: this.position.z + HALF_WIDTH
    }
  }
}
