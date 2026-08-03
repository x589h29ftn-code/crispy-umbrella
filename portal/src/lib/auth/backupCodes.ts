import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Eenmalige herstelcodes voor als een medewerker geen toegang meer heeft tot de
// authenticator-app. We bewaren alleen de SHA-256-hash van elke code; de codes
// zelf worden eenmalig getoond bij het aanmaken.

const CODE_COUNT = 8

/// Leesbare code in de vorm "a1b2-c3d4" (8 tekens uit een verwarringsvrije set).
function makeCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789' // geen 0/o/1/l/i
  const bytes = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-'
    s += alphabet[bytes[i] % alphabet.length]
  }
  return s
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
}

/// Genereert een set codes: `plain` om eenmalig te tonen, `hashes` om te bewaren.
export function generateBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: CODE_COUNT }, makeCode)
  return { plain, hashes: plain.map(hashBackupCode) }
}

/// Zoekt de hash van `code` in de opgeslagen hashes (constant-time vergelijk).
/// Geeft de overgebleven hashes terug (zonder de gebruikte) of null bij geen match.
export function consumeBackupCode(code: string, storedHashes: string[]): string[] | null {
  const target = hashBackupCode(code)
  const targetBuf = Buffer.from(target, 'hex')
  let matchIndex = -1
  for (let i = 0; i < storedHashes.length; i++) {
    const h = Buffer.from(storedHashes[i], 'hex')
    if (h.length === targetBuf.length && timingSafeEqual(h, targetBuf)) {
      matchIndex = i
      break
    }
  }
  if (matchIndex === -1) return null
  return storedHashes.filter((_, i) => i !== matchIndex)
}

/// Herkent het formaat van een herstelcode (om het bij inloggen te onderscheiden
/// van een 6-cijferige TOTP-code).
export function looksLikeBackupCode(input: string): boolean {
  return /^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(input.trim())
}
