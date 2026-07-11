import * as THREE from 'three'
import { combineSeed, mulberry32 } from '../core/rng'
import { winterness } from './season'

export type WeatherKind = 'helder' | 'bewolkt' | 'regen' | 'onweer'

const RAIN_COUNT = 650
const SNOW_COUNT = 450
const CLOUD_COUNT = 14
const AREA = 34 // regen/sneeuw valt in een doos van 2·AREA rond de camera

/**
 * Weer: een toestandsmachine die tussen helder, bewolkt, regen en onweer
 * wandelt. Neerslag valt als instanced deeltjes rond de camera; wolken
 * drijven altijd over. In de winter (of hoog in de bergen) valt sneeuw.
 */
export class Weather {
  kind: WeatherKind = 'helder'
  cloudiness = 0 // gladgestreken 0..1
  intensity = 0 // gladgestreken neerslag 0..1
  /** Bliksemflits 0..1 — Game koppelt dit aan de belichting. */
  flash = 0
  /** Callback voor de donderklap (al met afstandsvertraging gepland). */
  onThunder: (() => void) | null = null

  private rng: () => number
  private timer = 40
  private targetCloud = 0
  private targetRain = 0
  private rain: THREE.InstancedMesh
  private snow: THREE.InstancedMesh
  private drops: { x: number; y: number; z: number; speed: number }[] = []
  private flakes: { x: number; y: number; z: number; phase: number }[] = []
  private clouds: THREE.Group
  private snowMode = false
  private matrix = new THREE.Matrix4()
  private thunderIn = -1

  constructor(seed: number, scene: THREE.Scene) {
    this.rng = mulberry32(combineSeed(seed, 777))

    // Regen: dunne verticale streepjes.
    const dropGeo = new THREE.BoxGeometry(0.02, 0.65, 0.02)
    const dropMat = new THREE.MeshBasicMaterial({ color: 0xa8c4d8, transparent: true, opacity: 0.4 })
    this.rain = new THREE.InstancedMesh(dropGeo, dropMat, RAIN_COUNT)
    this.rain.frustumCulled = false
    this.rain.visible = false
    scene.add(this.rain)
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.drops.push({
        x: (this.rng() - 0.5) * AREA * 2,
        y: this.rng() * 24,
        z: (this.rng() - 0.5) * AREA * 2,
        speed: 16 + this.rng() * 6
      })
    }

