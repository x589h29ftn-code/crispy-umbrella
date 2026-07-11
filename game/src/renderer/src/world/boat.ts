import * as THREE from 'three'
import type { Input } from '../core/input'
import { SEA_LEVEL, type World } from './terrain'

/** Eén kano in de wereld. */
export interface Canoe {
  group: THREE.Group
  paddle: THREE.Mesh
  x: number
  z: number
  heading: number
  speed: number
}

function buildCanoe(): { group: THREE.Group; paddle: THREE.Mesh } {
  const group = new THREE.Group()
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x8a5a33, flatShading: true })
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x63482e, flatShading: true })

  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 3.2), hullMat)
  hull.position.y = 0.2
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 4), hullMat)
  bow.rotation.x = Math.PI / 2
  bow.rotation.z = Math.PI / 4
  bow.position.set(0, 0.24, 2.0)
  const stern = bow.clone()
  stern.rotation.x = -Math.PI / 2
  stern.position.z = -2.0
  const rimL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 3.4), trimMat)
  rimL.position.set(-0.45, 0.44, 0)
  const rimR = rimL.clone()
  rimR.position.x = 0.45
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.4), trimMat)
  seat.position.set(0, 0.32, -0.5)
  const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), trimMat)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.45, 0.24), trimMat)
  blade.position.y = -0.75
  paddle.add(blade)
  paddle.position.set(0.55, 0.7, -0.3)
  paddle.rotation.z = 0.4
  for (const part of [hull, bow, stern, rimL, rimR, seat, paddle]) {
    part.castShadow = true
    group.add(part)
  }
  return { group, paddle }
}

/**
 * Kano's: afgemeerd bij de steiger van het meerhuisje en op een paar
 * strandplekken. Met E stap je in en uit; in de kano peddel je met WASD.
 */
export class Boats {
  readonly canoes: Canoe[] = []
  active: Canoe | null = null
  private world: World
  private input: Input
  private time = 0
  onSplash: (() => void) | null = null
  private strokeTimer = 0

  constructor(world: World, scene: THREE.Scene, moorings: { x: number; z: number }[]) {
    this.world = world
    this.input = null as unknown as Input // gezet via bind()
    for (const m of moorings) {
      const { group, paddle } = buildCanoe()
      group.position.set(m.x, SEA_LEVEL + 0.05, m.z)
      const heading = Math.random() * Math.PI * 2
      group.rotation.y = heading
      scene.add(group)
      this.canoes.push({ group, paddle, x: m.x, z: m.z, heading, speed: 0 })
    }
  }

  bind(input: Input): void {
    this.input = input
  }

  /** Dichtstbijzijnde kano binnen `maxDist` van een punt. */
  nearest(x: number, z: number, maxDist: number): Canoe | null {
    let best: Canoe | null = null
    let bestD = maxDist * maxDist
    for (const c of this.canoes) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return best
  }

  enter(canoe: Canoe): void {
    this.active = canoe
    canoe.speed = 0
  }

  /** Verlaat de kano; geeft de uitstapplek terug (naast de kano). */
  exit(): { x: number; z: number } | null {
    const c = this.active
    if (!c) return null
    this.active = null
    return { x: c.x + Math.cos(c.heading) * 1.4, z: c.z - Math.sin(c.heading) * 1.4 }
  }

  /** Vaarfysica + peddelanimatie; retourneert de camera-ankerpositie. */
  update(dt: number, yaw: number): THREE.Vector3 | null {
    this.time += dt
    // Afgemeerde kano's dobberen zachtjes.
    for (const c of this.canoes) {
      if (c === this.active) continue
      c.group.position.y = SEA_LEVEL + 0.05 + Math.sin(this.time * 1.1 + c.x) * 0.05
      c.group.rotation.z = Math.sin(this.time * 0.9 + c.z) * 0.02
    }

    const c = this.active
    if (!c) return null

    // Sturen met A/D, peddelen met W/S.
    let thrust = 0
    if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) thrust += 1
    if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) thrust -= 0.5
    let turn = 0
    if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) turn += 1
    if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) turn -= 1
    c.heading += turn * dt * (0.6 + Math.abs(c.speed) * 0.12)
    c.speed += thrust * dt * 3.2
    c.speed *= Math.exp(-0.55 * dt)
    c.speed = Math.max(-2, Math.min(5, c.speed))

    const dirX = -Math.sin(c.heading)
    const dirZ = -Math.cos(c.heading)
    const nx = c.x + dirX * c.speed * dt
    const nz = c.z + dirZ * c.speed * dt
    // Alleen varen waar het water diep genoeg is.
    if (this.world.height(nx, nz) < -0.35) {
      c.x = nx
      c.z = nz
    } else {
      c.speed *= 0.4
    }

    // Dobberen en overhellen in de vaarrichting.
    c.group.position.set(c.x, SEA_LEVEL + 0.05 + Math.sin(this.time * 1.4) * 0.06, c.z)
    c.group.rotation.y = c.heading
    c.group.rotation.z = Math.sin(this.time * 1.2) * 0.02 - turn * 0.05
    c.group.rotation.x = -c.speed * 0.015

    // Peddelslag: heen en weer als je vaart maakt.
    const stroke = Math.abs(thrust) > 0 ? Math.sin(this.time * 5) : 0
    c.paddle.rotation.x = stroke * 0.7
    c.paddle.position.x = stroke > 0 ? 0.55 : -0.55
    this.strokeTimer -= dt
    if (Math.abs(thrust) > 0 && this.strokeTimer <= 0) {
      this.strokeTimer = 0.63
      this.onSplash?.()
    }

    void yaw
    return c.group.position
  }
}
