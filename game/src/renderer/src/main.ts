import { Game } from './core/Game'
import { Hud } from './ui/hud'

// Startmenu → game. De game leeft zolang het venster leeft; een nieuwe wereld
// starten gebeurt door de app opnieuw te openen (v1).

const hud = new Hud()
const container = document.getElementById('app')!
let game: Game | null = null

hud.onPlay = (seedText) => {
  const seed = seedText || `wereld-${Math.floor(Math.random() * 1_000_000)}`
  if (!game) {
    game = new Game(seed, container, hud)
    wireGame(game)
    game.start()
  }
  hud.showGame()
  game.setPaused(false)
  game.resumeAudio()
  game.input.requestLock()
}

hud.onResume = () => {
  if (!game) return
  hud.hidePause()
  game.setPaused(false)
  game.resumeAudio()
  game.input.requestLock()
}

hud.onVolume = (bus, value) => {
  game?.setVolume(bus, value)
}

hud.onQuit = () => {
  if (window.gameAPI) window.gameAPI.quit()
  else window.close()
}

function wireGame(g: Game): void {
  g.graphics.setQuality(hud.initialQuality)
  hud.onQuality = (q) => g.graphics.setQuality(q)

  // Esc (pointer lock kwijt) → pauzemenu.
  g.input.onLockChange = (locked) => {
    if (!locked && !g.paused) {
      g.setPaused(true)
      hud.showPause()
    }
  }
  hud.setSelectedSlot(0)
}

hud.showMenu()
