import * as THREE from 'three'
import { buildChunkGeometry, createTerrainMaterial } from './chunk'
import { CHUNK_SIZE, type World } from './terrain'

export const VIEW_DISTANCE = 10 // Chebyshev-radius in chunks (~640 m zicht)

export interface Chunk {
  cx: number
  cz: number
  key: string
  mesh: THREE.Mesh
  /** Objecten van andere systemen (vegetatie, fauna) die met de chunk meeleven. */
  attachments: THREE.Object3D[]
  disposables: { dispose: () => void }[]
}

export type ChunkHook = (chunk: Chunk) => void

/**
 * Laadt en lost terrein-chunks rond de speler, met een tijdbudget per frame
 * zodat het genereren nooit hapert. Vegetatie en fauna haken aan via
 * onLoad/onUnload.
 */
export class ChunkManager {
  private world: World
  private scene: THREE.Scene
  private material: THREE.MeshLambertMaterial
  private chunks = new Map<string, Chunk>()
  private queue: { cx: number; cz: number }[] = []
  private queued = new Set<string>()
  private onLoadHooks: ChunkHook[] = []
  private onUnloadHooks: ChunkHook[] = []

  constructor(world: World, scene: THREE.Scene) {
    this.world = world
    this.scene = scene
    this.material = createTerrainMaterial()
  }

  onLoad(hook: ChunkHook): void {
    this.onLoadHooks.push(hook)
  }

  onUnload(hook: ChunkHook): void {
    this.onUnloadHooks.push(hook)
  }

  get terrainMaterial(): THREE.MeshLambertMaterial {
    return this.material
  }

  /** Aantal geladen chunks (voor de statistiek-HUD). */
  get loadedCount(): number {
    return this.chunks.size
  }

  /** Alle geladen chunks (alleen-lezen gebruik). */
  forEach(fn: (chunk: Chunk) => void): void {
    this.chunks.forEach(fn)
  }

  update(playerX: number, playerZ: number, budgetMs = 6): void {
    const pcx = Math.floor(playerX / CHUNK_SIZE)
    const pcz = Math.floor(playerZ / CHUNK_SIZE)

    // Ontbrekende chunks in de queue zetten.
    for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
      for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
        const cx = pcx + dx
        const cz = pcz + dz
        const key = cx + ',' + cz
        if (!this.chunks.has(key) && !this.queued.has(key)) {
          this.queued.add(key)
          this.queue.push({ cx, cz })
        }
      }
    }

    // Dichtstbijzijnde eerst bouwen.
    if (this.queue.length > 1) {
      this.queue.sort((a, b) => {
        const da = Math.max(Math.abs(a.cx - pcx), Math.abs(a.cz - pcz))
        const db = Math.max(Math.abs(b.cx - pcx), Math.abs(b.cz - pcz))
        return da - db
      })
    }

    const start = performance.now()
    while (this.queue.length > 0 && performance.now() - start < budgetMs) {
      const { cx, cz } = this.queue.shift()!
      const key = cx + ',' + cz
      this.queued.delete(key)
      // Buiten bereik geraakt terwijl hij in de wachtrij stond? Overslaan.
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > VIEW_DISTANCE) continue
      if (this.chunks.has(key)) continue
      this.loadChunk(cx, cz, key)
    }

    // Chunks buiten radius+1 opruimen.
    const unloadRadius = VIEW_DISTANCE + 1
    for (const chunk of Array.from(this.chunks.values())) {
      if (Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) > unloadRadius) {
        this.unloadChunk(chunk)
      }
    }
  }

  private loadChunk(cx: number, cz: number, key: string): void {
    const geometry = buildChunkGeometry(this.world, cx, cz)
    const mesh = new THREE.Mesh(geometry, this.material)
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE)
    mesh.receiveShadow = true
    this.scene.add(mesh)

    const chunk: Chunk = { cx, cz, key, mesh, attachments: [], disposables: [] }
    this.chunks.set(key, chunk)
    for (const hook of this.onLoadHooks) hook(chunk)
  }

  private unloadChunk(chunk: Chunk): void {
    for (const hook of this.onUnloadHooks) hook(chunk)
    this.scene.remove(chunk.mesh)
    chunk.mesh.geometry.dispose()
    for (const obj of chunk.attachments) this.scene.remove(obj)
    for (const d of chunk.disposables) d.dispose()
    this.chunks.delete(chunk.key)
  }
}
