import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { env } from '@/env'
import { encryptString, decryptString } from '@/lib/storage/crypto'
import { currentTotpKey, totpKeyResolver } from '@/lib/storage/keys'

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

export const TOTP_PERIODE_SECONDEN = 30

/**
 * Verifieert een 6-cijferige code en geeft de tijdstap terug die is geaccepteerd.
 *
 * Die tijdstap is het hele punt: een TOTP-code blijft binnen zijn venster (hier
 * 30 seconden, plus één stap speling aan weerszijden) geldig en is dus tot
 * anderhalve minuut lang herbruikbaar. Wie de code over de schouder meeleest of
 * uit een screenshot haalt, kan hem in dat venster nog een keer gebruiken. Door
 * de laatst geaccepteerde stap te onthouden en niet nogmaals te accepteren,
 * bewijst een code bezit van het apparaat op dít moment in plaats van dat iemand
 * hem heeft gekopieerd.
 */
export function verifyTotpStep(secretBase32: string, code: string): { ok: boolean; step?: number } {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return { ok: false }
  const delta = totpFor(secretBase32, ISSUER).validate({ token: clean, window: 1 })
  if (delta === null) return { ok: false }
  // validate() geeft de afwijking in stappen; opgeteld bij de huidige stap levert
  // dat de absolute tijdstap waar deze code bij hoort.
  const nu = Math.floor(Date.now() / 1000 / TOTP_PERIODE_SECONDEN)
  return { ok: true, step: nu + delta }
}

/** Verifieert een 6-cijferige code met een klein tijdvenster (±1 stap). */
export function verifyTotp(secretBase32: string, code: string): boolean {
  return verifyTotpStep(secretBase32, code).ok
}

// Versleutel/ontsleutel het secret voor opslag met het aparte TOTP-geheim.
export function encryptTotpSecret(secretBase32: string): string {
  const { secret, version } = currentTotpKey()
  return encryptString(secret, secretBase32, version)
}

export function decryptTotpSecret(stored: string): string {
  return decryptString(totpKeyResolver(), stored)
}
