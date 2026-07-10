// Web Audio-basis: één AudioContext met aparte bussen voor muziek, omgeving
// en effecten. Alles wordt live gesynthetiseerd — er zijn geen geluidsbestanden.

export type Bus = 'music' | 'ambient' | 'effects'

export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  private buses: Record<Bus, GainNode>
  private noise: AudioBuffer

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)

    this.buses = {
      music: this.ctx.createGain(),
      ambient: this.ctx.createGain(),
      effects: this.ctx.createGain()
    }
    for (const bus of Object.values(this.buses)) bus.connect(this.master)

    // Twee seconden witte ruis, geloopt door alle ruis-gebaseerde geluiden.
    const len = this.ctx.sampleRate * 2
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }

  /** Autoplay-beleid: context pas (her)starten na een gebruikersklik. */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  bus(name: Bus): GainNode {
    return this.buses[name]
  }

  setVolume(name: Bus, value: number): void {
    this.buses[name].gain.setTargetAtTime(value * value, this.ctx.currentTime, 0.05)
  }

  /** Loopende witte-ruisbron, aangesloten op niets — zelf routeren. */
  createNoiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    return src
  }
}
