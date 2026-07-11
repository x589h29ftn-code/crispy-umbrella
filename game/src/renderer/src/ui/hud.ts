import { BLOCK_TYPES } from '../build/blockTypes'
import type { Quality } from '../core/graphics'

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

/**
 * Alle DOM-interactie: startmenu, pauzemenu, crosshair-HUD, hotbar en
 * onderwater-overlay. De game praat alleen via deze klasse met de pagina.
 */
export class Hud {
  onPlay: ((seed: string) => void) | null = null
  onResume: (() => void) | null = null
  onQuit: (() => void) | null = null
  onQuality: ((q: Quality) => void) | null = null
  onVolume: ((bus: 'music' | 'ambient' | 'effects', value: number) => void) | null = null
  onFov: ((hFov: number) => void) | null = null
  onSensitivity: ((factor: number) => void) | null = null
  onViewDistance: ((chunks: number) => void) | null = null

  private menu = el<HTMLDivElement>('menu')
  private pause = el<HTMLDivElement>('pause')
  private hud = el<HTMLDivElement>('hud')
  private stats = el<HTMLDivElement>('stats')
  private clock = el<HTMLDivElement>('clock')
  private hotbar = el<HTMLDivElement>('hotbar')
  private underwaterEl = el<HTMLDivElement>('underwater')
  private toastEl = el<HTMLDivElement>('toast')
  private toastTimer = 0

  constructor() {
    el<HTMLButtonElement>('play').addEventListener('click', () => {
      const seed = el<HTMLInputElement>('seed').value.trim()
      this.onPlay?.(seed)
    })
    el<HTMLButtonElement>('resume').addEventListener('click', () => this.onResume?.())
    el<HTMLButtonElement>('quit').addEventListener('click', () => this.onQuit?.())
    el<HTMLSelectElement>('quality').addEventListener('change', (e) => {
      this.onQuality?.((e.target as HTMLSelectElement).value as Quality)
    })
    for (const bus of ['music', 'ambient', 'effects'] as const) {
      el<HTMLInputElement>(`vol-${bus}`).addEventListener('input', (e) => {
        this.onVolume?.(bus, Number((e.target as HTMLInputElement).value) / 100)
      })
    }

    // Instellingen: opslaan in localStorage en doorgeven aan de game.
    const saved = this.loadSettings()
    el<HTMLInputElement>('set-fov').value = String(saved.fov)
    el<HTMLInputElement>('set-sens').value = String(saved.sens)
    el<HTMLSelectElement>('set-view').value = String(saved.view)
    el<HTMLInputElement>('set-fov').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value)
      this.saveSetting('fov', v)
      this.onFov?.(v)
    })
    el<HTMLInputElement>('set-sens').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value)
      this.saveSetting('sens', v)
      this.onSensitivity?.(v / 100)
    })
    el<HTMLSelectElement>('set-view').addEventListener('change', (e) => {
      const v = Number((e.target as HTMLSelectElement).value)
      this.saveSetting('view', v)
      this.onViewDistance?.(v)
    })

    this.buildHotbar()
  }

  /** Bewaarde instellingen (met standaardwaarden). */
  loadSettings(): { fov: number; sens: number; view: number } {
    try {
      const raw = localStorage.getItem('verdant-instellingen')
      if (raw) return { fov: 100, sens: 100, view: 14, ...JSON.parse(raw) }
    } catch {
      // localStorage kan geblokkeerd zijn; gebruik standaardwaarden.
    }
    return { fov: 100, sens: 100, view: 14 }
  }

  private saveSetting(key: string, value: number): void {
    try {
      const current = this.loadSettings() as unknown as Record<string, number>
      current[key] = value
      localStorage.setItem('verdant-instellingen', JSON.stringify(current))
    } catch {
      // best effort
    }
  }

  /** Fotomodus: alle overlays verbergen. */
  setPhotoMode(on: boolean): void {
    this.hud.classList.toggle('hidden', on)
  }

  private buildHotbar(): void {
    this.hotbar.innerHTML = ''
    const slots = [{ name: 'Hand', color: '', icon: '\u270b' }]
      .concat(
        BLOCK_TYPES.map((b) => ({ name: b.name, color: '#' + b.color.toString(16).padStart(6, '0'), icon: '' }))
      )
      .concat([{ name: 'Hengel', color: '', icon: '\ud83c\udfa3' }])
    slots.forEach((slot, i) => {
      const div = document.createElement('div')
      div.className = 'slot' + (i === 0 ? ' selected' : '')
      const num = document.createElement('span')
      num.className = 'num'
      num.textContent = String(i + 1)
      div.appendChild(num)
      if (slot.color) {
        const swatch = document.createElement('div')
        swatch.className = 'swatch'
        swatch.style.background = slot.color
        div.appendChild(swatch)
      } else {
        const iconEl = document.createElement('span')
        iconEl.textContent = slot.icon
        iconEl.style.fontSize = '20px'
        div.appendChild(iconEl)
      }
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = slot.name
      div.appendChild(name)
      this.hotbar.appendChild(div)
    })
  }

  setSelectedSlot(index: number): void {
    const children = this.hotbar.children
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle('selected', i === index)
    }
  }

  showMenu(): void {
    this.menu.classList.remove('hidden')
    this.pause.classList.add('hidden')
    this.hud.classList.add('hidden')
  }

  showGame(): void {
    this.menu.classList.add('hidden')
    this.pause.classList.add('hidden')
    this.hud.classList.remove('hidden')
  }

  showPause(): void {
    this.pause.classList.remove('hidden')
  }

  hidePause(): void {
    this.pause.classList.add('hidden')
  }

  get initialQuality(): Quality {
    return el<HTMLSelectElement>('quality').value as Quality
  }

  volume(bus: 'music' | 'ambient' | 'effects'): number {
    return Number(el<HTMLInputElement>(`vol-${bus}`).value) / 100
  }

  setStats(text: string): void {
    this.stats.textContent = text
  }

  setClock(text: string): void {
    this.clock.textContent = text
  }

  setUnderwater(on: boolean): void {
    this.underwaterEl.style.opacity = on ? '1' : '0'
  }

  toast(message: string): void {
    this.toastEl.textContent = message
    this.toastEl.style.opacity = '1'
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.opacity = '0'
    }, 2500)
  }
}
