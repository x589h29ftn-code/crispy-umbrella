import type { Prisma } from '@prisma/client'

/**
 * DE GLOBALE VERGRENDELINGSVOLGORDE — één plek, en elk pad dat meer dan één
 * vergrendeling neemt houdt zich hieraan.
 *
 * Neemt het ene pad A dan B en het andere B dan A, dan wachten ze op elkaar en
 * staat alles stil. Postgres ziet zo'n deadlock en breekt er één af, maar de
 * gebruiker krijgt dan een fout op een moment dat niets kapot was.
 *
 *   1. de `Dossier`-rij
 *   2. de `Document`-rijen, oplopend op `id`
 *   3. de advisory ketenlocks van het auditspoor, en daarbinnen:
 *      dossierketens oplopend op `dossierId`, en de dossierloze keten ALTIJD
 *      als laatste
 *
 * Niveau 3 heeft een subvolgorde nodig omdat één pad er twee tegelijk kan
 * vasthouden: het opruimen na de bewaartermijn raakt de keten van het dossier dat
 * het verwijdert én de dossierloze keten voor de grafsteen. Zonder subvolgorde kan
 * dat deadlocken tegen een gelijktijdige inlog (die naar de dossierloze keten
 * schrijft) plus een indiening (die naar een dossierketen schrijft).
 *
 * Bekende paden met meer dan één vergrendeling:
 *
 * - `applySignature` — Document-rijen (oplopend), daarna de dossierketen via
 *   `writeAudit` binnen dezelfde transactie. Niveau 2 → 3.
 * - `purgeExpiredDossiers` — de Dossier-rij (impliciet bij delete), daarna de
 *   dossierketen; de grafsteen op de dossierloze keten gaat NA de commit, dus
 *   die twee ketenlocks worden nooit tegelijk vastgehouden. Niveau 1 → 3.
 * - `applySeals` / `applySealsOnTop` — Document-rijen, daarna de dossierketen.
 *   Niveau 2 → 3.
 */

/** Vaste namespace voor de advisory locks van het auditspoor. */
export const AUDIT_LOCK_NAMESPACE = 71_413

/** Ketensleutel voor regels zonder dossier (inloggen, certificaat ingetrokken). */
export const GEEN_DOSSIER = '(zonder dossier)'

/**
 * Sorteert ketensleutels volgens niveau 3 van de volgorde hierboven: dossiers
 * oplopend, de dossierloze keten altijd als laatste.
 */
export function sorteerKetens(keys: (string | null)[]): string[] {
  const unieke = [...new Set(keys.map((k) => k ?? GEEN_DOSSIER))]
  return unieke.sort((a, b) => {
    if (a === GEEN_DOSSIER) return 1
    if (b === GEEN_DOSSIER) return -1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/** Neemt de advisory ketenlock(s) in de voorgeschreven volgorde. */
export async function lockAuditChains(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  keys: (string | null)[]
): Promise<void> {
  for (const key of sorteerKetens(keys)) {
    // `_xact_` en niet de sessievariant: zie de toelichting in audit.ts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_NAMESPACE}::int, hashtext(${key})::int)`
  }
}

/**
 * Begrenst het wachten op een vergrendeling. Zonder dit hangt een verzoek tot de
 * proxy hem afkapt, en weet de gebruiker niet of zijn actie is gelukt.
 */
export async function setLockTimeouts(
  tx: Pick<Prisma.TransactionClient, '$executeRawUnsafe'>,
  opts?: { lockMs?: number; statementMs?: number }
): Promise<void> {
  const lock = opts?.lockMs ?? 10_000
  const statement = opts?.statementMs ?? 90_000
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lock}ms'`)
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${statement}ms'`)
}

/**
 * Herkent een verlopen vergrendeling of statement. Zulke fouten zijn te herhalen:
 * er is niets kapot, er was alleen iets anders bezig.
 */
export function isLockTimeout(e: unknown): boolean {
  const code = (e as { code?: string; meta?: { code?: string } })?.meta?.code ?? (e as { code?: string })?.code
  if (code === '55P03' || code === '57014') return true
  const msg = String((e as Error)?.message ?? '').toLowerCase()
  return msg.includes('lock timeout') || msg.includes('canceling statement due to')
}

/** Nette, herhaalbare melding voor de ondertekenaar. */
export const DRUKTE_MELDING =
  'Er wordt op dit moment een andere ondertekening van dit document verwerkt. Probeer het over een minuut opnieuw.'
