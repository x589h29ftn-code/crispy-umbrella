// Seizoenen: een jaar duurt vier dagen. Gedeelde uniforms sturen de
// kleurverschuiving van vegetatie en terrein aan (geen chunk-rebuilds).

export const seasonAutumn = { value: 0 } // 0..1 herfstkleuring
export const seasonWinter = { value: 0 } // 0..1 winterkleuring/sneeuw

const NAMES = ['Lente', 'Zomer', 'Herfst', 'Winter']

/** Naam van het seizoen bij jaarfractie t (0..1). */
export function seasonName(t: number): string {
  return NAMES[Math.floor((t % 1) * 4) % 4]
}

/** Herfstfactor: piekt in het derde kwart van het jaar. */
export function autumness(t: number): number {
  const s = t % 1
  return smooth(0.5, 0.58, s) * (1 - smooth(0.72, 0.8, s))
}

/** Winterfactor: piekt in het vierde kwart, dooit begin lente. */
export function winterness(t: number): number {
  const s = t % 1
  return Math.max(smooth(0.72, 0.82, s), 1 - smooth(0.02, 0.14, s))
}

function smooth(a: number, b: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}
