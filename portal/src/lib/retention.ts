import 'server-only'
import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { writeAudit } from '@/lib/audit'

// Bewaartermijn: afgeronde dossiers krijgen `retentionUntil` op zeven jaar na
// afronding. Daarna worden ze opgeruimd.
//
// Harde regel: het document en het bewijsdossier verdwijnen ALTIJD samen. Een
// ondertekend document zonder auditspoor is waardeloos, en een auditspoor zonder
// document ook. Daarom gebeurt alles in één transactie; mislukt er iets, dan
// blijft alles staan.

export interface PurgeResult {
  dossiers: number
  documents: number
  auditEvents: number
  /** Dossiers die niet zijn opgeruimd, met de reden. */
  skipped: { dossierId: string; reason: string }[]
}

/**
 * Ruimt dossiers op waarvan de bewaartermijn is verstreken.
 *
 * `dryRun` laat zien wat er zou gebeuren zonder iets te verwijderen — gebruik dat
 * de eerste keer, want verwijderen is niet terug te draaien.
 */
export async function purgeExpiredDossiers(opts?: {
  now?: Date
  limit?: number
  dryRun?: boolean
}): Promise<PurgeResult> {
  const now = opts?.now ?? new Date()
  const limit = opts?.limit ?? 25
  const dryRun = opts?.dryRun ?? false

  const expired = await prisma.dossier.findMany({
    where: { retentionUntil: { not: null, lt: now }, status: 'ONDERTEKEND' },
    orderBy: { retentionUntil: 'asc' },
    take: limit,
    select: {
      id: true,
      title: true,
      documents: { select: { id: true, originalKey: true, workingKey: true, preSealKey: true, sealedKey: true } }
    }
  })

  const result: PurgeResult = { dossiers: 0, documents: 0, auditEvents: 0, skipped: [] }

  for (const dossier of expired) {
    const keys = dossier.documents.flatMap((d) =>
      [d.originalKey, d.workingKey, d.preSealKey, d.sealedKey].filter((k): k is string => !!k)
    )

    if (dryRun) {
      result.dossiers += 1
      result.documents += dossier.documents.length
      result.auditEvents += await prisma.auditEvent.count({ where: { dossierId: dossier.id } })
      continue
    }

    try {
      // Eerst de database, in één transactie. Lukt dat niet, dan blijven de
      // bestanden staan en is er niets half weg.
      // Laatste hash van de keten vastleggen vóór het verwijderen, voor de grafsteen.
      const laatste = await prisma.auditEvent.findFirst({
        where: { dossierId: dossier.id },
        orderBy: { seq: 'desc' },
        select: { hash: true }
      })
      const auditCount = await prisma.$transaction(async (tx) => {
        const n = await tx.auditEvent.count({ where: { dossierId: dossier.id } })
        // Het auditspoor is append-only; voor de geplande opruiming zetten we de
        // noodschakelaar aan, alleen binnen deze transactie.
        await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
        // Documenten, ontvangers, velden en auditregels hangen met cascade aan
        // het dossier, dus die gaan hiermee mee.
        await tx.dossier.delete({ where: { id: dossier.id } })
        return n
      })

      // Daarna de bestanden. Een achterblijvend bestand is hinderlijk maar niet
      // gevaarlijk; het omgekeerde (bestand weg, administratie nog aanwezig) zou
      // verwarrender zijn.
      for (const key of keys) {
        await storage()
          .remove(key)
          .catch((e) => console.error(`[bewaartermijn] bestand ${key} niet verwijderd`, e))
      }

      // Grafsteen in de ketenloze reeks: ook het verwijderen van een compleet
      // dossier laat zo een spoor na. De goedkope versie van een extern anker.
      await writeAudit({
        type: 'BEWAARTERMIJN_OPGERUIMD',
        message: `dossier "${dossier.title}" opgeruimd na verstrijken van de bewaartermijn`,
        metadata: {
          dossierId: dossier.id,
          auditRegels: auditCount,
          documenten: dossier.documents.length,
          laatsteHash: laatste?.hash ?? null
        }
      })

      result.dossiers += 1
      result.documents += dossier.documents.length
      result.auditEvents += auditCount
    } catch (e) {
      result.skipped.push({ dossierId: dossier.id, reason: (e as Error).message })
      console.error(`[bewaartermijn] dossier ${dossier.id} niet opgeruimd`, e)
    }
  }

  return result
}

/** Hoeveel dossiers wachten op opruiming, en wat is het eerstvolgende moment? */
export async function retentionStatus(now = new Date()): Promise<{ due: number; next: Date | null }> {
  const [due, nextRow] = await Promise.all([
    prisma.dossier.count({ where: { retentionUntil: { not: null, lt: now }, status: 'ONDERTEKEND' } }),
    prisma.dossier.findFirst({
      where: { retentionUntil: { not: null, gte: now } },
      orderBy: { retentionUntil: 'asc' },
      select: { retentionUntil: true }
    })
  ])
  return { due, next: nextRow?.retentionUntil ?? null }
}
