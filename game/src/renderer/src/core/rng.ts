// Deterministische random-helpers: alles in de wereld wordt afgeleid van de
// wereld-seed zodat dezelfde seed altijd dezelfde wereld oplevert.

/** FNV-1a 32-bit hash van een string naar een uint32. */
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Combineert een basis-seed met extra getallen tot een nieuwe uint32-seed. */
export function combineSeed(seed: number, ...parts: number[]): number {
  let h = seed >>> 0
  for (const p of parts) {
    h ^= (p | 0) + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Mulberry32 PRNG: snel, klein en prima verdeeld voor game-gebruik. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** PRNG voor een chunk (of ander gridpunt) met een tekst-salt, deterministisch. */
export function chunkRng(seed: number, cx: number, cz: number, salt: string): () => number {
  return mulberry32(combineSeed(seed, cx, cz, hashString(salt)))
}
