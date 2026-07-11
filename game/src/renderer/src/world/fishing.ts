import * as THREE from 'three'
import { SEA_LEVEL, type World } from './terrain'

type FishState = 'idle' | 'vliegend' | 'drijvend' | 'beet' | 'vangst'

const FISH_LAKE = ['Baars', 'Snoek', 'Karper', 'Voorn']
const FISH_SEA = ['Makreel', 'Haring', 'Zeebaars', 'Schol']

/**
 * Vissen: werp een dobber uit, wacht op de beet (dobber dipt + plink) en
 * klik binnen 1,2 s om de vis binnen te halen.
 */
export class Fishing {
  state: FishState = 'idle'
  catches = 0
  onToast: ((msg: string) => void) | null = null
  onPlink: (() => void) | null = null
  onSplash: (() => void) | null = null

  private world: World
  private bobber: THREE.Mesh
  private fish: THREE.Group
  private line: THREE.Line
  private linePositions: THREE.BufferAttribute
  private vel = new THREE.Vector3()
  private biteTimer = 0
  private biteWindow = 0
  private fishTimer = 0
  private time = 0

  constructor(world: World, scene: THREE.Scene) {
    this.world = world

    const bobberGeo = new THREE.SphereGeometry(0.09, 8, 6)
    const bobberMat = new THREE.MeshLambertMaterial({ color: 0xd93a2b })
    this.bobber = new THREE.Mesh(bobberGeo, bobberMat)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 4), new THREE.MeshLambertMaterial({ color: 0xf2f2ee }))
    cap.position.y = 0.07
    this.bobber.add(cap)
    this.bobber.visible = false
    scene.add(this.bobber)

    // Visje voor de vangstanimatie.
    this.fish = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.4, 6),
      new THREE.MeshLambertMaterial({ color: 0x7d99a8, flatShading: true })
    )
    body.rotation.x = Math.PI / 2
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.16, 4),
      new THREE.MeshLambertMaterial({ color: 0x64808f, flatShading: true })
    )
    tail.rotation.x = -Math.PI / 2
    tail.position.z = -0.26
    this.fish.add(body, tail)
    this.fish.visible = false
    scene.add(this.fish)

    const lineGeo = new THREE.BufferGeometry()
    this.linePositions = new THREE.BufferAttribute(new Float32Array(6), 3)
    lineGeo.setAttribute('position', this.linePositions)
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.6 }))
    this.line.visible = false
    this.line.frustumCulled = false
    scene.add(this.line)
  }

  get active(): boolean {
    return this.state !== 'idle'
  }

  /** Werpen (of binnenhalen/aanslaan als er al een dobber uit ligt). */
  click(eye: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.state === 'idle') {
      this.state = 'vliegend'
      this.bobber.visible = true
      this.line.visible = true
      this.bobber.position.copy(eye).addScaledVector(dir, 0.8)
      this.vel.copy(dir).multiplyScalar(13)
      this.vel.y += 3.5
    } else if (this.state === 'beet') {
      // Aanslaan: vangst!
      this.catches++
      const lake = this.world.lakeness(this.bobber.position.x, this.bobber.position.z) > 0.3
      const list = lake ? FISH_LAKE : FISH_SEA
      const name = list[Math.floor(Math.random() * list.length)]
      this.onToast?.(`\u{1F41F} ${name} gevangen! (totaal: ${this.catches})`)
      this.fish.visible = true
      this.fish.position.copy(this.bobber.position)
      this.fishTimer = 0
      this.state = 'vangst'
      this.bobber.visible = false
      this.onSplash?.()
    } else {
      // Binnenhalen zonder beet.
      this.reset()
    }
  }

  reset(): void {
    this.state = 'idle'
    this.bobber.visible = false
    this.line.visible = false
    this.fish.visible = false
  }

  update(dt: number, eye: THREE.Vector3): void {
    this.time += dt
    if (this.state === 'idle') return

    if (this.state === 'vliegend') {
      this.vel.y -= 18 * dt
      this.bobber.position.addScaledVector(this.vel, dt)
      const ground = this.world.height(this.bobber.position.x, this.bobber.position.z)
      if (this.bobber.position.y <= SEA_LEVEL + 0.05 && ground < -0.2) {
        // Plons in het water: drijven en wachten op de beet.
        this.bobber.position.y = SEA_LEVEL + 0.02
        this.state = 'drijvend'
        this.biteTimer = 3 + Math.random() * 7
        this.onSplash?.()
      } else if (this.bobber.position.y <= ground + 0.05) {
        this.onToast?.('Werp de dobber in het water.')
        this.reset()
        return
      }
    } else if (this.state === 'drijvend') {
      this.bobber.position.y = SEA_LEVEL + 0.02 + Math.sin(this.time * 1.7) * 0.03
      this.biteTimer -= dt
      if (this.biteTimer <= 0) {
        this.state = 'beet'
        this.biteWindow = 1.2
        this.onPlink?.()
      }
    } else if (this.state === 'beet') {
      this.bobber.position.y = SEA_LEVEL - 0.14 + Math.sin(this.time * 9) * 0.03
      this.biteWindow -= dt
      if (this.biteWindow <= 0) {
        this.state = 'drijvend'
        this.biteTimer = 3 + Math.random() * 7
      }
    } else if (this.state === 'vangst') {
      // Visje springt in een boog richting de speler.
      this.fishTimer += dt
      const t = Math.min(1, this.fishTimer / 0.9)
      const start = this.fish.position
      start.lerp(eye, dt * 2.2)
      start.y = SEA_LEVEL + Math.sin(t * Math.PI) * 1.6
      this.fish.rotation.z += dt * 9
      if (t >= 1) this.reset()
      return
    }

    // Vislijn van net onder de camera naar de dobber.
    const arr = this.linePositions.array as Float32Array
    arr[0] = eye.x
    arr[1] = eye.y - 0.25
    arr[2] = eye.z
    arr[3] = this.bobber.position.x
    arr[4] = this.bobber.position.y + 0.08
    arr[5] = this.bobber.position.z
    this.linePositions.needsUpdate = true
  }
}
