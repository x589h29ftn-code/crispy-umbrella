import * as THREE from 'three'
import { chunkRng } from '../core/rng'
import type { Chunk } from '../world/chunkManager'
import { CHUNK_SIZE, type World } from '../world/terrain'
import { buildDeer, buildRabbit, type AnimalRig } from './rig'

const MAX_ANIMALS = 30
const STEER_INTERVAL = 1 / 20

type Species = 'rabbit' | 'deer'
type Behaviour = 'idle' | 'walk' | 'flee'

interface Animal {
  rig: AnimalRig
  species: Species
  x: number
  z: number
  heading: number
  behaviour: Behaviour
  timer: number
  speed: number
  phase: number
  grazing: boolean
  chunkKey: string
}

/**
 * Landdieren: konijnen in het grasland, herten aan de bosrand. Ze zwerven
 * rustig rond, grazen af en toe en schrikken van de speler. Spawn is
 * deterministisch per chunk; bij het lossen van de chunk verdwijnen ze weer.
 */
export class Animals {
  private world: World
  private scene: THREE.Scene
  private animals: Animal[] = []
  private steerTimer = 0

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    this.scene = scene
  }

  get count(): number {
    return this.animals.length
  }

  /** Aantal dieren binnen een straal van een punt (voor geluid). */
  countNear(x: number, z: number, radius: number): number {
    let n = 0
    const r2 = radius * radius
    for (const a of this.animals) {
      const dx = a.x - x
      const dz = a.z - z
      if (dx * dx + dz * dz < r2) n++
    }
    return n
  }

  spawnForChunk(chunk: Chunk): void {
    if (this.animals.length >= MAX_ANIMALS) return
    const rng = chunkRng(this.world.seed, chunk.cx, chunk.cz, 'fauna')
    if (rng() > 0.35) return

    const n = 1 + Math.floor(rng() * 2)
    for (let i = 0; i < n && this.animals.length < MAX_ANIMALS; i++) {
      const x = chunk.cx * CHUNK_SIZE + 8 + rng() * (CHUNK_SIZE - 16)
      const z = chunk.cz * CHUNK_SIZE + 8 + rng() * (CHUNK_SIZE - 16)
      const h = this.world.height(x, z)
      if (h < 2 || h > 28) continue
      if (this.world.normal(x, z).y < 0.8) continue

      const forest = this.world.forestness(x, z)
      const species: Species = forest > 0.4 ? 'deer' : 'rabbit'
      const rig = species === 'deer' ? buildDeer() : buildRabbit()
      rig.root.position.set(x, h, z)
      this.scene.add(rig.root)

      this.animals.push({
        rig,
        species,
        x,
        z,
        heading: rng() * Math.PI * 2,
        behaviour: 'idle',
        timer: 1 + rng() * 4,
        speed: 0,
        phase: rng() * 10,
        grazing: false,
        chunkKey: chunk.key
      })
    }
  }

  despawnChunk(chunk: Chunk): void {
    this.animals = this.animals.filter((a) => {
      if (a.chunkKey !== chunk.key) return true
      this.scene.remove(a.rig.root)
      return false
    })
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.steerTimer += dt
    const steer = this.steerTimer >= STEER_INTERVAL
    if (steer) this.steerTimer = 0

    for (const a of this.animals) {
      if (steer) this.steerAnimal(a, STEER_INTERVAL, playerPos)

      // Voortbewegen langs de heading.
      const walkSpeed = a.behaviour === 'flee' ? (a.species === 'deer' ? 7 : 5) : 1.4
      const target = a.behaviour === 'idle' ? 0 : walkSpeed
      a.speed += (target - a.speed) * Math.min(1, dt * 6)
      a.x += Math.sin(a.heading) * a.speed * dt
      a.z += Math.cos(a.heading) * a.speed * dt

      const h = this.world.height(a.x, a.z)
      a.phase += dt * (2 + a.speed * 2.2)

      const root = a.rig.root
      root.position.x = a.x
      root.position.z = a.z
      // Konijnen huppen; herten stappen.
      const hop = a.species === 'rabbit' && a.speed > 0.3 ? Math.abs(Math.sin(a.phase * 2.4)) * 0.16 : 0
      root.position.y = h + hop
      root.rotation.y = a.heading

      // Procedurele animatie: pootjes, dobberend lijf, grazende kop.
      const legSwing = a.speed * 0.16
      a.rig.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(a.phase * 3 + (i % 2) * Math.PI + Math.floor(i / 2) * Math.PI) * legSwing
      })
      a.rig.body.rotation.z = Math.sin(a.phase * 1.4) * 0.02
      const headTarget = a.grazing ? (a.species === 'deer' ? 0.9 : 0.5) : 0
      a.rig.head.rotation.x += (headTarget - a.rig.head.rotation.x) * Math.min(1, dt * 3)
    }
  }

  private steerAnimal(a: Animal, dt: number, playerPos: THREE.Vector3): void {
    const dx = a.x - playerPos.x
    const dz = a.z - playerPos.z
    const playerDistSq = dx * dx + dz * dz

    // Schrikken: wegrennen van de speler.
    if (playerDistSq < 5 * 5 && a.behaviour !== 'flee') {
      a.behaviour = 'flee'
      a.timer = 2.5
      a.grazing = false
      a.heading = Math.atan2(dx, dz)
    }

    a.timer -= dt
    if (a.timer <= 0) {
      if (a.behaviour === 'idle') {
        a.behaviour = 'walk'
        a.timer = 3 + Math.random() * 5
        a.heading += (Math.random() - 0.5) * 2.5
        a.grazing = false
      } else {
        a.behaviour = 'idle'
        a.timer = 2 + Math.random() * 5
        a.grazing = Math.random() < 0.6
      }
    }

    // Vooruitkijken: water en steile hellingen vermijden.
    if (a.behaviour !== 'idle') {
      const lookAhead = 2.5
      const nx = a.x + Math.sin(a.heading) * lookAhead
      const nz = a.z + Math.cos(a.heading) * lookAhead
      if (this.world.height(nx, nz) < 1.2 || this.world.normal(nx, nz).y < 0.72) {
        a.heading += 2.1
      }
    }
  }
}
