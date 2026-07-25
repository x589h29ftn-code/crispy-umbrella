// Encoding-hulpjes voor de CSC-API. Bewust een apart, puur bestand: het verschil
// tussen de twee encodings is een klassieke bron van uren zoeken.
//
//   /oauth2/authorize  -> base64URL, komma-gescheiden
//   /csc/v1/.../signHash -> gewone base64, als JSON-array
//
// Beide beschrijven exact dezelfde SHA-256-hashes.

/** SHA-256 als gewone base64 (voor signHash). */
export function toBase64(hash: Buffer | Uint8Array): string {
  return Buffer.from(hash).toString('base64')
}

/** SHA-256 als base64url zonder padding (voor /oauth2/authorize). */
export function toBase64Url(hash: Buffer | Uint8Array): string {
  return Buffer.from(hash).toString('base64url')
}

/** Zet gewone base64 om naar base64url zonder opnieuw te hashen. */
export function base64ToBase64Url(b64: string): string {
  return Buffer.from(b64, 'base64').toString('base64url')
}

/** De hashes zoals /oauth2/authorize ze wil: base64url, komma-gescheiden. */
export function authorizeHashParam(hashesBase64: string[]): string {
  return hashesBase64.map(base64ToBase64Url).join(',')
}

// Vaste OID's uit de opdracht.
export const HASH_ALGO_SHA256 = '2.16.840.1.101.3.4.2.1'
export const SIGN_ALGO_RSA = '1.2.840.113549.1.1.1'
export const AUTH_MODE = 'oauth2code'
