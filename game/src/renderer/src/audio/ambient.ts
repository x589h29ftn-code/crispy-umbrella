import type { AudioEngine } from './engine'

/**
 * Doorlopende omgevingsgeluiden: kabbelend water bij de kust, wind die met
 * de hoogte meeademt, gedempt gerommel onder water en krekels in de nacht.
 */
export class Ambient {
  private engine: AudioEngine
  private waterGain: GainNode
  private waterFilter: BiquadFilterNode
  private windGain: GainNode
  private windFilter: BiquadFilterNode
  private rumbleGain: GainNode
  private cricketGain: GainNode
  private started = false

  constructor(engine: AudioEngine) {
    this.engine = engine
    const ctx = engine.ctx
    const bus = engine.bus('ambient')

    // Water: laagdoorlaat-ruis met langzame golfmodulatie.
    this.waterFilter = ctx.createBiquadFilter()
    this.waterFilter.type = 'lowpass'
    this.waterFilter.frequency.value = 650
    this.waterGain = ctx.createGain()
    this.waterGain.gain.value = 0
    this.waterFilter.connect(this.waterGain).connect(bus)

    // Wind: bandpass-ruis, ademend via een LFO.
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'bandpass'
    this.windFilter.frequency.value = 480
    this.windFilter.Q.value = 0.6
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    this.windFilter.connect(this.windGain).connect(bus)

    // Onderwater-gerommel: zwaar gefilterde ruis.
    const rumbleFilter = ctx.createBiquadFilter()
    rumbleFilter.type = 'lowpass'
    rumbleFilter.frequency.value = 160
    this.rumbleGain = ctx.createGain()
    this.rumbleGain.gain.value = 0
    rumbleFilter.connect(this.rumbleGain).connect(bus)

    // Krekels: hoge triller, 's nachts hoorbaar.
    const cricketOsc = ctx.createOscillator()
    cricketOsc.type = 'triangle'
    cricketOsc.frequency.value = 4300
    const chirpLfo = ctx.createOscillator()
    chirpLfo.type = 'square'
    chirpLfo.frequency.value = 21
    const chirpDepth = ctx.createGain()
    chirpDepth.gain.value = 1
    const chirpGate = ctx.createGain()
    chirpGate.gain.value = 0
    chirpLfo.connect(chirpDepth).connect(chirpGate.gain)
    this.cricketGain = ctx.createGain()
    this.cricketGain.gain.value = 0
    cricketOsc.connect(chirpGate).connect(this.cricketGain).connect(bus)
    cricketOsc.start()
    chirpLfo.start()

    // Ruisbronnen delen dezelfde loopbuffer.
    for (const dest of [this.waterFilter, this.windFilter, rumbleFilter]) {
      const src = engine.createNoiseSource()
      src.connect(dest)
      src.start()
    }
  }

  start(): void {
    this.started = true
  }

  private windPhase = 0

  /**
   * @param shoreCloseness 0..1 — hoe dicht bij het water (1 = op het strand)
   * @param altitude hoogte van de speler
   * @param underwater ogen onder water
   * @param nightness 0..1 nacht
   */
  update(
    dt: number,
    shoreCloseness: number,
    altitude: number,
    underwater: boolean,
    nightness: number
  ): void {
    if (!this.started) return
    const t = this.engine.ctx.currentTime
    this.windPhase += dt * 0.35

    const breathe = 0.6 + 0.4 * Math.sin(this.windPhase) * Math.sin(this.windPhase * 0.37 + 1.3)
    const windStrength = (0.14 + Math.min(Math.max(altitude / 60, 0), 1) * 0.2) * breathe
    this.windGain.gain.setTargetAtTime(underwater ? 0 : windStrength, t, 0.4)
    this.windFilter.frequency.setTargetAtTime(380 + breathe * 260, t, 0.4)

    const waves = 0.75 + 0.25 * Math.sin(this.windPhase * 2.3 + 0.7)
    this.waterGain.gain.setTargetAtTime(underwater ? 0 : shoreCloseness * 0.5 * waves, t, 0.3)
    this.waterFilter.frequency.setTargetAtTime(500 + waves * 300, t, 0.3)

    this.rumbleGain.gain.setTargetAtTime(underwater ? 0.5 : 0, t, 0.15)
    this.cricketGain.gain.setTargetAtTime(underwater ? 0 : nightness * 0.06, t, 0.8)
  }

  /** Plons bij het duiken: korte ruisuitbarsting met dalende filtersweep. */
  splash(): void {
    const ctx = this.engine.ctx
    const src = this.engine.createNoiseSource()
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.8
    const gain = ctx.createGain()
    const t = ctx.currentTime
    filter.frequency.setValueAtTime(1800, t)
    filter.frequency.exponentialRampToValueAtTime(320, t + 0.5)
    gain.gain.setValueAtTime(0.55, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
    src.connect(filter).connect(gain).connect(this.engine.bus('effects'))
    src.start(t)
    src.stop(t + 0.7)
  }
}
