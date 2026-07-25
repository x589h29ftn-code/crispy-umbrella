import 'server-only'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { storage } from '@/lib/storage'
import { writeAudit } from '@/lib/audit'
import { lockAuditChains } from '@/lib/locks'

// Bewaartermijn. Twee termijnen, en dat is de kern van het ontwerp.
//
// Dit portaal is een DOORVOERSTATION, geen archief. Het ondertekende stuk gaat naar
// SharePoint en daar ligt de bewaarplicht. Het primaire bewijs is dat PDF: een
// gekwalificeerde handtekening met tijdstempel en ingebedde revocatiegegevens, plus
// de certificaatpagina. Dat is self-contained — iemand kan het over vijf jaar in
// Acrobat openen en valideren zonder deze server, deze database of onze medewerking.
//
// Daaruit volgt:
//
//   documentbestanden  90 dagen NA archivering
//   auditspoor         7 jaar na afronding
//
// EN DE BELANGRIJKSTE REGEL: NOOIT OP DE KLOK VERWIJDEREN, ALTIJD OP DE VLAG.
//
// Automatisch verwijderen naast handmatig archiveren is de enige echt gevaarlijke
// combinatie in dit ontwerp: als iemand vergeet af te vinken en de klok verwijdert
// toch, dan is het stuk nergens meer. Daarom verdwijnt er van een ONDERTEKEND
// dossier niets zolang `archivedAt` leeg is — desnoods voor altijd. Vollopen is een
// acceptabel probleem, verlies niet. De nudge op 60 en 80 dagen (lib/lifecycle.ts)
// zorgt dat het geen geheugenspel wordt.
//
// Dit keert de eerdere regel om, waarin document en bewijsspoor altijd samen
// verdwenen. Die koppeling zit nu bij de GEARCHIVEERDE kopie in SharePoint: daar
// horen document en bewijs bij elkaar te blijven. In het portaal blijven alleen de
// metadata en het auditspoor achter — genoeg om aan te tonen wat er is gebeurd, en
// niet genoeg om het document te reconstrueren.

/**
 * Hoeveel dagen na het archiveervinkje de bestanden verdwijnen. Instelbaar via
 * `BLOB_RETENTION_DAYS`, want de juiste waarde is een kantoorafspraak.
 */
export function blobBewaardagen(): number {
  return env.BLOB_RETENTION_DAYS
}

/** Sleutelvelden van een document, in de volgorde waarin we ze verantwoorden. */
const SLEUTELVELDEN = ['originalKey', 'workingKey', 'preSealKey', 'postQualifiedKey', 'sealedKey'] as const

export interface PurgeResult {
  /** Dossiers waarvan de bestanden zijn gewist (rijen blijven bestaan). */
  blobsGewist: number
  /** Dossiers die compleet zijn verwijderd (nooit afgerond, na 7 jaar). */
  dossiersVerwijderd: number
  documents: number
  auditEvents: number
  /** Wat er niet is opgeruimd, met de reden. */
  skipped: { dossierId: string; reason: string }[]
}

/** Telt en ontdubbelt de opslagsleutels van een reeks documenten. */
function sleutelsVan(documents: Record<string, string | null>[]): {
  keys: string[]
  perSoort: Record<string, number>
} {
  const perSoort: Record<string, number> = {}
  for (const veld of SLEUTELVELDEN) perSoort[veld] = 0
  const keySet = new Set<string>()
  for (const d of documents) {
    for (const veld of SLEUTELVELDEN) {
      const key = d[veld]
      if (!key) continue
      perSoort[veld] += 1
      // Dezelfde sleutel kan in meer dan één kolom staan: bij het waarmerken zijn
      // postQualifiedKey en sealedKey gelijk.
      keySet.add(key)
    }
  }
  return { keys: [...keySet], perSoort }
}

/**
 * Ruimt op wat opgeruimd mag worden.
 *
 * Drie gevallen:
 *
 *  1. **Afgerond én afgevinkt, ouder dan 90 dagen** → bestanden weg, rijen blijven.
 *     Het auditspoor en de metadata blijven zeven jaar staan.
 *  2. **Nooit afgerond** (verlopen, geweigerd, of een concept dat nooit is verzonden)
 *     en ouder dan 90 dagen → bestanden weg zonder vinkje. Er is geen ondertekend
 *     stuk om te bewaren.
 *  3. **Zeven jaar na afronding** → het hele dossier weg, inclusief auditspoor, met
 *     een grafsteen in de ketenloze reeks.
 *
 * `dryRun` laat zien wat er zou gebeuren zonder iets te verwijderen.
 */
