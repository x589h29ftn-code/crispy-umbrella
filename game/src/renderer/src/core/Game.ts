import * as THREE from 'three'
import { Ambient } from '../audio/ambient'
import { Creatures } from '../audio/creatures'
import { AudioEngine, type Bus } from '../audio/engine'
import { Music } from '../audio/music'
import { BlockMesher } from '../build/blockMesher'
import { BlockStore } from '../build/blockStore'
import { BuildSystem } from '../build/placement'
import { Animals } from '../fauna/animals'
import { Villagers } from '../fauna/villagers'
import { Birds } from '../fauna/birds'
import { Butterflies } from '../fauna/butterflies'
import { Fireflies } from '../fauna/fireflies'
import { PlayerController } from '../player/controller'
import { biomeName } from '../world/biomes'
import { riverTime } from '../world/chunk'
import { ChunkManager } from '../world/chunkManager'
import { clamp } from '../world/noise'
import { Sky } from '../world/sky'
import { SEA_LEVEL, World } from '../world/terrain'
import { autumness, seasonName, winterness } from '../world/season'
import { seasonAutumn, seasonWinter } from '../world/season'
import { Structures } from '../world/structures'
import { Weather } from '../world/weather'
import { Boats } from '../world/boat'
import { Fishing } from '../world/fishing'
import { Vegetation } from '../world/vegetation'
import { Water } from '../world/water'
import type { Hud } from '../ui/hud'
import { Graphics } from './graphics'
import { Input } from './input'

