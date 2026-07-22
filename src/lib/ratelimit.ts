import { RateLimiterMemory } from 'rate-limiter-flexible'

// In-memory rate-limiting (één instance; geen Redis nodig voor een klein
// kantoor). Beschermt inlog-, OTP- en tekeneindpunten tegen brute-force.
const limiters = {
  login: new RateLimiterMemory({ points: 5, duration: 300, blockDuration: 900 }),
  totp: new RateLimiterMemory({ points: 5, duration: 300, blockDuration: 900 }),
  otpRequest: new RateLimiterMemory({ points: 5, duration: 600 }),
  otpVerify: new RateLimiterMemory({ points: 5, duration: 600, blockDuration: 900 }),
  token: new RateLimiterMemory({ points: 30, duration: 600 })
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
