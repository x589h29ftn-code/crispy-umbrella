import * as THREE from 'three'
import { Ambient } from '../audio/ambient'
import { Creatures } from '../audio/creatures'
import { AudioEngine, type Bus } from '../audio/engine'
import { Music } from '../audio/music'
import { BlockMesher } from '../build/blockMesher'
import { BlockStore } from '../build/blockStore'
import { BuildSystem } from '../build/placement'
import { Animals } from '../fauna/animals'
import { Birds } from '../fauna/birds'
import { PlayerController } from '../player/controller'
import { biomeName } from '../world/biomes'
import { ChunkManager, VIEW_DISTANCE } from '../world/chunkManager'
import { clamp } from '../world/noise'
import { Sky } from '../world/sky'
import { CHUNK_SIZE, SEA_LEVEL, World } from '../world/terrain'
import { Vegetation } from '../world/vegetation'
import { Water } from '../world/water'
import type { Hud } from '../ui/hud'
import { Graphics } from './graphics'
import { Input } from './input'

const FIXED_DT = 1 / 120
const FOG_NEAR = VIEW_DISTANCE * CHUNK_SIZE * 0.55
const FOG_FAR = VIEW_DISTANCE * CHUNK_SIZE * 0.95

/** Verbindt alle systemen en draait de game-lus. */
export class Game {
  readonly world: World
  readonly scene: THREE.Scene
  readonly graphics: Graphics
  readonly input: Input
  readonly player: PlayerController
  readonly chunks: ChunkManager
  readonly water: Water
  readonly sky: Sky
  readonly blocks: BlockStore
  readonly build: BuildSystem
  private mesher: BlockMesher
  private hud: Hud
  paused = false

  private accumulator = 0
  private lastTime = 0
  private fpsSmooth = 60
  private statsTimer = 0
  private eye = new THREE.Vector3()
  private look = new THREE.Vector3()
  private fog: THREE.Fog
  /** Extra systemen (vegetatie-tijd, fauna, audio) haken hier in. */
  private updaters: ((dt: number) => void)[] = []

  constructor(seed: string, container: HTMLElement, hud: Hud) {
    this.hud = hud
    this.world = new World(seed)
    this.scene = new THREE.Scene()
    this.fog = new THREE.Fog(0xd8ecf4, FOG_NEAR, FOG_FAR)
    this.scene.fog = this.fog

    this.graphics = new Graphics(container, this.scene)
    this.input = new Input()
    this.input.attach(this.graphics.renderer.domElement)

    this.player = new PlayerController(this.world, this.input)
    this.chunks = new ChunkManager(this.world, this.scene)
    this.water = new Water(this.world)
    this.scene.add(this.water.mesh)
    this.sky = new Sky(this.scene)
    this.sky.dome.scale.setScalar(600)

    this.blocks = new BlockStore()
    this.mesher = new BlockMesher(this.scene, this.blocks)
    this.build = new BuildSystem(this.scene, this.world, this.blocks, this.input, this.player)
    this.player.setBlockQuery((minX, minY, minZ, maxX, maxY, maxZ) =>
      this.blocks.blocksInAABB(minX, minY, minZ, maxX, maxY, maxZ)
    )
    this.build.onSelectionChanged = (slot) => hud.setSelectedSlot(slot)

    // Vegetatie en fauna leven mee met de chunks.
    const vegetation = new Vegetation(this.world, this.scene)
    this.chunks.onLoad((c) => vegetation.populate(c))
    this.addUpdater((dt) => vegetation.tick(dt))

    const animals = new Animals(this.world, this.scene)
    this.animals = animals
    this.chunks.onLoad((c) => animals.spawnForChunk(c))
    this.chunks.onUnload((c) => animals.despawnChunk(c))
    this.addUpdater((dt) => animals.update(dt, this.player.position))

    const birds = new Birds(this.world, this.scene)
    this.addUpdater((dt) => birds.update(dt, this.player.position))

    // Audio: volledig gesynthetiseerd, bussen gekoppeld aan de sliders.
    this.audio = new AudioEngine()
    this.ambient = new Ambient(this.audio)
    this.creatures = new Creatures(this.audio)
    this.music = new Music(this.audio)
    for (const bus of ['music', 'ambient', 'effects'] as const) {
      this.audio.setVolume(bus, hud.volume(bus))
    }
    this.addUpdater((dt) => this.updateAudio(dt))

    this.spawnPlayer()
    // Eerste ring chunks meteen bouwen zodat je niet in het luchtledige start.
    this.chunks.update(this.player.position.x, this.player.position.z, 250)
  }

  private animals: Animals
  private audio: AudioEngine
  private ambient: Ambient
  private creatures: Creatures
  private music: Music
  private wasSwimming = false

  /** Volumeslider uit het pauzemenu. */
  setVolume(bus: Bus, value: number): void {
    this.audio.setVolume(bus, value)
  }

