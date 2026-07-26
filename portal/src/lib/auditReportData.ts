import 'server-only'
import { prisma } from '@/lib/db'
import { chainHash } from '@/lib/audit'
import { ASSURANCE_LABEL, ASSURANCE_UITLEG } from '@/lib/assurance'
import { buildAuditReport } from '@/lib/pdf/auditReport'

// Haalt alles bij elkaar wat in het auditrapport hoort en maakt het PDF.
//
// Apart van de opmaak: die weet niets van de database, deze weet niets van
// pdf-lib. Dat maakt het rapport te testen zonder een PDF te hoeven ontleden.

export interface AuditReportUitkomst {
  bytes: Uint8Array
  sha256: string
  gebeurtenissen: number
  chainOk: boolean
}

/**
 * Loopt de hashketen van dít dossier na.
 *
 * Bewust niet `verifyAuditChain()`: die controleert alle ketens en zou op het
 * rapport van dossier A melden dat er iets mis is in dossier B. Dat is misleidend
 * — het zegt niets over dit stuk — en het maakt het rapport afhankelijk van de
 * toestand van niet-verwante dossiers.
 */
function controleerKeten(
  rows: { id: string; type: string; createdAt: Date; message: string | null; metadata: unknown; hash: string | null; prevHash: string | null; dossierId: string | null; recipientId: string | null; seq: bigint }[]
): { ok: boolean; detail: string | null } {
  let vorige: string | null = null
  for (const [i, r] of rows.entries()) {
    if (i === 0 && r.prevHash !== null) {
      return { ok: false, detail: `De eerste regel (#${r.seq}) verwijst naar een voorganger die er niet is.` }
    }
    if (i > 0 && r.prevHash !== vorige) {
      return { ok: false, detail: `Regel #${r.seq} (${r.type}) sluit niet aan op de voorgaande regel.` }
    }
    const verwacht = chainHash({
      prevHash: r.prevHash,
      type: r.type,
      dossierId: r.dossierId,
      recipientId: r.recipientId,
      message: r.message,
      metadata: r.metadata,
      createdAt: r.createdAt
    })
    if (r.hash !== verwacht) {
      return { ok: false, detail: `De inhoud van regel #${r.seq} (${r.type}) wijkt af van zijn eigen vingerafdruk.` }
    }
    vorige = r.hash
  }
  // Gaten in de nummering: de keten alleen laat het verwijderen van de OUDSTE
  // regels ongemerkt, want dan is er geen volgende regel die niet meer aansluit.
  if (rows.length > 1) {
    const eerste = rows[0].seq
    const laatste = rows[rows.length - 1].seq
    const verwachtAantal = Number(laatste - eerste) + 1
    if (verwachtAantal !== rows.length) {
      return {
        ok: false,
        detail:
          `De volgnummers lopen van ${eerste} tot ${laatste}, dat zijn ${verwachtAantal} regels, ` +
          `maar er staan er ${rows.length}. Er is dus een regel verdwenen.`
      }
    }
  }
  return { ok: true, detail: null }
}

/** Maakt het auditrapport voor dit dossier. Geeft null als het dossier weg is. */
export async function buildAuditReportFor(dossierId: string): Promise<AuditReportUitkomst | null> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: {
      owner: { select: { name: true, email: true } },
      recipients: { orderBy: { order: 'asc' }, include: { client: { select: { displayName: true } } } },
      documents: { orderBy: { order: 'asc' } }
    }
  })
  if (!dossier) return null

  const rows = await prisma.auditEvent.findMany({
    where: { dossierId },
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      seq: true,
      type: true,
      createdAt: true,
      message: true,
      metadata: true,
      ipAddress: true,
      userAgent: true,
      hash: true,
      prevHash: true,
      dossierId: true,
      recipientId: true,
      accountant: { select: { name: true } }
    }
  })

  const keten = controleerKeten(rows)

  // Namen erbij zodat een regel leesbaar is zonder id's te hoeven opzoeken.
  const naamVan = new Map(dossier.recipients.map((r) => [r.id, r.name]))

  const rapport = await buildAuditReport({
    dossierTitle: dossier.title,
    dossierId: dossier.id,
    status: dossier.status,
    assuranceLevel: dossier.assuranceLevel,
    assuranceLabel: ASSURANCE_LABEL[dossier.assuranceLevel],
    assuranceUitleg: ASSURANCE_UITLEG[dossier.assuranceLevel],
    ownerName: dossier.owner.name,
    ownerEmail: dossier.owner.email,
    createdAt: dossier.createdAt,
    sentAt: dossier.sentAt,
    completedAt: dossier.completedAt,
    expiresAt: dossier.expiresAt,
    signingMode: dossier.signingMode,
    signers: dossier.recipients.map((r) => ({
      name: r.name,
      email: r.email,
      phone: r.phone,
      role: r.role,
      order: r.order,
      status: r.status,
      verificationMethod: r.verificationMethod,
      clientName: r.client?.displayName ?? null,
      // Uit het auditspoor, want daar staat het IP en het apparaat.
      sentAt: rows.find((e) => e.recipientId === r.id && e.type === 'VERZONDEN')?.createdAt ?? null,
      openedAt: rows.find((e) => e.recipientId === r.id && e.type === 'GEOPEND')?.createdAt ?? null,
      otpVerifiedAt: r.otpVerifiedAt,
      reauthVerifiedAt: r.reauthVerifiedAt,
      signedAt: r.signedAt,
      declinedReason: r.declinedReason,
      ip: [...rows].reverse().find((e) => e.recipientId === r.id && e.type === 'ONDERTEKEND')?.ipAddress ?? null,
      userAgent: [...rows].reverse().find((e) => e.recipientId === r.id && e.type === 'ONDERTEKEND')?.userAgent ?? null,
      mailStatus: r.mailStatus,
      mailStatusAt: r.mailStatusAt,
      mailBounceReason: r.mailBounceReason,
      remindersSentTo: rows.filter((e) => e.recipientId === r.id && e.type === 'HERINNERD').length,
      consentTextSnapshot: r.consentTextSnapshot,
      consentTextHash: r.consentTextHash,
      consentShownAt: r.consentShownAt,
      presentedHashes: (r.presentedHashes ?? null) as Record<string, string> | null
    })),
    documents: dossier.documents.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      pages: null,
      detectedKind: d.detectedKind,
      detectedYear: d.detectedYear,
      ocrUsed: d.ocrUsed,
      documentSha256: d.documentSha256,
      preSealSha256: d.preSealSha256,
      sealedSha256: d.sealedSha256,
      sealStage: d.sealStage,
      sealedAt: d.sealedAt,
      timestampedAt: d.timestampedAt,
      sealCertSerial: d.sealCertSerial,
      sealTsaUrl: d.sealTsaUrl
    })),
    events: rows.map((e) => ({
      seq: e.seq.toString(),
      type: e.type,
      createdAt: e.createdAt,
      message: e.message,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      metadata: e.metadata,
      hash: e.hash,
      prevHash: e.prevHash,
      actor: e.accountant?.name ?? (e.recipientId ? naamVan.get(e.recipientId) ?? null : null)
    })),
    chainOk: keten.ok,
    chainDetail: keten.detail
  })

  return { ...rapport, gebeurtenissen: rows.length, chainOk: keten.ok }
}
