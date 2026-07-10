import * as THREE from 'three'
import type { World } from '../world/terrain'

const COUNT = 28

interface Firefly {
  mesh: THREE.Mesh
  anchor: THREE.Vector3
  phase: number
}

/**
 * Vuurvliegjes: warme lichtpuntjes die in de schemer en nacht laag boven het
 * gras zweven. Het additieve materiaal licht op in de bloom-pass.
 */
export class Fireflies {
  private list: Firefly[] = []
  private material: THREE.MeshBasicMaterial
  private world: World

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffb84d,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const geo = new THREE.SphereGeometry(0.045, 6, 4)
    for (let i = 0; i < COUNT; i++) {
      const mesh = new THREE.Mesh(geo, this.material)
      scene.add(mesh)
      this.list.push({
        mesh,
        anchor: new THREE.Vector3(i * 2, 0, -i * 1.3),
        phase: i * 1.7
      })
    }
  }

  update(dt: number, playerPos: THREE.Vector3, nightness: number): void {
    // Alleen zichtbaar in schemer en nacht; zachte fade.
    const target = THREE.MathUtils.smoothstep(nightness, 0.15, 0.5) * 0.9
    this.material.opacity += (target - this.material.opacity) * Math.min(1, dt * 2)
    const visible = this.material.opacity > 0.02

    for (const f of this.list) {
      f.mesh.visible = visible
      if (!visible) continue
      f.phase += dt

      // Anker drijft langzaam mee met de speler.
      if (f.anchor.distanceToSquared(playerPos) > 30 * 30) {
        const a = Math.random() * Math.PI * 2
        const r = 6 + Math.random() * 20
        f.anchor.set(playerPos.x + Math.cos(a) * r, 0, playerPos.z + Math.sin(a) * r)
      }

      const x = f.anchor.x + Math.sin(f.phase * 0.7) * 2.2 + Math.sin(f.phase * 1.9) * 0.5
      const z = f.anchor.z + Math.cos(f.phase * 0.55) * 2.2 + Math.cos(f.phase * 2.3) * 0.5
      const ground = this.world.height(x, z)
      const y = Math.max(ground, 0) + 0.7 + Math.sin(f.phase * 1.3) * 0.45
      f.mesh.position.set(x, y, z)
      // Knipperen: schaal pulseert zachtjes.
      const s = 0.7 + 0.5 * Math.max(0, Math.sin(f.phase * 2.1 + f.anchor.x))
      f.mesh.scale.setScalar(s)
    }
  }
}
