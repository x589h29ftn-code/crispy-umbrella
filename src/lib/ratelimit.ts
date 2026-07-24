import { RateLimiterMemory } from 'rate-limiter-flexible'

// In-memory rate-limiting (één instance; geen Redis nodig voor een klein
// kantoor). Beschermt inlog-, OTP- en tekeneindpunten tegen brute-force.
const limiters = {
  login: new RateLimiterMemory({ points: 5, duration: 300, blockDuration: 900 }),
  totp: new RateLimiterMemory({ points: 5, duration: 300, blockDuration: 900 }),
  otpRequest: new RateLimiterMemory({ points: 5, duration: 600 }),
  otpVerify: new RateLimiterMemory({ points: 5, duration: 600, blockDuration: 900 }),
  token: new RateLimiterMemory({ points: 30, duration: 600 }),
  passwordReset: new RateLimiterMemory({ points: 5, duration: 900 })
}

export type LimitKey = keyof typeof limiters

/** Verbruikt één punt; geeft false als de limiet is bereikt. */
export async function consume(key: LimitKey, identifier: string): Promise<boolean> {
  try {
    await limiters[key].consume(identifier)
    return true
  } catch {
    return false
  }
}

// --- Progressieve lockout bij herhaald mislukt inloggen ---
// Naast de burst-limiet bouwen we een oplopende blokkade op: hoe vaker het
// (over een langere periode) misgaat, hoe langer de wachttijd. Dit vertraagt
// een volgehouden brute-force aanval zonder een legitieme gebruiker die zich
// één keer vergist te lang buiten te sluiten.
const failCounter = new RateLimiterMemory({ points: 10_000, duration: 24 * 3600 }) // telt mislukkingen per dag
const blocker = new RateLimiterMemory({ points: 1, duration: 1 }) // uitsluitend voor .block()

/** Resterende blokkadetijd in ms (0 = niet geblokkeerd). */
export async function blockedFor(identifier: string): Promise<number> {
  const res = await blocker.get(identifier)
  return res && res.consumedPoints > 0 && res.msBeforeNext > 0 ? res.msBeforeNext : 0
}

/** Registreert een mislukte poging en zet zo nodig een oplopende blokkade. */
export async function registerFailure(identifier: string): Promise<void> {
  let fails = 1
  try {
    const res = await failCounter.consume(identifier)
    fails = res.consumedPoints
  } catch {
    fails = 9999
  }
  const blockSeconds = fails >= 12 ? 2 * 3600 : fails >= 8 ? 30 * 60 : fails >= 5 ? 5 * 60 : 0
  if (blockSeconds > 0) await blocker.block(identifier, blockSeconds)
}

/** Wist de tellers na een geslaagde login. */
export async function registerSuccess(identifier: string): Promise<void> {
  await failCounter.delete(identifier).catch(() => {})
  await blocker.delete(identifier).catch(() => {})
}
