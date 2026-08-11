/**
 * Kleine "is er iemand aan het scrollen?"-schakelaar. Tijdens het scrollen
 * tekenen de pagina's alleen een goedkope voorvertoning; zodra het scrollen
 * tot rust komt, wordt de scherpe versie gerenderd. Zo blijft doorscrollen door
 * een groot document soepel in plaats van dat de hoofdthread vastloopt op
 * pagina's die je alweer voorbij bent.
 */
const listeners = new Set<(scrolling: boolean) => void>()
let scrolling = false
let timer = 0

/** Milliseconden zonder scroll-event voordat we het scrollen als klaar zien. */
const SETTLE_MS = 140

function set(next: boolean): void {
  if (scrolling === next) return
  scrolling = next
  for (const fn of listeners) fn(next)
}

/** Aanroepen bij elk scroll-event van de leesweergave. */
export function noteScroll(): void {
  set(true)
  window.clearTimeout(timer)
  timer = window.setTimeout(() => set(false), SETTLE_MS)
}

export function isScrolling(): boolean {
  return scrolling
}

export function onScrollState(fn: (scrolling: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
