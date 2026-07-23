import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'

// Eenmalige, kortlevende tekentoken voor externe ondertekenaars. De ruwe token
// gaat alleen in de e-maillink; in de database staat uitsluitend de HMAC-hash.

export function generateSigningToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: hashSigningToken(raw) }
}

export function hashSigningToken(raw: string): string {
  return createHmac('sha256', env.SIGNING_TOKEN_SECRET).update(raw).digest('hex')
}

/** Constant-time vergelijking van twee hashes. */
export function safeEqualHash(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// E-mail-OTP (6 cijfers) - gehasht opgeslagen, net als de tekentoken.
export function generateOtp(): { code: string; hash: string } {
  const code = String(randomInt(100000, 1000000))
  return { code, hash: hashOtp(code) }
}

export function hashOtp(code: string): string {
  return createHmac('sha256', env.SIGNING_TOKEN_SECRET).update(`otp:${code}`).digest('hex')
}