  /** Audio mag pas starten na een gebruikersklik (autoplay-beleid). */
  resumeAudio(): void {
    this.audio.resume()
    this.ambient.start()
    this.music.start()
  }

  private updateAudio(dt: number): void {
    const pos = this.player.position
    const h = this.world.height(pos.x, pos.z)
    // Dicht bij zee (laag terrein) of zwemmend: watergeluid aan.
    const shore = this.player.swimming ? 1 : clamp(1 - (h - 0.5) / 6, 0, 1)
    const underwater = this.player.eyesUnderwater
    this.ambient.update(dt, shore, pos.y, underwater, this.sky.nightness)
    this.creatures.update(dt, this.sky.nightness, this.animals.countNear(pos.x, pos.z, 14), underwater)
    this.music.update(this.sky.nightness)

    if (this.player.swimming && !this.wasSwimming) this.ambient.splash()
    this.wasSwimming = this.player.swimming
  }

  /** Registreer een systeem dat elke frame een update wil (vegetatie, fauna, audio). */
  addUpdater(fn: (dt: number) => void): void {
    this.updaters.push(fn)
  }

  /** Zoek spiraalsgewijs een spawn op land, het liefst in het gras. */
  private spawnPlayer(): void {
    let best: { x: number; z: number } | null = null
    for (let r = 0; r < 40 && !best; r++) {
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2
        const x = Math.round(Math.cos(angle) * r * 12)
        const z = Math.round(Math.sin(angle) * r * 12)
        const h = this.world.height(x, z)
        if (h > 2.5 && h < 20 && this.world.normal(x, z).y > 0.85) {
          best = { x, z }
          break
        }
      }
    }
    const spot = best ?? { x: 0, z: 0 }
    this.player.spawn(spot.x, spot.z)
  }

  start(): void {
    this.lastTime = performance.now()
    const loop = (now: number): void => {
      requestAnimationFrame(loop)
      const dt = Math.min((now - this.lastTime) / 1000, 0.1)
      this.lastTime = now
      this.frame(dt)
    }
    requestAnimationFrame(loop)
  }

  private frame(dt: number): void {
    if (!this.paused) {
      // Kijken: één keer per frame met de hele muisdelta.
      const { dx, dy } = this.input.consumeMouseDelta()
      this.player.applyLook(dx, dy)

      // Physics met vaste stappen.
      this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * 5)
      while (this.accumulator >= FIXED_DT) {
        this.player.step(FIXED_DT)
        this.accumulator -= FIXED_DT
      }

      this.build.update()
      this.mesher.update()
      for (const fn of this.updaters) fn(dt)
    } else {
      // In pauze geen input laten ophopen.
      this.input.consumeMouseDelta()
      this.input.consumeClicks()
      this.input.consumePresses()
      this.input.consumeWheel()
    }

    const pos = this.player.position
    this.chunks.update(pos.x, pos.z, this.paused ? 12 : 6)
    this.water.update(this.paused ? 0 : dt, pos.x, pos.z)
    if (!this.paused) {
      this.sky.shadowsEnabled = this.graphics.shadowsEnabled
      this.player.getEyePosition(this.eye)
      this.sky.update(dt, this.eye)
    }

    // Mist en onderwater-beeld.
    const underwater = this.player.eyesUnderwater
    if (underwater) {
      this.fog.color.setRGB(0.08, 0.25, 0.38)
      this.fog.near = 1
      this.fog.far = 30
    } else {
      this.fog.color.copy(this.sky.fogColor)
      this.fog.near = FOG_NEAR
      this.fog.far = FOG_FAR
    }
    this.graphics.setUnderwater(underwater)
    this.hud.setUnderwater(underwater)
    this.scene.background = null

    // Camera volgt de speler.
    const cam = this.graphics.camera
    this.player.getEyePosition(cam.position)
    this.player.getLookDirection(this.look)
    cam.lookAt(cam.position.x + this.look.x, cam.position.y + this.look.y, cam.position.z + this.look.z)

    this.graphics.render()

    // Statistiek-HUD op 4 Hz.
    this.fpsSmooth += (1 / Math.max(dt, 1e-4) - this.fpsSmooth) * 0.05
    this.statsTimer += dt
    if (this.statsTimer > 0.25) {
      this.statsTimer = 0
      const biome = biomeName(this.world, pos.x, pos.z)
      const swim = this.player.swimming ? ' · zwemmen' : ''
      this.hud.setStats(
        `${Math.round(this.fpsSmooth)} fps · ${biome}${swim}\n` +
          `x ${pos.x.toFixed(0)}  y ${pos.y.toFixed(1)}  z ${pos.z.toFixed(0)} · ` +
          `${this.chunks.loadedCount} chunks · ${this.blocks.size} blokken`
      )
      this.hud.setClock(this.sky.clockText)
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  /** Hoogte van het wateroppervlak (voor audio e.d.). */
  get seaLevel(): number {
    return SEA_LEVEL
  }
}