    // Sneeuw: langzame vlokjes.
    const flakeGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09)
    const flakeMat = new THREE.MeshBasicMaterial({ color: 0xf4f7fa, transparent: true, opacity: 0.85 })
    this.snow = new THREE.InstancedMesh(flakeGeo, flakeMat, SNOW_COUNT)
    this.snow.frustumCulled = false
    this.snow.visible = false
    scene.add(this.snow)
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.flakes.push({
        x: (this.rng() - 0.5) * AREA * 2,
        y: this.rng() * 22,
        z: (this.rng() - 0.5) * AREA * 2,
        phase: this.rng() * 10
      })
    }

    // Wolken: platte knoestige clusters die hoog overdrijven.
    this.clouds = new THREE.Group()
    const cloudMat = new THREE.MeshLambertMaterial({
      color: 0xf2f4f6,
      transparent: true,
      opacity: 0.82,
      flatShading: true
    })
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const cluster = new THREE.Group()
      const blobs = 3 + Math.floor(this.rng() * 3)
      for (let b = 0; b < blobs; b++) {
        const r = 9 + this.rng() * 14
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat)
        blob.scale.set(1.6, 0.42, 1.1)
        blob.position.set((b - blobs / 2) * r * 1.1, (this.rng() - 0.5) * 4, (this.rng() - 0.5) * r)
        cluster.add(blob)
      }
      cluster.position.set((this.rng() - 0.5) * 1600, 125 + this.rng() * 45, (this.rng() - 0.5) * 1600)
      this.clouds.add(cluster)
    }
    scene.add(this.clouds)
  }

  update(dt: number, playerPos: THREE.Vector3, seasonT: number, playerAltitude: number): void {
    // Toestandsmachine: elke 1,5-4 minuten een nieuwe weerskeuze.
    this.timer -= dt
    if (this.timer <= 0) {
      const roll = this.rng()
      if (this.kind === 'helder') this.kind = roll < 0.55 ? 'bewolkt' : 'helder'
      else if (this.kind === 'bewolkt') this.kind = roll < 0.4 ? 'regen' : roll < 0.75 ? 'helder' : 'bewolkt'
      else if (this.kind === 'regen') this.kind = roll < 0.25 ? 'onweer' : roll < 0.7 ? 'bewolkt' : 'regen'
      else this.kind = roll < 0.6 ? 'regen' : 'bewolkt'
      this.timer = 90 + this.rng() * 150
      this.targetCloud = { helder: 0.08, bewolkt: 0.55, regen: 0.85, onweer: 1 }[this.kind]
      this.targetRain = { helder: 0, bewolkt: 0, regen: 0.7, onweer: 1 }[this.kind]
    }
    const ease = Math.min(1, dt * 0.12)
    this.cloudiness += (this.targetCloud - this.cloudiness) * ease
    this.intensity += (this.targetRain - this.intensity) * ease

    // Sneeuw in de winter of hoog in de bergen.
    this.snowMode = winterness(seasonT) > 0.5 || playerAltitude > 55

    // Neerslagdeeltjes rond de camera laten vallen en recyclen.
    const active = this.intensity > 0.05
    this.rain.visible = active && !this.snowMode
    this.snow.visible = active && this.snowMode
    if (this.rain.visible) {
      const visibleDrops = Math.floor(RAIN_COUNT * this.intensity)
      this.rain.count = visibleDrops
      for (let i = 0; i < visibleDrops; i++) {
        const d = this.drops[i]
        d.y -= d.speed * dt
        if (d.y < 0) {
          d.y = 22 + this.rng() * 4
          d.x = (this.rng() - 0.5) * AREA * 2
          d.z = (this.rng() - 0.5) * AREA * 2
        }
        this.matrix.makeTranslation(playerPos.x + d.x, playerPos.y - 4 + d.y, playerPos.z + d.z)
        this.rain.setMatrixAt(i, this.matrix)
      }
      this.rain.instanceMatrix.needsUpdate = true
    }
    if (this.snow.visible) {
      const visibleFlakes = Math.floor(SNOW_COUNT * this.intensity)
      this.snow.count = visibleFlakes
      for (let i = 0; i < visibleFlakes; i++) {
        const f = this.flakes[i]
        f.phase += dt
        f.y -= 1.6 * dt
        if (f.y < 0) {
          f.y = 20 + this.rng() * 4
          f.x = (this.rng() - 0.5) * AREA * 2
          f.z = (this.rng() - 0.5) * AREA * 2
        }
        this.matrix.makeTranslation(
          playerPos.x + f.x + Math.sin(f.phase * 1.3) * 0.8,
          playerPos.y - 4 + f.y,
          playerPos.z + f.z + Math.cos(f.phase * 0.9) * 0.8
        )
        this.snow.setMatrixAt(i, this.matrix)
      }
      this.snow.instanceMatrix.needsUpdate = true
    }

    // Wolken drijven langzaam en blijven rond de speler.
    for (const cluster of this.clouds.children) {
      cluster.position.x += dt * 2.2
      if (cluster.position.x - playerPos.x > 900) cluster.position.x -= 1800
      if (cluster.position.x - playerPos.x < -900) cluster.position.x += 1800
      if (cluster.position.z - playerPos.z > 900) cluster.position.z -= 1800
      if (cluster.position.z - playerPos.z < -900) cluster.position.z += 1800
    }

    // Bliksem tijdens onweer.
    this.flash *= Math.exp(-7 * dt)
    if (this.kind === 'onweer' && this.intensity > 0.6 && this.rng() < dt * 0.12) {
      this.flash = 0.8 + this.rng() * 0.2
      this.thunderIn = 0.6 + this.rng() * 2.4 // afstandsvertraging
    }
    if (this.thunderIn >= 0) {
      this.thunderIn -= dt
      if (this.thunderIn < 0) this.onThunder?.()
    }
  }
}
