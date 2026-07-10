import type { BlockAabb } from '../player/controller'

export type BlockChangeListener = (gx: number, gy: number, gz: number) => void

function key(gx: number, gy: number, gz: number): string {
  return gx + '|' + gy + '|' + gz
}

/**
 * Sparse opslag van geplaatste blokken op een 1m-grid (wereld-assen).
 * Waarde is de index in BLOCK_TYPES. toJSON/fromJSON staan klaar voor een
 * toekomstige opslaan/laden-functie.
 */
export class BlockStore {
  private map = new Map<string, number>()
  private listeners: BlockChangeListener[] = []

  onChange(listener: BlockChangeListener): void {
    this.listeners.push(listener)
  }

  get size(): number {
    return this.map.size
  }

  get(gx: number, gy: number, gz: number): number | undefined {
    return this.map.get(key(gx, gy, gz))
  }

  set(gx: number, gy: number, gz: number, type: number): void {
    this.map.set(key(gx, gy, gz), type)
    for (const l of this.listeners) l(gx, gy, gz)
  }

  remove(gx: number, gy: number, gz: number): boolean {
    const removed = this.map.delete(key(gx, gy, gz))
    if (removed) for (const l of this.listeners) l(gx, gy, gz)
    return removed
  }

  /** Alle blokken die een AABB (wereldruimte) raken, voor spelerbotsing. */
  blocksInAABB(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number
  ): BlockAabb[] {
    const result: BlockAabb[] = []
    if (this.map.size === 0) return result
    const x0 = Math.floor(minX)
    const y0 = Math.floor(minY)
    const z0 = Math.floor(minZ)
    const x1 = Math.floor(maxX)
    const y1 = Math.floor(maxY)
    const z1 = Math.floor(maxZ)
    for (let gy = y0; gy <= y1; gy++) {
      for (let gz = z0; gz <= z1; gz++) {
        for (let gx = x0; gx <= x1; gx++) {
          if (this.map.has(key(gx, gy, gz))) {
            result.push({
              minX: gx,
              minY: gy,
              minZ: gz,
              maxX: gx + 1,
              maxY: gy + 1,
              maxZ: gz + 1
            })
          }
        }
      }
    }
    return result
  }

  /** Itereer over alle blokken in een 16³-regio. */
  forEachInRegion(rx: number, ry: number, rz: number, fn: (gx: number, gy: number, gz: number, type: number) => void): void {
    // Bij huisformaat-aantallen is over de hele map lopen prima.
    for (const [k, type] of this.map) {
      const [gx, gy, gz] = k.split('|').map(Number)
      if (gx >> 4 === rx && gy >> 4 === ry && gz >> 4 === rz) fn(gx, gy, gz, type)
    }
  }

  toJSON(): [string, number][] {
    return Array.from(this.map.entries())
  }

  fromJSON(data: [string, number][]): void {
    this.map = new Map(data)
  }
}
