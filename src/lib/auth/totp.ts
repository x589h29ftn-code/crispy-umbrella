import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { env } from '@/env'
import { encryptString, decryptString } from '@/lib/storage/crypto'

// TOTP (RFC 6238) voor de tweede factor van medewerkers. Het secret wordt
// versleuteld in de database bewaard (nooit leesbaar op schijf).

const ISSUER = 'OVP Ondertekenportaal'

function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32)
  })
}

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32
}

export function totpAuthUri(secretBase32: string, accountLabel: string): string {
  return totpFor(secretBase32, accountLabel).toString()
}

export async function totpQrDataUrl(secretBase32: string, accountLabel: string): Promise<string> {
  return QRCode.toDataURL(totpAuthUri(secretBase32, accountLabel), { margin: 1, width: 220 })
}

/** Verifieert een 6-cijferige code met een klein tijdvenster (±1 stap). */
export function verifyTotp(secretBase32: string, code: string): boolean {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const delta = totpFor(secretBase32, ISSUER).validate({ token: clean, window: 1 })
  return delta !== null
}

// Versleutel/ontsleutel het secret voor opslag met het aparte TOTP-geheim.
export function encryptTotpSecret(secretBase32: string): string {
  return encryptString(env.TOTP_ENCRYPTION_KEY, secretBase32)
}

export function decryptTotpSecret(stored: string): string {
  return decryptString(env.TOTP_ENCRYPTION_KEY, stored)
}
