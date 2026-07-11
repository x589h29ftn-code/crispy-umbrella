import * as THREE from 'three'
import { chunkRng } from '../core/rng'
import type { Chunk } from '../world/chunkManager'
import type { World } from '../world/terrain'
import { buildVillager, type AnimalRig } from './rig'

type Mood = 'wandelen' | 'staan' | 'zwaaien'

interface Villager {
  rig: AnimalRig
  homeX: number
  homeZ: number
  x: number
  z: number
  heading: number
  mood: Mood
  timer: number
  speed: number
  phase: number
  chunkKey: string
}

/**
 * Dorpelingen: bewoners die binnen hun dorpje rondkuieren, bij de put
 * blijven hangen en naar je zwaaien als je dichtbij komt.
 */
export class Villagers {
  private world: World
  private scene: THREE.Scene
  private list: Villager[] = []

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    this.scene = scene
  }

  /** Spawnt bewoners als deze chunk een dorpsplek heeft. */
  spawnForChunk(chunk: Chunk, village: { x: number; z: number } | null): void {
    if (!village) return
    const rng = chunkRng(this.world.seed, chunk.cx, chunk.cz, 'bewoners')
    const count = 2 + Math.floor(rng() * 2)
    for (let i = 0; i < count; i++) {
      const rig = buildVillager(Math.floor(rng() * 5))
      const a = rng() * Math.PI * 2
      const x = village.x + Math.cos(a) * (3 + rng() * 6)
      const z = village.z + Math.sin(a) * (3 + rng() * 6)
      rig.root.position.set(x, this.world.height(x, z), z)
      this.scene.add(rig.root)
      this.list.push({
        rig,
        homeX: village.x,
        homeZ: village.z,
        x,
        z,
        heading: rng() * Math.PI * 2,
        mood: 'staan',
        timer: 1 + rng() * 3,
        speed: 0,
        phase: rng() * 10,
        chunkKey: chunk.key
      })
    }
  }

  despawnChunk(chunk: Chunk): void {
    this.list = this.list.filter((v) => {
      if (v.chunkKey !== chunk.key) return true
      this.scene.remove(v.rig.root)
      return false
    })
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    for (const v of this.list) {
      const dx = playerPos.x - v.x
      const dz = playerPos.z - v.z
      const playerNear = dx * dx + dz * dz < 4.5 * 4.5

      v.timer -= dt
      if (playerNear && v.mood !== 'zwaaien') {
        v.mood = 'zwaaien'
        v.timer = 2.4
        v.heading = Math.atan2(dx, dz) // naar de speler kijken
      } else if (v.timer <= 0) {
        if (v.mood === 'wandelen') {
          v.mood = 'staan'
          v.timer = 2 + Math.random() * 4
        } else {
          v.mood = 'wandelen'
          v.timer = 3 + Math.random() * 4
          // Nieuwe richting, met een trek terug naar het dorpsplein.
          const homeDx = v.homeX - v.x
          const homeDz = v.homeZ - v.z
          const homeDist = Math.hypot(homeDx, homeDz)
          v.heading =
            homeDist > 10 ? Math.atan2(homeDx, homeDz) + (Math.random() - 0.5) : Math.random() * Math.PI * 2
        }
      }

      const walking = v.mood === 'wandelen' && !playerNear
      const target = walking ? 1.2 : 0
      v.speed += (target - v.speed) * Math.min(1, dt * 5)
      v.x += Math.sin(v.heading) * v.speed * dt
      v.z += Math.cos(v.heading) * v.speed * dt
      v.phase += dt * (1.5 + v.speed * 3)

      const root = v.rig.root
      root.position.set(v.x, this.world.height(v.x, v.z), v.z)
      root.rotation.y = v.heading

      // Beentjes en armen; zwaaien met de rechterarm.
      v.rig.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(v.phase * 3 + i * Math.PI) * v.speed * 0.45
      })
      const [left, right] = v.rig.wings
      left.rotation.x = Math.sin(v.phase * 3 + Math.PI) * v.speed * 0.3
      if (v.mood === 'zwaaien') {
        right.rotation.z = Math.PI - 0.4 + Math.sin(v.phase * 8) * 0.35
        right.rotation.x = 0
      } else {
        right.rotation.z = 0
        right.rotation.x = Math.sin(v.phase * 3) * v.speed * 0.3
      }
      v.rig.body.rotation.z = Math.sin(v.phase * 1.2) * 0.015
    }
  }
}