export async function purgeExpiredDossiers(opts?: {
  now?: Date
  limit?: number
  dryRun?: boolean
}): Promise<PurgeResult> {
  const now = opts?.now ?? new Date()
  const limit = opts?.limit ?? 25
  const dryRun = opts?.dryRun ?? false
  const store = storage()
  const result: PurgeResult = {
    blobsGewist: 0,
    dossiersVerwijderd: 0,
    documents: 0,
    auditEvents: 0,
    skipped: []
  }
  const blobGrens = new Date(now.getTime() - blobBewaardagen() * 86_400_000)

  const documentSelect = {
    id: true,
    originalKey: true,
    workingKey: true,
    preSealKey: true,
    postQualifiedKey: true,
    sealedKey: true
  } as const

  // --- Geval 1 en 2: bestanden wissen, rijen laten staan ---
  const teWissen = await prisma.dossier.findMany({
    where: {
      OR: [
        // Afgerond en afgevinkt, vinkje ouder dan de termijn.
        { status: 'ONDERTEKEND', archivedAt: { not: null, lt: blobGrens } },
        // Nooit afgerond: geen ondertekend stuk om te bewaren, dus geen vinkje nodig.
        { status: { in: ['VERLOPEN', 'GEWEIGERD'] }, updatedAt: { lt: blobGrens } },
        { status: 'CONCEPT', sentAt: null, updatedAt: { lt: blobGrens } }
      ],
      // Alleen als er nog iets te wissen is.
      documents: { some: { OR: [{ originalKey: { not: null } }, { sealedKey: { not: null } }] } }
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: { id: true, title: true, status: true, archivedAt: true, documents: { select: documentSelect } }
  })

  for (const dossier of teWissen) {
    const { keys, perSoort } = sleutelsVan(dossier.documents as unknown as Record<string, string | null>[])
    if (keys.length === 0) continue
    if (dryRun) {
      result.blobsGewist += 1
      result.documents += dossier.documents.length
      continue
    }
    try {
      // Eerst de administratie: de sleutels leegmaken. Blijft er daarna een bestand
      // staan, dan is dat een wees en die ruimt ORPHAN_CLEANUP op. Andersom (bestand
      // weg, sleutel nog gevuld) is dataverlies, en dat is de kant die niet mag.
      await prisma.document.updateMany({
        where: { dossierId: dossier.id },
        data: {
          originalKey: null,
          workingKey: null,
          preSealKey: null,
          postQualifiedKey: null,
          sealedKey: null
        }
      })
      let verwijderd = 0
      for (const key of keys) {
        await store
          .remove(key)
          .then(() => {
            verwijderd += 1
          })
          .catch((e) => console.error(`[bewaartermijn] bestand ${key} niet verwijderd`, e))
      }
      await writeAudit({
        type: 'BEWAARTERMIJN_OPGERUIMD',
        dossierId: dossier.id,
        message:
          dossier.status === 'ONDERTEKEND'
            ? `documentbestanden gewist, ${blobBewaardagen()} dagen na archivering in SharePoint`
            : `documentbestanden gewist; dit dossier is nooit afgerond (${dossier.status})`,
        metadata: {
          fase: 'blobs',
          sleutels: perSoort,
          blobsVerwijderd: verwijderd,
          blobsTotaal: keys.length,
          gearchiveerdOp: dossier.archivedAt?.toISOString() ?? null,
          // Het bewijs blijft: hashes, metadata en het volledige auditspoor.
          bewijsBlijft: true
        }
      })
      result.blobsGewist += 1
      result.documents += dossier.documents.length
    } catch (e) {
      result.skipped.push({ dossierId: dossier.id, reason: (e as Error).message })
      console.error(`[bewaartermijn] bestanden van ${dossier.id} niet gewist`, e)
    }
  }

  // --- Geval 3: na zeven jaar het hele dossier, inclusief auditspoor ---
  const teVerwijderen = await prisma.dossier.findMany({
    where: { retentionUntil: { not: null, lt: now } },
    orderBy: { retentionUntil: 'asc' },
    take: limit,
    select: { id: true, title: true, documents: { select: documentSelect } }
  })

  for (const dossier of teVerwijderen) {
    const { keys, perSoort } = sleutelsVan(dossier.documents as unknown as Record<string, string | null>[])
    if (dryRun) {
      result.dossiersVerwijderd += 1
      result.auditEvents += await prisma.auditEvent.count({ where: { dossierId: dossier.id } })
      continue
    }
    try {
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
        await tx.dossier.delete({ where: { id: dossier.id } })
        // Ketenlock ná de rijlock, volgens de globale volgorde in lib/locks.ts. De
        // grafsteen op de dossierloze keten gebeurt buiten deze transactie, zodat er
        // nooit twee ketenlocks tegelijk worden vastgehouden.
        await lockAuditChains(tx, [dossier.id])
        return n
      })

      let verwijderd = 0
      for (const key of keys) {
        await store
          .remove(key)
          .then(() => {
            verwijderd += 1
          })
          .catch((e) => console.error(`[bewaartermijn] bestand ${key} niet verwijderd`, e))
      }

      await writeAudit({
        type: 'BEWAARTERMIJN_OPGERUIMD',
        message: `dossier "${dossier.title}" volledig verwijderd na zeven jaar`,
        metadata: {
          fase: 'dossier',
          dossierId: dossier.id,
          auditRegels: auditCount,
          documenten: dossier.documents.length,
          laatsteHash: laatste?.hash ?? null,
          sleutels: perSoort,
          blobsVerwijderd: verwijderd,
          blobsTotaal: keys.length
        }
      })
      result.dossiersVerwijderd += 1
      result.documents += dossier.documents.length
      result.auditEvents += auditCount
    } catch (e) {
      result.skipped.push({ dossierId: dossier.id, reason: (e as Error).message })
      console.error(`[bewaartermijn] dossier ${dossier.id} niet verwijderd`, e)
    }
  }

  return result
}

