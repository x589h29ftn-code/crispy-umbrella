import * as THREE from 'three'
import type { World } from '../world/terrain'
import { buildBird, type AnimalRig } from './rig'

const FLOCK_COLORS = [0x4a5568, 0xf5f0e6, 0x7a4a3a]

interface Bird {
  rig: AnimalRig
  angleOffset: number
  radiusOffset: number
  heightOffset: number
  phase: number
}

interface Flock {
  birds: Bird[]
  center: THREE.Vector3
  radius: number
  angle: number
  speed: number
  drift: number
}

/**
 * Vogelzwermen die in wijde cirkels om de omgeving van de speler vliegen,
 * met flapperende vleugels. Ze zijn niet aan chunks gebonden: de lucht is
 * altijd bewoond.
 */
export class Birds {
  private flocks: Flock[] = []
  private world: World

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    for (let f = 0; f < 3; f++) {
      const birds: Bird[] = []
      const color = FLOCK_COLORS[f % FLOCK_COLORS.length]
      const count = 5 + f
      for (let i = 0; i < count; i++) {
        const rig = buildBird(color)
        scene.add(rig.root)
        birds.push({
          rig,
          angleOffset: (i / count) * 0.9 + Math.sin(i * 3.7) * 0.15,
          radiusOffset: Math.sin(i * 2.3) * 6,
          heightOffset: Math.sin(i * 1.7) * 4,
          phase: i * 1.3
        })
      }
      this.flocks.push({
        birds,
        center: new THREE.Vector3((f - 1) * 120, 0, (f - 1) * 80),
        radius: 45 + f * 22,
        angle: f * 2.1,
        speed: 0.14 + f * 0.03,
        drift: f * 2
      })
    }
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    for (const flock of this.flocks) {
      // De zwerm drijft langzaam naar de buurt van de speler.
      flock.center.x += (playerPos.x + Math.sin(flock.drift) * 90 - flock.center.x) * dt * 0.02
      flock.center.z += (playerPos.z + Math.cos(flock.drift * 0.8) * 90 - flock.center.z) * dt * 0.02
      flock.drift += dt * 0.01
      flock.angle += flock.speed * dt

      for (const bird of flock.birds) {
        bird.phase += dt * 9
        const a = flock.angle + bird.angleOffset
        const r = flock.radius + bird.radiusOffset + Math.sin(bird.phase * 0.13) * 3
        const x = flock.center.x + Math.cos(a) * r
        const z = flock.center.z + Math.sin(a) * r
        const ground = this.world.height(x, z)
        const y =
          Math.max(ground + 25, 32) + bird.heightOffset + Math.sin(bird.phase * 0.21 + bird.angleOffset * 5) * 2

        const root = bird.rig.root
        root.position.set(x, y, z)
        // Neus in de vliegrichting (raaklijn aan de cirkel).
        root.rotation.y = -a - Math.PI / 2
        root.rotation.z = 0.18 // lichte helling de bocht in

        const flap = Math.sin(bird.phase) * 0.65
        bird.rig.wings[0].rotation.z = flap
        bird.rig.wings[1].rotation.z = -flap
      }
    }
  }
}
