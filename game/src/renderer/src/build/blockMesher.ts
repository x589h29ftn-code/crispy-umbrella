import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { BLOCK_TYPES } from './blockTypes'
import type { BlockStore } from './blockStore'

// Basisgeometrie voor één blok, met kleur-attribuut dat per blok wordt gevuld.
const unitBox = new THREE.BoxGeometry(1, 1, 1)
unitBox.translate(0.5, 0.5, 0.5)

const opaqueMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
const glassMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  transparent: true,
  opacity: 0.45,
  depthWrite: false
})

function regionKey(rx: number, ry: number, rz: number): string {
  return rx + '|' + ry + '|' + rz
}

/**
 * Zet de blok-opslag om in zichtbare meshes. Blokken worden per 16³-regio
 * samengevoegd tot één ondoorzichtige en één glazen mesh, en alleen regio's
 * die veranderd zijn worden aan het eind van de frame opnieuw gebouwd.
 */
export class BlockMesher {
  private scene: THREE.Scene
  private store: BlockStore
  private regionMeshes = new Map<string, THREE.Mesh[]>()
  private dirty = new Set<string>()

  constructor(scene: THREE.Scene, store: BlockStore) {
    this.scene = scene
    this.store = store
    store.onChange((gx, gy, gz) => {
      this.dirty.add(regionKey(gx >> 4, gy >> 4, gz >> 4))
    })
  }

  /** Herbouwt gewijzigde regio's; één keer per frame aanroepen. */
  update(): void {
    if (this.dirty.size === 0) return
    for (const key of this.dirty) {
      const [rx, ry, rz] = key.split('|').map(Number)
      this.rebuildRegion(rx, ry, rz, key)
    }
    this.dirty.clear()
  }

  private rebuildRegion(rx: number, ry: number, rz: number, key: string): void {
    // Oude meshes weg.
    const old = this.regionMeshes.get(key)
    if (old) {
      for (const mesh of old) {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
      }
      this.regionMeshes.delete(key)
    }

    const opaque: THREE.BufferGeometry[] = []
    const glass: THREE.BufferGeometry[] = []
    const color = new THREE.Color()

    this.store.forEachInRegion(rx, ry, rz, (gx, gy, gz, type) => {
      const def = BLOCK_TYPES[type]
      const geo = unitBox.clone()
      geo.translate(gx, gy, gz)
      color.set(def.color)
      const count = geo.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r
        colors[i * 3 + 1] = color.g
        colors[i * 3 + 2] = color.b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      if (def.transparent) glass.push(geo)
      else opaque.push(geo)
    })

    const meshes: THREE.Mesh[] = []
    if (opaque.length > 0) {
      const mesh = new THREE.Mesh(mergeGeometries(opaque), opaqueMaterial)
      mesh.castShadow = true
      mesh.receiveShadow = true
      meshes.push(mesh)
      for (const g of opaque) g.dispose()
    }
    if (glass.length > 0) {
      const mesh = new THREE.Mesh(mergeGeometries(glass), glassMaterial)
      meshes.push(mesh)
      for (const g of glass) g.dispose()
    }
    for (const mesh of meshes) this.scene.add(mesh)
    if (meshes.length > 0) this.regionMeshes.set(key, meshes)
  }
}
