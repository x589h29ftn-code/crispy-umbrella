import opentype from 'opentype.js'
import { FONT_FILES } from '../data/fonts'

const cache = new Map<string, Promise<opentype.Font>>()

/** Laadt en parset een font éénmalig; parallelle aanvragen delen dezelfde Promise. */
export function loadFont(fontId: string): Promise<opentype.Font> {
  let promise = cache.get(fontId)
  if (!promise) {
    const file = FONT_FILES[fontId]
    if (!file) return Promise.reject(new Error(`Onbekend font: ${fontId}`))
    promise = fetch(`${import.meta.env.BASE_URL}fonts/${file}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Font ${file} kon niet worden geladen (${res.status})`)
        return res.arrayBuffer()
      })
      .then((buf) => opentype.parse(buf))
    promise.catch(() => cache.delete(fontId))
    cache.set(fontId, promise)
  }
  return promise
}

export function loadFonts(fontIds: string[]): Promise<opentype.Font[]> {
  return Promise.all(fontIds.map(loadFont))
}

/** Synchrone toegang voor de compose-stap; alleen geldig ná ensureFont. */
const resolved = new Map<string, opentype.Font>()

export async function ensureFont(fontId: string): Promise<opentype.Font> {
  const font = await loadFont(fontId)
  resolved.set(fontId, font)
  return font
}

export function getLoadedFont(fontId: string): opentype.Font | undefined {
  return resolved.get(fontId)
}
