import { mulberry32 } from '../core/rng'
import type { AudioEngine } from './engine'

// Pentatonische majeurladder: klinkt altijd consonant en rustgevend.
const SCALE = [0, 2, 4, 7, 9]
const BASE_FREQ = 110 // A2

function noteFreq(degree: number, octave: number): number {
  const scaleIndex = ((degree % SCALE.length) + SCALE.length) % SCALE.length
  const extraOct = Math.floor(degree / SCALE.length)
  const semitones = SCALE[scaleIndex] + (octave + extraOct) * 12
  return BASE_FREQ * Math.pow(2, semitones / 12)
}

/**
 * Generatieve ambient muziek: langzame pad-akkoorden uit detuned oscillators
 * met een galmende feedback-delay, en daarboven een zachte kalimba-achtige
 * melodie. Akkoorden verspringen via een random walk; 's nachts zakt alles
 * naar een donkerder register.
 */
export class Music {
  private engine: AudioEngine
  private rng = mulberry32(0xcafe)
  private delay: DelayNode
  private padOut: GainNode
  private pluckOut: GainNode
  private chordRoot = 0
  private nextChordTime = 0
  private nextPluckTime = 2
  private padVoices: { osc: OscillatorNode; gain: GainNode }[] = []
  private nightness = 0
  private started = false

  constructor(engine: AudioEngine) {
    this.engine = engine
    const ctx = engine.ctx
    const bus = engine.bus('music')

    // Ruimtelijke feedback-delay als "galm".
    this.delay = ctx.createDelay(2)
    this.delay.delayTime.value = 0.48
    const feedback = ctx.createGain()
    feedback.gain.value = 0.38
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 1800
    this.delay.connect(damp).connect(feedback).connect(this.delay)
    this.delay.connect(bus)

    this.padOut = ctx.createGain()
    this.padOut.gain.value = 0.5
    this.padOut.connect(bus)
    this.padOut.connect(this.delay)

    this.pluckOut = ctx.createGain()
    this.pluckOut.gain.value = 0.5
    this.pluckOut.connect(bus)
    this.pluckOut.connect(this.delay)
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.nextChordTime = this.engine.ctx.currentTime + 0.5
    this.nextPluckTime = this.engine.ctx.currentTime + 3
  }

  update(nightness: number): void {
    if (!this.started) return
    this.nightness = nightness
    const now = this.engine.ctx.currentTime
    if (now >= this.nextChordTime) {
      this.playChord()
      this.nextChordTime = now + 11 + this.rng() * 7
    }
    if (now >= this.nextPluckTime) {
      if (this.rng() < 0.8) this.pluck()
      this.nextPluckTime = now + 1.6 + this.rng() * 3.4
    }
  }

  /** Nieuw pad-akkoord: oude stemmen uitfaden, nieuwe langzaam opbouwen. */
  private playChord(): void {
    const ctx = this.engine.ctx
    const t = ctx.currentTime

    for (const v of this.padVoices) {
      v.gain.gain.setTargetAtTime(0, t, 2.5)
      v.osc.stop(t + 12)
    }
    this.padVoices = []

    // Random walk over de ladder.
    const steps = [-2, -1, 1, 2]
    this.chordRoot += steps[Math.floor(this.rng() * steps.length)]
    if (this.chordRoot > 4) this.chordRoot -= 5
    if (this.chordRoot < -4) this.chordRoot += 5

    // Drieklank binnen de pentatoniek + een octaaf erboven.
    const octave = this.nightness > 0.5 ? 0 : 1
    const degrees = [this.chordRoot, this.chordRoot + 2, this.chordRoot + 4, this.chordRoot + 5]
    for (const degree of degrees) {
      const freq = noteFreq(degree, octave)
      // Twee licht detunede oscillators per toon voor een brede pad-klank.
      for (const detune of [-4, 4]) {
        const osc = ctx.createOscillator()
        osc.type = this.rng() < 0.5 ? 'sine' : 'triangle'
        osc.frequency.value = freq
        osc.detune.value = detune + (this.rng() - 0.5) * 3
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, t)
        gain.gain.setTargetAtTime(0.028, t, 3.5)
        osc.connect(gain).connect(this.padOut)
        osc.start(t)
        this.padVoices.push({ osc, gain })
      }
    }
  }

  /** Kalimba-achtige pluk: sinus met snelle exponentiële demping. */
  private pluck(): void {
    const ctx = this.engine.ctx
    const t = ctx.currentTime
    const degree = this.chordRoot + Math.floor(this.rng() * 8)
    const freq = noteFreq(degree, this.nightness > 0.5 ? 1 : 2)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const partial = ctx.createOscillator()
    partial.type = 'sine'
    partial.frequency.value = freq * 2.01
    const partialGain = ctx.createGain()
    partialGain.gain.value = 0.25

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.14, t + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0005, t + 2.2)

    osc.connect(env)
    partial.connect(partialGain).connect(env)
    env.connect(this.pluckOut)
    osc.start(t)
    osc.stop(t + 2.4)
    partial.start(t)
    partial.stop(t + 2.4)
  }
}
