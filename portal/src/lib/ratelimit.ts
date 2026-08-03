import { RateLimiterMemory, RateLimiterPostgres, type RateLimiterAbstract } from 'rate-limiter-flexible'
import { Pool } from 'pg'
import { env } from '@/env'

// Rate-limiting op inlog-, OTP- en tekeneindpunten.
//
// De tellers staan in Postgres en niet in het geheugen van de webcontainer. Dat was
// eerder wel zo, met de onderbouwing "we draaien één container". Dat klopte, maar de
// manier waarop het stukgaat is te makkelijk: één `docker compose up --scale web=2`
// en de limieten gelden per container, dus feitelijk het dubbele. Postgres staat er
// al en het volume is triviaal (een handvol rijen per dag), dus die onderbouwing
// weegt niet op tegen het risico.
//
// Valt de database weg, dan gaan de limieten NIET open: `insuranceLimiter` is een
// in-memory limiter met dezelfde instellingen, zodat een databasestoring geen
// brute-force-venster opent.

const definities = {
  login: { points: 5, duration: 300, blockDuration: 900 },
  totp: { points: 5, duration: 300, blockDuration: 900 },
  otpRequest: { points: 5, duration: 600, blockDuration: 0 },
  otpVerify: { points: 5, duration: 600, blockDuration: 900 },
  token: { points: 30, duration: 600, blockDuration: 0 },
  passwordReset: { points: 5, duration: 900, blockDuration: 0 },
  /** Publieke controlepagina: PDF-bommen zijn hier de goedkoopste aanval. */
  validate: { points: 20, duration: 600, blockDuration: 600 },
  /**
   * Downloadlink uit de voltooiingsmail. Ruimer dan de andere limieten, want een
   * legitieme cliënt haalt zijn stuk soms een paar keer op en deelt het binnen
   * een bedrijf. Strak genoeg om het raden van tokens onbetaalbaar te maken —
   * al is dat met 256 bits sowieso kansloos.
   */
  download: { points: 60, duration: 600, blockDuration: 0 }
} as const

export type LimitKey = keyof typeof definities

/** Eén pool voor de limieter; los van Prisma, want dit is puur SQL. */
let pool: Pool | null = null
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 })
    pool.on('error', (e) => console.error('[ratelimit] poolfout', e))
  }
  return pool
}

let limiters: Record<LimitKey, RateLimiterAbstract> | null = null
let failCounter: RateLimiterAbstract | null = null
let blocker: RateLimiterAbstract | null = null

/** Maakt een limiter in Postgres, met een in-memory achtervang bij storing. */
function maak(naam: string, cfg: { points: number; duration: number; blockDuration: number }): RateLimiterAbstract {
  const insurance = new RateLimiterMemory({
    points: cfg.points,
    duration: cfg.duration,
    blockDuration: cfg.blockDuration || undefined
  })
  if (env.RATE_LIMIT_STORE === 'memory') return insurance
  return new RateLimiterPostgres({
    storeClient: getPool(),
    tableName: 'RateLimit',
    tableCreated: true,
    keyPrefix: naam,
    points: cfg.points,
    duration: cfg.duration,
    blockDuration: cfg.blockDuration || undefined,
    insuranceLimiter: insurance
  })
}

function alle(): Record<LimitKey, RateLimiterAbstract> {
  if (!limiters) {
    limiters = Object.fromEntries(
      Object.entries(definities).map(([naam, cfg]) => [naam, maak(naam, cfg)])
    ) as Record<LimitKey, RateLimiterAbstract>
  }
  return limiters
}

/** Verbruikt één punt; geeft false als de limiet is bereikt. */
export async function consume(key: LimitKey, identifier: string): Promise<boolean> {
  try {
    await alle()[key].consume(identifier)
    return true
  } catch (e) {
    // Een echte fout (geen limiet) mag niet als "limiet bereikt" langskomen zonder
    // dat iemand het merkt; wel dichtgooien, maar luid.
    if (e instanceof Error) console.error(`[ratelimit] ${key} fout`, e)
    return false
  }
}

// --- Progressieve lockout bij herhaald mislukt inloggen ---
// Naast de burst-limiet bouwen we een oplopende blokkade op: hoe vaker het
// (over een langere periode) misgaat, hoe langer de wachttijd. Dit vertraagt
// een volgehouden brute-force aanval zonder een legitieme gebruiker die zich
// één keer vergist te lang buiten te sluiten.
function tellers(): { failCounter: RateLimiterAbstract; blocker: RateLimiterAbstract } {
  if (!failCounter) failCounter = maak('fails', { points: 10_000, duration: 24 * 3600, blockDuration: 0 })
  if (!blocker) blocker = maak('block', { points: 1, duration: 1, blockDuration: 0 })
  return { failCounter, blocker }
}

/** Resterende blokkadetijd in ms (0 = niet geblokkeerd). */
export async function blockedFor(identifier: string): Promise<number> {
  const res = await tellers().blocker.get(identifier)
  return res && res.consumedPoints > 0 && res.msBeforeNext > 0 ? res.msBeforeNext : 0
}

/** Registreert een mislukte poging en zet zo nodig een oplopende blokkade. */
export async function registerFailure(identifier: string): Promise<void> {
  const { failCounter: fc, blocker: bl } = tellers()
  let fails = 1
  try {
    const res = await fc.consume(identifier)
    fails = res.consumedPoints
  } catch {
    fails = 9999
  }
  const blockSeconds = fails >= 12 ? 2 * 3600 : fails >= 8 ? 30 * 60 : fails >= 5 ? 5 * 60 : 0
  if (blockSeconds > 0) await bl.block(identifier, blockSeconds)
}

/** Wist de tellers na een geslaagde login. */
export async function registerSuccess(identifier: string): Promise<void> {
  const { failCounter: fc, blocker: bl } = tellers()
  await fc.delete(identifier).catch(() => {})
  await bl.delete(identifier).catch(() => {})
}
