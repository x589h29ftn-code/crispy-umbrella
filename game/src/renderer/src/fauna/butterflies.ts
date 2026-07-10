import * as THREE from 'three'
import type { World } from '../world/terrain'

const COLORS = [0xffd54a, 0xff8ab5, 0x9ad7ff, 0xffffff, 0xffa94d]
const COUNT = 14

interface Butterfly {
  root: THREE.Group
  wingL: THREE.Mesh
  wingR: THREE.Mesh
  pos: THREE.Vector3
  target: THREE.Vector3
  phase: number
  retarget: number
}

/**
 * Vlinders die laag boven het gras rondfladderen. Ze kiezen steeds een nieuw
 * doelpunt in de buurt van de speler, zodat het veld altijd leeft.
 */
export class Butterflies {
  private world: World
  private list: Butterfly[] = []

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    const wingGeo = new THREE.PlaneGeometry(0.14, 0.1)
    wingGeo.translate(0.07, 0, 0)

    for (let i = 0; i < COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: COLORS[i % COLORS.length],
        side: THREE.DoubleSide
      })
      const root = new THREE.Group()
      const wingL = new THREE.Mesh(wingGeo, mat)
      wingL.rotation.y = Math.PI
      const wingR = new THREE.Mesh(wingGeo, mat)
      root.add(wingL, wingR)
      scene.add(root)
      this.list.push({
        root,
        wingL,
        wingR,
        pos: new THREE.Vector3(i * 3, 5, i * 2),
        target: new THREE.Vector3(),
        phase: i * 2.1,
        retarget: 0
      })
    }
  }

  update(dt: number, playerPos: THREE.Vector3, nightness: number): void {
    // 's Nachts slapen de vlinders (onzichtbaar).
    const visible = nightness < 0.5
    for (const b of this.list) {
      b.root.visible = visible
      if (!visible) continue

      b.phase += dt
      b.retarget -= dt
      if (b.retarget <= 0 || b.pos.distanceToSquared(b.target) < 0.6) {
        b.retarget = 3 + Math.random() * 5
        const a = Math.random() * Math.PI * 2
        const r = 4 + Math.random() * 24
        const x = playerPos.x + Math.cos(a) * r
        const z = playerPos.z + Math.sin(a) * r
        const h = this.world.height(x, z)
        if (h < 1.6) {
          b.retarget = 0.1 // boven water/strand: meteen opnieuw kiezen
          continue
        }
        b.target.set(x, h + 0.7 + Math.random() * 1.1, z)
      }

      // Fladderend richting het doel, met wat wiebel.
      const dir = b.target.clone().sub(b.pos)
      const dist = dir.length()
      if (dist > 0.01) dir.divideScalar(dist)
      const speed = Math.min(1.6, dist)
      b.pos.addScaledVector(dir, speed * dt)
      b.pos.y += Math.sin(b.phase * 7) * 0.35 * dt

      b.root.position.copy(b.pos)
      b.root.rotation.y = Math.atan2(dir.x, dir.z)

      const flap = Math.sin(b.phase * 22) * 1.1
      b.wingL.rotation.z = flap
      b.wingR.rotation.z = -flap
    }
  }
}
