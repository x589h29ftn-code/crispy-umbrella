import 'server-only'
import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'

// Losse blobs opruimen.
//
// Sinds elke schrijfactie een NIEUWE opslagsleutel maakt (nooit in place
// overschrijven, want dan is een blob bij een rollback al gewijzigd terwijl de
// database dat niet weet), blijft er af en toe een bestand achter waar geen
// databaserij naar wijst:
//
//   - een blob die is weggeschreven en waarvan de transactie daarna terugrolde;
//   - de voorbereide PDF van een ondertekensessie die is verlopen;
//   - een oude versie waarvan het verwijderen na de commit mislukte.
//
// Die zijn veilig te verwijderen, met één harde voorwaarde: alleen als ze OUDER
// zijn dan de marge hieronder. Zonder marge ruimt deze taak een bestand op dat net
// is geschreven en waarvan de commit nog loopt — dan haalt de opruiming precies
// het bestand weg dat een seconde later wél gerefereerd wordt.

/** Hoe lang een niet-gerefereerde blob mag blijven staan. Niet optioneel. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60_000

export interface OrphanResult {
  /** Aantal blobs op het volume. */
  gescand: number
  /** Niet-gerefereerd en ouder dan de marge. */
  kandidaten: string[]
  /** Niet-gerefereerd maar nog binnen de marge; die blijven staan. */
  binnenMarge: number
  verwijderd: number
  fouten: { key: string; reason: string }[]
}

/** Alle opslagsleutels waar de database naar verwijst. */
async function gerefereerdeSleutels(): Promise<Set<string>> {
  const keys = new Set<string>()
  const documents = await prisma.document.findMany({
    select: {
      originalKey: true,
      workingKey: true,
      preSealKey: true,
      postQualifiedKey: true,
      sealedKey: true
    }
  })
  for (const d of documents) {
    for (const k of [d.originalKey, d.workingKey, d.preSealKey, d.postQualifiedKey, d.sealedKey]) {
      if (k) keys.add(k)
    }
  }
  // Voorbereide PDF's van lopende ondertekensessies. Die hangen in een JSON-veld,
  // dus die moeten expliciet worden meegenomen — vergeten betekent dat een
  // ondertekensessie halverwege zijn bestand kwijt is.
  const sessions = await prisma.cscSigningSession.findMany({ select: { preparedKeys: true } })
  for (const s of sessions) {
    const map = (s.preparedKeys ?? {}) as Record<string, unknown>
    for (const [naam, value] of Object.entries(map)) {
      // `__prepared` is metadata (JSON-string), geen opslagsleutel.
      if (naam === '__prepared') continue
      if (typeof value === 'string') keys.add(value)
    }
  }
  // Handtekeningafbeeldingen van medewerkers, als die als opslagsleutel staan.
  const accountants = await prisma.accountant.findMany({ select: { signaturePng: true } })
  for (const a of accountants) {
    if (a.signaturePng && !a.signaturePng.startsWith('data:')) keys.add(a.signaturePng)
  }
  return keys
}

/**
 * Ruimt niet-gerefereerde blobs op.
 *
 * `dryRun` is de standaard in het script: deze taak verwijdert bestanden, en dat
 * wil je één keer hebben gezien voordat het automatisch gebeurt.
 */
export async function cleanupOrphanBlobs(opts?: {
  dryRun?: boolean
  now?: Date
  graceMs?: number
  limit?: number
}): Promise<OrphanResult> {
  const dryRun = opts?.dryRun ?? false
  const now = opts?.now ?? new Date()
  const grace = opts?.graceMs ?? ORPHAN_GRACE_MS
  const limit = opts?.limit ?? 500
  const store = storage()

  const result: OrphanResult = { gescand: 0, kandidaten: [], binnenMarge: 0, verwijderd: 0, fouten: [] }
  if (!store.list) {
    // Een driver zonder opsomming (bijvoorbeeld een toekomstige S3-variant zonder
    // list-rechten) kan dit niet; dan liever niets doen dan gokken.
    console.warn('[losse bestanden] opslagdriver kan niet opsommen; overgeslagen')
    return result
  }

  const gerefereerd = await gerefereerdeSleutels()
  const alles = await store.list()
  result.gescand = alles.length

  for (const item of alles) {
    if (gerefereerd.has(item.key)) continue
    if (now.getTime() - item.modifiedAt.getTime() < grace) {
      result.binnenMarge += 1
      continue
    }
    result.kandidaten.push(item.key)
    if (result.kandidaten.length >= limit) break
  }

  if (dryRun) return result

  for (const key of result.kandidaten) {
    try {
      await store.remove(key)
      result.verwijderd += 1
    } catch (e) {
      result.fouten.push({ key, reason: (e as Error).message })
    }
  }
  return result
}
