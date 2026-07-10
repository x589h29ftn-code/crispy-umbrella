// Toetsenbord/muis-invoer. Alles op KeyboardEvent.code zodat de besturing
// ook op AZERTY en andere indelingen fysiek op dezelfde plek zit.

export interface MouseClick {
  button: number
}

export class Input {
  readonly keys = new Set<string>()
  private mouseDx = 0
  private mouseDy = 0
  private wheel = 0
  private clicks: MouseClick[] = []
  private presses: string[] = []
  private element: HTMLElement | null = null
  onLockChange: ((locked: boolean) => void) | null = null

  attach(element: HTMLElement): void {
    this.element = element

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
      this.presses.push(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code)
    })
    window.addEventListener('blur', () => {
      this.keys.clear()
    })

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return
      this.mouseDx += e.movementX
      this.mouseDy += e.movementY
    })
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return
      this.clicks.push({ button: e.button })
    })
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return
        this.wheel += Math.sign(e.deltaY)
      },
      { passive: true }
    )
    document.addEventListener('pointerlockchange', () => {
      this.keys.clear()
      this.onLockChange?.(this.locked)
    })
    // Contextmenu stoort bij rechtsklikken (blok weghalen).
    document.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element
  }

  requestLock(): void {
    this.element?.requestPointerLock()
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock()
  }

  isDown(code: string): boolean {
    return this.keys.has(code)
  }

  /** Haalt de opgebouwde muisbeweging op en reset die. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDx, dy: this.mouseDy }
    this.mouseDx = 0
    this.mouseDy = 0
    return d
  }

  /** Scrollstappen sinds de vorige frame (-n..n). */
  consumeWheel(): number {
    const w = this.wheel
    this.wheel = 0
    return w
  }

  /** Muisklikken sinds de vorige frame. */
  consumeClicks(): MouseClick[] {
    const c = this.clicks
    this.clicks = []
    return c
  }

  /** Losse toetsaanslagen sinds de vorige frame (voor hotbar-selectie e.d.). */
  consumePresses(): string[] {
    const p = this.presses
    this.presses = []
    return p
  }
}
