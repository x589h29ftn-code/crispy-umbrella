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
  private babbleFilter: BiquadFilterNode
  private babbleGain: GainNode
  private rainFilter: BiquadFilterNode
  private rainGain: GainNode
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

    // Beekje: helder klaterende, hoger gefilterde ruis.
    this.babbleFilter = ctx.createBiquadFilter()
    this.babbleFilter.type = 'bandpass'
    this.babbleFilter.frequency.value = 1500
    this.babbleFilter.Q.value = 0.9
    this.babbleGain = ctx.createGain()
    this.babbleGain.gain.value = 0
    this.babbleFilter.connect(this.babbleGain).connect(bus)

    // Regen: brede ruis, gedempt.
    this.rainFilter = ctx.createBiquadFilter()
    this.rainFilter.type = 'lowpass'
    this.rainFilter.frequency.value = 2600
    this.rainGain = ctx.createGain()
    this.rainGain.gain.value = 0
    this.rainFilter.connect(this.rainGain).connect(bus)

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
    for (const dest of [this.waterFilter, this.windFilter, rumbleFilter, this.babbleFilter, this.rainFilter]) {
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
    nightness: number,
    riverCloseness = 0,
    rainIntensity = 0
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
    const babble = 0.85 + 0.15 * Math.sin(this.windPhase * 3.1)
    this.babbleGain.gain.setTargetAtTime(underwater ? 0 : riverCloseness * 0.4 * babble, t, 0.3)
    this.babbleFilter.frequency.setTargetAtTime(1300 + babble * 500, t, 0.3)
    this.rainGain.gain.setTargetAtTime(underwater ? 0 : rainIntensity * 0.35, t, 0.8)
    this.cricketGain.gain.setTargetAtTime(underwater ? 0 : nightness * 0.06, t, 0.8)
  }

  /** Kort plinkje: de dobber gaat onder. */
  plink(): void {
    const ctx = this.engine.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1350, t)
    osc.frequency.exponentialRampToValueAtTime(650, t + 0.12)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.35, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc.connect(gain).connect(this.engine.bus('effects'))
    osc.start(t)
    osc.stop(t + 0.25)
  }

  /** Donderklap: lage dreun met een ruisstaart. */
  thunder(): void {
    const ctx = this.engine.ctx
    const t = ctx.currentTime
    const boom = ctx.createOscillator()
    boom.type = 'sine'
    boom.frequency.setValueAtTime(60, t)
    boom.frequency.exponentialRampToValueAtTime(34, t + 1.2)
    const boomGain = ctx.createGain()
    boomGain.gain.setValueAtTime(0.7, t)
    boomGain.gain.exponentialRampToValueAtTime(0.001, t + 1.6)
    boom.connect(boomGain).connect(this.engine.bus('effects'))
    boom.start(t)
    boom.stop(t + 1.8)

    const tail = this.engine.createNoiseSource()
    const tailFilter = ctx.createBiquadFilter()
    tailFilter.type = 'lowpass'
    tailFilter.frequency.setValueAtTime(900, t)
    tailFilter.frequency.exponentialRampToValueAtTime(120, t + 2.4)
    const tailGain = ctx.createGain()
    tailGain.gain.setValueAtTime(0.4, t)
    tailGain.gain.exponentialRampToValueAtTime(0.001, t + 2.6)
    tail.connect(tailFilter).connect(tailGain).connect(this.engine.bus('effects'))
    tail.start(t)
    tail.stop(t + 2.8)
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