export interface RetentionStatus {
  /** Ondertekend, afgevinkt, en de bestanden mogen weg. */
  blobsDue: number
  /** Ondertekend maar NIET afgevinkt: die blijven staan tot iemand ze afvinkt. */
  wachtOpArchivering: number
  /** Van die groep: hoe lang staat de oudste er al? */
  oudsteWachtDagen: number | null
  /** Dossiers waarvan de zevenjaarstermijn is verstreken. */
  dossiersDue: number
  next: Date | null
}

/** Wat staat er te wachten? Voor het dashboard en de beheerpagina. */
export async function retentionStatus(now = new Date()): Promise<RetentionStatus> {
  const blobGrens = new Date(now.getTime() - blobBewaardagen() * 86_400_000)
  const [blobsDue, wachtOpArchivering, oudste, dossiersDue, nextRow] = await Promise.all([
    prisma.dossier.count({ where: { status: 'ONDERTEKEND', archivedAt: { not: null, lt: blobGrens } } }),
    prisma.dossier.count({ where: { status: 'ONDERTEKEND', archivedAt: null } }),
    prisma.dossier.findFirst({
      where: { status: 'ONDERTEKEND', archivedAt: null },
      orderBy: { completedAt: 'asc' },
      select: { completedAt: true }
    }),
    prisma.dossier.count({ where: { retentionUntil: { not: null, lt: now } } }),
    prisma.dossier.findFirst({
      where: { retentionUntil: { not: null, gte: now } },
      orderBy: { retentionUntil: 'asc' },
      select: { retentionUntil: true }
    })
  ])
  const oudsteWachtDagen = oudste?.completedAt
    ? Math.floor((now.getTime() - oudste.completedAt.getTime()) / 86_400_000)
    : null
  return { blobsDue, wachtOpArchivering, oudsteWachtDagen, dossiersDue, next: nextRow?.retentionUntil ?? null }
}

/**
 * Zet het archiveervinkje. Alleen op een afgerond dossier: vóór die tijd is er niets
 * om te archiveren.
 */
export async function markArchived(input: {
  dossierId: string
  accountantId: string
  note?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: input.dossierId },
    select: { status: true, archivedAt: true, title: true }
  })
  if (!dossier) return { ok: false, error: 'Dossier niet gevonden.' }
  if (dossier.status !== 'ONDERTEKEND') {
    return { ok: false, error: 'Alleen een afgerond dossier is te archiveren.' }
  }
  if (dossier.archivedAt) return { ok: true }

  const archivedAt = new Date()
  await prisma.dossier.update({
    where: { id: input.dossierId },
    data: { archivedAt, archivedById: input.accountantId, archivedNote: input.note?.slice(0, 500) || null }
  })
  await writeAudit({
    type: 'GEARCHIVEERD',
    dossierId: input.dossierId,
    accountantId: input.accountantId,
    message:
      `handmatig gearchiveerd${input.note ? ` in ${input.note.slice(0, 200)}` : ''}; ` +
      `de documentbestanden in het portaal verdwijnen ${blobBewaardagen()} dagen na nu`,
    metadata: { archivedAt: archivedAt.toISOString(), map: input.note ?? null, blobBewaardagen: blobBewaardagen() }
  })
  return { ok: true }
}

/** Draait het archiveervinkje terug (vergissing). Blobs zijn dan nog niet weg. */
export async function unmarkArchived(input: {
  dossierId: string
  accountantId: string
}): Promise<{ ok: boolean; error?: string }> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: input.dossierId },
    select: { archivedAt: true, documents: { select: { sealedKey: true } } }
  })
  if (!dossier) return { ok: false, error: 'Dossier niet gevonden.' }
  if (!dossier.archivedAt) return { ok: true }
  // Zijn de bestanden al weg, dan verandert terugdraaien niets meer aan de inhoud;
  // wel eerlijk melden in plaats van een vinkje dat suggereert dat het stuk er nog is.
  const nogBestanden = dossier.documents.some((d) => !!d.sealedKey)
  await prisma.dossier.update({
    where: { id: input.dossierId },
    data: { archivedAt: null, archivedById: null, archivedNote: null }
  })
  await writeAudit({
    type: 'GEARCHIVEERD',
    dossierId: input.dossierId,
    accountantId: input.accountantId,
    message: nogBestanden
      ? 'archiveervinkje teruggedraaid'
      : 'archiveervinkje teruggedraaid, maar de documentbestanden waren al opgeruimd',
    metadata: { teruggedraaid: true, bestandenAanwezig: nogBestanden }
  })
  return { ok: true }
}
