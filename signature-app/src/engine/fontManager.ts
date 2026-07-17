import opentype from 'opentype.js'
import { FONT_FILES } from '../data/fonts'
import type { SignatureStyle } from '../types'
import { ensureStrokeFont, strokeFontLoaded } from './stroke'

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

/** Laadt de assets die een stijl nodig heeft: een TTF (font-engine) of de
 *  Hershey-penlijndata (stroke-engine). */
export function ensureStyleAssets(style: SignatureStyle): Promise<unknown> {
  return style.engine === 'stroke' ? ensureStrokeFont() : ensureFont(style.fontId)
}

export function styleAssetsReady(style: SignatureStyle): boolean {
  return style.engine === 'stroke' ? strokeFontLoaded() : !!getLoadedFont(style.fontId)
}
