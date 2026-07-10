import { mulberry32 } from '../core/rng'
import type { AudioEngine } from './engine'

/**
 * Dierengeluiden: synthetische vogelzang overdag (FM-chirps met willekeurige
 * toonpatronen, links/rechts gepand) en zacht geritsel/gesnuffel wanneer een
 * dier dichtbij is.
 */
export class Creatures {
  private engine: AudioEngine
  private rng = mulberry32(0xbeef)
  private nextChirp = 1.5
  private nextRustle = 4
  private time = 0

  constructor(engine: AudioEngine) {
    this.engine = engine
  }

  /**
   * @param nightness 0..1 — 's nachts zingen de vogels (bijna) niet
   * @param animalsNearby aantal dieren binnen ~12 m van de speler
   */
  update(dt: number, nightness: number, animalsNearby: number, underwater: boolean): void {
    this.time += dt
    if (underwater) return

    if (this.time >= this.nextChirp) {
      // Interval korter overdag, veel langer in de nacht.
      const dayFactor = 1 - nightness
      this.nextChirp = this.time + 1.2 + this.rng() * (2.5 + nightness * 18)
      if (this.rng() < 0.15 + dayFactor * 0.8) this.birdChirp()
    }

    if (animalsNearby > 0 && this.time >= this.nextRustle) {
      this.nextRustle = this.time + 3 + this.rng() * 6
      if (this.rng() < 0.7) this.rustle()
    }
  }

  /** Eén vogelzin: 2–5 snelle FM-nootjes met glijdende toonhoogte. */
  private birdChirp(): void {
    const ctx = this.engine.ctx
    const t0 = ctx.currentTime + 0.05
    const pan = ctx.createStereoPanner()
    pan.pan.value = this.rng() * 1.6 - 0.8
    const master = ctx.createGain()
    master.gain.value = 0.16 + this.rng() * 0.1
    master.connect(pan).connect(this.engine.bus('effects'))

    const notes = 2 + Math.floor(this.rng() * 4)
    const base = 2100 + this.rng() * 1600
    let t = t0
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      // Vibrato/FM voor het "trillertje".
      const mod = ctx.createOscillator()
      mod.frequency.value = 35 + this.rng() * 40
      const modDepth = ctx.createGain()
      modDepth.gain.value = 120 + this.rng() * 250
      mod.connect(modDepth).connect(osc.frequency)

      const f = base * (0.85 + this.rng() * 0.45)
      const dur = 0.06 + this.rng() * 0.12
      osc.frequency.setValueAtTime(f, t)
      osc.frequency.exponentialRampToValueAtTime(f * (this.rng() < 0.5 ? 1.35 : 0.75), t + dur)

      const env = ctx.createGain()
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(1, t + 0.015)
      env.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.connect(env).connect(master)
      osc.start(t)
      osc.stop(t + dur + 0.05)
      mod.start(t)
      mod.stop(t + dur + 0.05)
      t += dur + 0.03 + this.rng() * 0.08
    }
  }

  /** Zacht geritsel van een dier in de buurt. */
  private rustle(): void {
    const ctx = this.engine.ctx
    const src = this.engine.createNoiseSource()
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 900 + this.rng() * 900
    filter.Q.value = 1.2
    const gain = ctx.createGain()
    const pan = ctx.createStereoPanner()
    pan.pan.value = this.rng() * 1.4 - 0.7
    const t = ctx.currentTime
    const dur = 0.12 + this.rng() * 0.2
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.08, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(filter).connect(gain).connect(pan).connect(this.engine.bus('effects'))
    src.start(t)
    src.stop(t + dur + 0.05)
  }
}
