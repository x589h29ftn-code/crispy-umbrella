import { hash, verify } from '@node-rs/argon2'

// argon2id met bewuste kostenparameters. argon2id is de aanbevolen keuze voor
// nieuwe projecten (geheugen-hard, bestand tegen GPU-brute-force).
const OPTS = {
  // ~19 MiB, 2 iteraties, parallelisme 1 — degelijk voor een klein kantoor.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS)
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTS)
  } catch {
    return false
  }
}
