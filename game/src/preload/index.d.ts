export interface GameAPI {
  quit: () => void
  toggleFullscreen: () => void
}

declare global {
  interface Window {
    // Optioneel: in de browser-smoke-test bestaat de preload niet.
    gameAPI?: GameAPI
  }
}

export {}