const FIXED_DT = 1 / 120
// Sfeervolle exponentiële mist (referentiestijl): dichtbij al zachtjes
// aanwezig tussen de bomen, veraf lost het landschap erin op.
const FOG_DENSITY = 0.0021
const FOG_DENSITY_UNDERWATER = 0.09

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
  private fog: THREE.FogExp2
  private vegetation: Vegetation
  /** Extra systemen (vegetatie-tijd, fauna, audio) haken hier in. */
  private updaters: ((dt: number) => void)[] = []

  constructor(seed: string, container: HTMLElement, hud: Hud) {
    this.hud = hud
    this.world = new World(seed)
    this.scene = new THREE.Scene()
    this.fog = new THREE.FogExp2(0xd8ecf4, FOG_DENSITY)
    this.scene.fog = this.fog

    this.graphics = new Graphics(container, this.scene)
    this.input = new Input()
    this.input.attach(this.graphics.renderer.domElement)

    this.player = new PlayerController(this.world, this.input)
    this.chunks = new ChunkManager(this.world, this.scene)
    this.water = new Water(this.world)
    this.scene.add(this.water.mesh)
    this.sky = new Sky(this.scene)
    this.sky.dome.scale.setScalar(1300)

    this.blocks = new BlockStore()
    this.mesher = new BlockMesher(this.scene, this.blocks)
    this.build = new BuildSystem(this.scene, this.world, this.blocks, this.input, this.player)
    this.player.setBlockQuery((minX, minY, minZ, maxX, maxY, maxZ) =>
      this.blocks.blocksInAABB(minX, minY, minZ, maxX, maxY, maxZ)
    )
    this.build.onSelectionChanged = (slot) => hud.setSelectedSlot(slot)

    // Hutjes en het meerhuisje-tafereel; hun muren en vloeren botsen mee
    // met de geplaatste bouwblokken.
    const structures = new Structures(this.world, this.scene)
    this.structures = structures
    this.player.setBlockQuery((minX, minY, minZ, maxX, maxY, maxZ) => {
      const blocks = this.blocks.blocksInAABB(minX, minY, minZ, maxX, maxY, maxZ)
      const walls = structures.collidersInAABB(minX, minY, minZ, maxX, maxY, maxZ)
      return walls.length > 0 ? blocks.concat(walls) : blocks
    })

    // Vegetatie en fauna leven mee met de chunks.
    const vegetation = new Vegetation(this.world, this.scene)
    this.vegetation = vegetation
    vegetation.setClearingProvider((cx, cz) => structures.clearingsNear(cx, cz))
    this.chunks.onLoad((c) => vegetation.populate(c))
    this.chunks.onLoad((c) => structures.populate(c))
    this.addUpdater((dt) => vegetation.tick(dt))
    this.addUpdater((dt) => {
      riverTime.value += dt
    })

    const animals = new Animals(this.world, this.scene)
    this.animals = animals
    this.chunks.onLoad((c) => animals.spawnForChunk(c))
    this.chunks.onUnload((c) => animals.despawnChunk(c))
    this.addUpdater((dt) => animals.update(dt, this.player.position))

    const birds = new Birds(this.world, this.scene)
    this.addUpdater((dt) => birds.update(dt, this.player.position))

    const butterflies = new Butterflies(this.world, this.scene)
    this.addUpdater((dt) => butterflies.update(dt, this.player.position, this.sky.nightness))

    const fireflies = new Fireflies(this.world, this.scene)
    this.addUpdater((dt) => fireflies.update(dt, this.player.position, this.sky.nightness))

    // Niet door boomstammen heen kunnen lopen.
    this.player.setTreeQuery((x, z) => vegetation.collidersNear(x, z))

    // Audio: volledig gesynthetiseerd, bussen gekoppeld aan de sliders.
    this.audio = new AudioEngine()
    this.ambient = new Ambient(this.audio)
    this.creatures = new Creatures(this.audio)
    this.music = new Music(this.audio)
    for (const bus of ['music', 'ambient', 'effects'] as const) {
      this.audio.setVolume(bus, hud.volume(bus))
    }
    this.addUpdater((dt) => this.updateAudio(dt))

    // Weer: wolken, regen, sneeuw en onweer.
    this.weather = new Weather(this.world.seed, this.scene)
    this.weather.onThunder = () => this.ambient.thunder()
    this.addUpdater((dt) => {
      this.weather.update(dt, this.player.position, this.sky.seasonT, this.player.position.y)
      this.sky.cloudiness = this.weather.cloudiness
      seasonAutumn.value = autumness(this.sky.seasonT)
      seasonWinter.value = winterness(this.sky.seasonT)
      this.graphics.setExposure(1.15 + this.weather.flash * 1.6)
    })

    // Dorpelingen leven mee met de dorps-chunks.
    const villagers = new Villagers(this.world, this.scene)
    this.chunks.onLoad((c) => villagers.spawnForChunk(c, structures.villageSpotFor(c.cx, c.cz)))
    this.chunks.onUnload((c) => villagers.despawnChunk(c))
    this.addUpdater((dt) => villagers.update(dt, this.player.position))

    // Kano's en vissen.
    this.boats = new Boats(this.world, this.scene, structures.canoeMoorings())
    this.boats.bind(this.input)
    this.boats.onSplash = () => this.ambient.splash()
    this.fishing = new Fishing(this.world, this.scene)
    this.fishing.onToast = (msg) => hud.toast(msg)
    this.fishing.onPlink = () => this.ambient.plink()
    this.fishing.onSplash = () => this.ambient.splash()
    this.build.onRodClick = (button) => {
      if (button === 0) {
        this.player.getEyePosition(this.eye)
        this.player.getLookDirection(this.look)
        this.fishing.click(this.eye, this.look)
      } else {
        this.fishing.reset()
      }
    }

    this.spawnPlayer()
    // De omgeving rond de spawn meteen bouwen zodat je niet in het luchtledige start.
    this.chunks.update(this.player.position.x, this.player.position.z, 1000)
  }

  private boats!: Boats
  private fishing!: Fishing
  /** Fotomodus: vrije camera, HUD verborgen, speler bevroren. */
  photoMode = false
  private photoPos = new THREE.Vector3()
  private photoRight = new THREE.Vector3()

  private animals: Animals
  private structures: Structures
  private weather!: Weather
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
    // Beekgeluid: masker op de spelerplek plus een paar meter eromheen.
    const river = Math.max(
      this.world.river(pos.x, pos.z, h),
      this.world.river(pos.x + 4, pos.z),
      this.world.river(pos.x, pos.z + 4)
    )
    this.ambient.update(dt, shore, pos.y, underwater, this.sky.nightness, river, this.weather.intensity)
    this.creatures.update(dt, this.sky.nightness, this.animals.countNear(pos.x, pos.z, 14), underwater)
    this.music.update(this.sky.nightness)

    if (this.player.swimming && !this.wasSwimming) this.ambient.splash()
    this.wasSwimming = this.player.swimming
  }

  /** Registreer een systeem dat elke frame een update wil (vegetatie, fauna, audio). */
  addUpdater(fn: (dt: number) => void): void {
    this.updaters.push(fn)
  }

  /** Spawn bij het meerhuisje als dat bestaat, anders op een grazige plek. */
  private spawnPlayer(): void {
    const lakeSpawn = this.structures.lakeSpawnPoint()
    if (lakeSpawn) {
      this.player.spawn(lakeSpawn.x, lakeSpawn.z)
      this.player.yaw = Math.atan2(-(lakeSpawn.lookX - lakeSpawn.x), -(lakeSpawn.lookZ - lakeSpawn.z))
      return
    }
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

      // Toetsaanslagen één keer lezen en doorgeven.
      const presses = this.input.consumePresses()
      if (presses.includes('KeyP') && this.input.locked) this.togglePhotoMode()

      if (this.photoMode) {
        this.updatePhotoCamera(dt)
        this.input.consumeClicks()
        this.input.consumeWheel()
        this.boats.update(dt, this.player.yaw)
      } else if (this.boats.active) {
        if (presses.includes('KeyE')) {
          const spot = this.boats.exit()
          if (spot) this.player.spawn(spot.x, spot.z)
          this.hud.toast('Je stapt uit de kano.')
        }
        const anchor = this.boats.update(dt, this.player.yaw)
        if (anchor) {
          this.player.position.set(anchor.x, anchor.y + 0.3, anchor.z)
          this.player.velocity.set(0, 0, 0)
        }
        this.input.consumeClicks()
        this.input.consumeWheel()
      } else {
        if (presses.includes('KeyE')) {
          const canoe = this.boats.nearest(this.player.position.x, this.player.position.z, 3.5)
          if (canoe) {
            this.boats.enter(canoe)
            this.fishing.reset()
            this.hud.toast('Peddel met WASD · E = uitstappen')
          }
        }
        // Physics met vaste stappen.
        this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * 5)
        while (this.accumulator >= FIXED_DT) {
          this.player.step(FIXED_DT)
          this.accumulator -= FIXED_DT
        }
        this.boats.update(dt, this.player.yaw)
        this.build.update(presses)
        this.mesher.update()
      }

      this.player.getEyePosition(this.eye)
      this.fishing.update(dt, this.eye)
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

    // Detailring van het dichte gras volgt de speler en de kwaliteitsstand.
    this.vegetation.detailRadius =
      this.graphics.quality === 'high' ? 4 : this.graphics.quality === 'medium' ? 3 : 2
    this.vegetation.updateDetail(pos.x, pos.z)

    // Mist en onderwater-beeld.
    const underwater = this.player.eyesUnderwater
    if (underwater) {
      this.fog.color.setRGB(0.08, 0.25, 0.38)
      this.fog.density = FOG_DENSITY_UNDERWATER
    } else {
      this.fog.color.copy(this.sky.fogColor)
      this.fog.density = FOG_DENSITY * (1 + this.weather.cloudiness * 0.8 + this.weather.intensity * 1.6)
    }
    this.graphics.setUnderwater(underwater)
    this.hud.setUnderwater(underwater)
    this.scene.background = null

    // Camera volgt de speler (of de vrije fotocamera).
    const cam = this.graphics.camera
    if (this.photoMode) cam.position.copy(this.photoPos)
    else this.player.getEyePosition(cam.position)
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
      this.hud.setClock(`${seasonName(this.sky.seasonT)} · ${this.sky.clockText}`)
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  private togglePhotoMode(): void {
    this.photoMode = !this.photoMode
    this.hud.setPhotoMode(this.photoMode)
    if (this.photoMode) {
      this.player.getEyePosition(this.photoPos)
      this.hud.toast('')
    }
  }

  /** Vrije camera in fotomodus: WASD + Q/E, Shift = snel. */
  private updatePhotoCamera(dt: number): void {
    this.player.getLookDirection(this.look)
    const speed = (this.input.isDown('ShiftLeft') ? 26 : 9) * dt
    this.photoRight.set(-this.look.z, 0, this.look.x).normalize()
    if (this.input.isDown('KeyW')) this.photoPos.addScaledVector(this.look, speed)
    if (this.input.isDown('KeyS')) this.photoPos.addScaledVector(this.look, -speed)
    if (this.input.isDown('KeyD')) this.photoPos.addScaledVector(this.photoRight, speed)
    if (this.input.isDown('KeyA')) this.photoPos.addScaledVector(this.photoRight, -speed)
    if (this.input.isDown('KeyE')) this.photoPos.y += speed
    if (this.input.isDown('KeyQ')) this.photoPos.y -= speed
  }

  /** Hoogte van het wateroppervlak (voor audio e.d.). */
  get seaLevel(): number {
    return SEA_LEVEL
  }
}
