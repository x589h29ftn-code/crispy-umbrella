import 'server-only'
import type { Dossier, Recipient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { hashSigningToken, generateSigningToken } from '@/lib/auth/signingToken'
import { storage } from '@/lib/storage'
import { stampSignatureImage } from '@/lib/pdf/signing'
import { sealDocument } from '@/lib/pdf/seal'
import { sealEnabled, sealPdf, sha256Hex, SealRetryableError } from '@/lib/seal/sealer'
import { enqueueOnce } from '@/lib/jobs/queue'
import { recomputeStatus } from '@/lib/status'
import { writeAudit } from '@/lib/audit'
import { sendMail } from '@/lib/email/transport'
import { requestEmail, completedEmail, officeTurnEmail } from '@/lib/email/templates'
import { renderTemplate, firstNameFrom } from '@/lib/docanalyze/templates'
import { archiveDossier, archiveEnabled, buildDefaultFolder } from '@/lib/archive'
import { getProfessionalSigner, accountantCanQualifiedSign, type ProfessionalSigner } from '@/lib/signing-provider'

/** Datum/tijd voor het zichtbare stempel, bijv. "23-9-2020 14:04:44". */
function formatStampDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export type ResolveResult =
  | { ok: true; recipient: Recipient; dossier: Dossier }
  | { ok: false; reason: 'onbekend' | 'verlopen' | 'gebruikt' | 'afgerond' }

/** Zoekt de externe ontvanger bij een ruwe tekentoken en valideert geldigheid. */
export async function resolveToken(raw: string): Promise<ResolveResult> {
  if (!raw || raw.length < 10) return { ok: false, reason: 'onbekend' }
  const recipient = await prisma.recipient.findUnique({
    where: { tokenHash: hashSigningToken(raw) },
    include: { dossier: true }
  })
  if (!recipient || !recipient.tokenHash) return { ok: false, reason: 'onbekend' }
  if (recipient.tokenUsedAt || recipient.status !== 'PENDING') return { ok: false, reason: 'gebruikt' }
  if (!recipient.tokenExpiresAt || recipient.tokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'verlopen' }
  }
  const { dossier } = recipient
  if (!['VERZONDEN', 'GEDEELTELIJK'].includes(dossier.status)) return { ok: false, reason: 'afgerond' }
  return { ok: true, recipient, dossier }
}

// ---- Workflow: activeren en doorschuiven ----

/**
 * Activeert één ondertekenaar: een externe cliënt krijgt een tekentoken +
 * e-mail met de link; een kantoorgebruiker krijgt een melding dat het document
 * in het portaal op zijn handtekening wacht.
 */
export async function activateSigner(recipientId: string): Promise<void> {
  const r = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: {
      client: true,
      dossier: { include: { owner: true, documents: { orderBy: { order: 'asc' }, take: 1, select: { detectedYear: true } } } }
    }
  })
  if (!r) return
  const dossier = r.dossier

  if (r.role === 'ZELF' && r.accountantId) {
    // Kantoorgebruiker: tekent ingelogd in het portaal.
    const mail = officeTurnEmail({
      recipientName: r.name,
      documentTitle: dossier.title,
      url: `${env.APP_URL}/te-ondertekenen`
    })
    await sendMail({ to: r.email, ...mail }).catch((e) => console.error('[activate office mail]', e))
    await writeAudit({ type: 'VERZONDEN', dossierId: dossier.id, recipientId: r.id, message: `${r.email} (kantoor)` })
    return
  }

  // Externe cliënt: eenmalige token + uitnodigingsmail met de link.
  const ttlMs = dossier.linkTtlDays * 24 * 60 * 60 * 1000
  const { raw, hash } = generateSigningToken()
  await prisma.recipient.update({
    where: { id: r.id },
    data: {
      tokenHash: hash,
      tokenExpiresAt: new Date(Date.now() + ttlMs),
      tokenUsedAt: null,
      // Nieuwe link ⇒ 2e factor opnieuw vereist.
      otpVerifiedAt: null,
      otpHash: null,
      otpExpiresAt: null
    }
  })
  // Vul de invulvelden in het begeleidend bericht in voor deze ontvanger.
  const resolvedMessage = dossier.message
    ? renderTemplate(dossier.message, {
        voornaamKlant: firstNameFrom(r.client?.firstName, r.client?.contactName) ?? r.name,
        bedrijfsnaam: r.client?.companyName ?? r.client?.displayName ?? null,
        boekjaar: dossier.documents[0]?.detectedYear ?? null,
        documenttitel: dossier.title,
        voornaamAfzender: firstNameFrom(dossier.owner.name) ?? dossier.owner.name
      })
    : null

  const mail = requestEmail({
    recipientName: r.name,
    senderName: dossier.owner.name,
    documentTitle: dossier.title,
    url: `${env.APP_URL}/teken/${raw}`,
    message: resolvedMessage
  })
  // Het message-id vastleggen zodat de bezorgstatus (afgeleverd/bounce) later aan
  // deze ontvanger gekoppeld kan worden.
  try {
    const sent = await sendMail({ to: r.email, ...mail })
    await prisma.recipient.update({
      where: { id: r.id },
      data: {
        mailMessageId: sent.messageId,
        mailStatus: 'SENT',
        mailStatusAt: new Date(),
        mailBounceType: null,
        mailBounceReason: null
      }
    })
  } catch (e) {
    console.error('[activate client mail]', e)
    await prisma.recipient.update({
      where: { id: r.id },
      data: { mailStatus: 'FAILED', mailStatusAt: new Date(), mailBounceReason: (e as Error).message.slice(0, 500) }
    })
  }
  await writeAudit({ type: 'VERZONDEN', dossierId: dossier.id, recipientId: r.id, message: r.email })
}

/** Activeert bij het versturen: sequentieel de eerste, parallel iedereen. */
export async function activateInitial(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: { recipients: { orderBy: { order: 'asc' } } }
  })
  if (!dossier) return
  const pending = dossier.recipients.filter((r) => r.status === 'PENDING')
  if (pending.length === 0) return
  if (dossier.signingMode === 'SEQUENTIAL') {
    await activateSigner(pending[0].id)
  } else {
    for (const r of pending) await activateSigner(r.id)
  }
}

/** Geeft de ondertekenaar(s) die nu aan de beurt zijn. */
export function currentSigners<T extends { status: string; order: number }>(dossier: { signingMode: string }, recipients: T[]): T[] {
  const pending = recipients.filter((r) => r.status === 'PENDING').sort((a, b) => a.order - b.order)
  if (pending.length === 0) return []
  return dossier.signingMode === 'SEQUENTIAL' ? [pending[0]] : pending
}

/** Verwerkt de handtekening van één ondertekenaar en schuift de workflow door. */
export async function applySignature(
  recipientId: string,
  signatureDataUrl: string,
  ctx: { ip?: string; userAgent?: string }
): Promise<void> {
  const recipient = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: { dossier: true, fields: { include: { document: true } } }
  })
  if (!recipient) throw new Error('Ontvanger niet gevonden')
  const dossier = recipient.dossier

  const store = storage()
  const signedAt = new Date()
  const label = { name: recipient.name, dateText: formatStampDate(signedAt) }

  // Kantoorondertekenaar met ingeschakeld beroepscertificaat? Dan zetten we
  // daarnaast een gekwalificeerde PAdES-handtekening (via de provider). Staat
  // de driver op 'none' (standaard), dan blijft dit null en verandert er niets.
  let qualified: { signer: ProfessionalSigner; title: string | null; credentialId: string | null } | null = null
  if (recipient.role === 'ZELF' && recipient.accountantId) {
    const acc = await prisma.accountant.findUnique({ where: { id: recipient.accountantId } })
    if (acc && accountantCanQualifiedSign(acc)) {
      const signer = await getProfessionalSigner()
      if (signer) qualified = { signer, title: acc.professionalTitle, credentialId: acc.signingCredentialId }
    }
  }
  let qualifiedError: string | null = null

  // Groepeer de velden per document en stempel de handtekening in elk document.
  const byDoc = new Map<string, typeof recipient.fields>()
  for (const f of recipient.fields) {
    const arr = byDoc.get(f.documentId) ?? []
    arr.push(f)
    byDoc.set(f.documentId, arr)
  }
  for (const [documentId, fields] of byDoc) {
    const doc = fields[0].document
    if (!doc.workingKey) continue
    let bytes = await store.get(doc.workingKey)
    for (const f of fields) {
      bytes = Buffer.from(
        await stampSignatureImage(bytes, { page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }, signatureDataUrl, label)
      )
    }
    // Gekwalificeerd (mede)ondertekenen. Best-effort: mislukt de provider, dan
    // blijft het zichtbare stempel staan en leggen we de fout vast in het
    // auditspoor (het ondertekenen in het portaal mag nooit klappen).
    if (qualified) {
      try {
        bytes = Buffer.from(
          await qualified.signer.signPdf({
            pdfBytes: bytes,
            signer: { name: recipient.name, professionalTitle: qualified.title, credentialId: qualified.credentialId },
            reason: 'Ondertekend door de accountant op persoonlijke titel',
            location: 'Otto Visser & Partners'
          })
        )
      } catch (e) {
        qualifiedError = (e as Error).message
        console.error('[gekwalificeerd ondertekenen]', e)
      }
    }
    const newKey = await store.put(bytes, 'pdf')
    await store.remove(doc.workingKey)
    await prisma.document.update({ where: { id: documentId }, data: { workingKey: newKey } })
  }
  if (qualified) {
    await writeAudit({
      type: 'GEKWALIFICEERD_ONDERTEKEND',
      dossierId: dossier.id,
      recipientId,
      accountantId: recipient.accountantId ?? undefined,
      message: qualifiedError ? `mislukt: ${qualifiedError}` : `${qualified.signer.id} (${qualified.title ?? 'accountant'})`,
      ...ctx
    })
  }

  await prisma.$transaction([
    prisma.signatureField.updateMany({ where: { recipientId }, data: { filled: true } }),
    prisma.recipient.update({
      where: { id: recipientId },
      data: { status: 'SIGNED', signedAt, tokenUsedAt: signedAt }
    })
  ])
  await writeAudit({
    type: 'ONDERTEKEND',
    dossierId: dossier.id,
    recipientId,
    message: recipient.email,
    ip: ctx.ip,
    userAgent: ctx.userAgent
  })

  await advanceWorkflow(dossier.id)
}

/** Zet DECLINED en werkt de workflow bij. */
export async function declineSignature(
  recipientId: string,
  reason: string | undefined,
  ctx: { ip?: string; userAgent?: string }
): Promise<void> {
  const recipient = await prisma.recipient.findUnique({ where: { id: recipientId } })
  if (!recipient) return
  await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: 'DECLINED', declinedReason: reason || null, tokenUsedAt: new Date() }
  })
  await writeAudit({ type: 'GEWEIGERD', dossierId: recipient.dossierId, recipientId, message: reason || undefined, ...ctx })
  await advanceWorkflow(recipient.dossierId)
}

/**
 * Herberekent de status, activeert bij sequentieel de volgende ondertekenaar,
 * en verzegelt + mailt zodra iedereen getekend heeft.
 */
export async function advanceWorkflow(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: { recipients: { orderBy: { order: 'asc' } }, owner: true }
  })
  if (!dossier) return

  const status = recomputeStatus(dossier.status, dossier.recipients)
  if (status === 'GEWEIGERD') {
    await prisma.dossier.update({ where: { id: dossierId }, data: { status } })
    // Verzender op de hoogte stellen.
    await sendMail({
      to: dossier.owner.email,
      subject: `Ondertekening geweigerd: ${dossier.title}`,
      text: `Een ontvanger heeft geweigerd het document "${dossier.title}" te ondertekenen.`,
      html: `<p>Een ontvanger heeft geweigerd het document <strong>${dossier.title}</strong> te ondertekenen.</p>`
    }).catch(() => {})
    return
  }

  const stillPending = dossier.recipients.filter((r) => r.status === 'PENDING')
  if (stillPending.length === 0) {
    await finalize(dossierId)
    return
  }

  await prisma.dossier.update({ where: { id: dossierId }, data: { status } })

  // Sequentieel: activeer de volgende die nog niet geactiveerd is.
  if (dossier.signingMode === 'SEQUENTIAL') {
    const next = stillPending[0]
    const alreadyActivated = next.role === 'ZELF' ? false : !!next.tokenHash
    // Voor kantoorgebruikers bepalen we 'reeds genotificeerd' aan de hand van
    // een eerder VERZONDEN-auditregel.
    const officeNotified =
      next.role === 'ZELF' &&
      (await prisma.auditEvent.count({ where: { dossierId, recipientId: next.id, type: 'VERZONDEN' } })) > 0
    if (!alreadyActivated && !officeNotified) {
      await activateSigner(next.id)
    }
  }
}

/** Verzegelt elk document en verstuurt de kopieën. */
async function finalize(dossierId: string): Promise<void> {
  await sealAndComplete(dossierId)
}

/**
 * Bouwt per document het pre-seal-artefact: auditcertificaat erachter en
 * platgeslagen. Idempotent — bestaat `preSealKey` al (bijvoorbeeld na een
 * mislukte verzegeling), dan wordt de auditpagina niet nóg een keer toegevoegd.
 */
async function buildPreSealArtifacts(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: {
      recipients: { orderBy: { order: 'asc' } },
      documents: { orderBy: { order: 'asc' } }
    }
  })
  if (!dossier) return
  const store = storage()
  const signers = dossier.recipients.map((r) => ({
    name: r.name,
    email: r.email,
    signedAt: r.signedAt,
    otpVerifiedAt: r.otpVerifiedAt,
    presentedHashes: (r.presentedHashes ?? null) as Record<string, string> | null,
    consentTextSnapshot: r.consentTextSnapshot,
    consentShownAt: r.consentShownAt
  }))

  for (const doc of dossier.documents) {
    if (doc.preSealKey || !doc.workingKey) continue
    const working = await store.get(doc.workingKey)
    // Stap 3+4: auditcertificaat toevoegen en plat slaan.
    const { sealedBytes, sha256 } = await sealDocument({
      pdfBytes: working,
      dossierTitle: doc.title,
      dossierId: dossier.id,
      documentId: doc.id,
      signers
    })
    // Stap 5: hash over precies deze bytes, vlak vóór het zegel.
    const preSealKey = await store.put(sealedBytes, 'pdf')
    await prisma.document.update({
      where: { id: doc.id },
      data: { preSealKey, preSealSha256: sha256Hex(sealedBytes), documentSha256: sha256 }
    })
  }
}

export interface SealOutcome {
  ok: boolean
  error?: string
  retryable?: boolean
}

/**
 * Wacht dit dossier op een gekwalificeerde handtekening waarvoor de accountant
 * zelf moet autoriseren? Alleen bij providers met een gebruikersronde; bij
 * 'digidentity' tekent de server zelf en is er niets om op te wachten.
 */
function awaitsQualifiedSignature(owner: { signingCertEnabled: boolean; signingCredentialId: string | null }): boolean {
  return env.PROFESSIONAL_SIGNING_DRIVER === 'cleverbase' && owner.signingCertEnabled && !!owner.signingCredentialId
}

/**
 * Rondt af nadat de accountant zijn gekwalificeerde handtekening heeft gezet.
 * De documenten hebben dan al een sealedKey; afhankelijk van de instelling komt
 * er nog een organisatiezegel bij.
 */
export async function completeAfterQualifiedSigning(dossierId: string): Promise<SealOutcome> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { status: true } })
  if (!dossier) return { ok: false, error: 'dossier niet gevonden', retryable: false }
  if (dossier.status === 'ONDERTEKEND') return { ok: true }

  // Nog niet alles ondertekend? Dan blijft het dossier wachten.
  const open = await prisma.document.count({ where: { dossierId, preSealKey: { not: null }, sealedKey: null } })
  if (open > 0) return { ok: true }

  // Een tweede handtekening (het organisatiezegel) is niet verkeerd, maar wel
  // meer techniek en meer uitleg. Standaard slaan we hem over als er al een
  // gekwalificeerde handtekening staat; SEAL_WHEN_QUALIFIED_PRESENT zet hem aan.
  if (sealEnabled() && env.SEAL_WHEN_QUALIFIED_PRESENT) {
    const outcome = await applySealsOnTop(dossierId)
    if (!outcome.ok) {
      await prisma.dossier.update({ where: { id: dossierId }, data: { status: 'SEALING_FAILED' } })
      await writeAudit({
        type: 'VERZEGELING_MISLUKT',
        dossierId,
        message: outcome.error?.slice(0, 500),
        metadata: { retryable: outcome.retryable ?? false, naWaarmerk: true }
      })
      if (outcome.retryable) await enqueueOnce('SEAL_RETRY', dossierId, { dossierId }, { maxAttempts: 12 })
      return outcome
    }
  }

  await completeDossier(dossierId)
  return { ok: true }
}

/**
 * Zet het organisatiezegel als incrementele update bovenop een document dat al
 * gekwalificeerd is ondertekend. Beide handtekeningen blijven geldig omdat de
 * tweede de ByteRange van de eerste niet aantast.
 */
async function applySealsOnTop(dossierId: string): Promise<SealOutcome> {
  const documents = await prisma.document.findMany({ where: { dossierId }, orderBy: { order: 'asc' } })
  const store = storage()
  for (const doc of documents) {
    if (!doc.sealedKey) continue
    const current = await store.get(doc.sealedKey)
    try {
      const result = await sealPdf({
        pdfBytes: current,
        appearanceText: 'Verzegeld door Otto Visser & Partners Accountants'
      })
      const newKey = await store.put(result.sealedBytes, 'pdf')
      await store.remove(doc.sealedKey).catch(() => {})
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          sealedKey: newKey,
          sealedSha256: result.sealedSha256,
          sealedAt: new Date(),
          timestampedAt: result.timestampedAt,
          sealCertSerial: result.certSerial,
          sealTsaUrl: result.tsaUrl
        }
      })
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: e instanceof SealRetryableError }
    }
  }
  return { ok: true }
}

/**
 * Stap 6+7: verzegelt elk document één keer cryptografisch en legt de
 * zegelgegevens vast. Fail-closed: lukt het niet, dan is de uitkomst niet ok en
 * wordt er niets afgerond.
 *
 * Staat `SEAL_MODE` op 'none', dan wordt het pre-seal-artefact één-op-één de
 * definitieve versie (huidig gedrag: zichtbare stempels + auditcertificaat,
 * zonder cryptografisch zegel).
 */
async function applySeals(dossierId: string): Promise<SealOutcome> {
  const documents = await prisma.document.findMany({
    where: { dossierId },
    orderBy: { order: 'asc' }
  })
  const store = storage()

  for (const doc of documents) {
    // Idempotent: al verzegeld? Dan overslaan (nooit twee keer verzegelen).
    if (doc.sealedKey && doc.sealedSha256) continue
    if (!doc.preSealKey) continue
    const preSeal = await store.get(doc.preSealKey)

    if (!sealEnabled()) {
      const sealedKey = await store.put(preSeal, 'pdf')
      await prisma.document.update({
        where: { id: doc.id },
        data: { sealedKey, sealedSha256: sha256Hex(preSeal), sealedAt: new Date() }
      })
      continue
    }

    try {
      const result = await sealPdf({
        pdfBytes: preSeal,
        appearanceText: 'Verzegeld door Otto Visser & Partners Accountants'
      })
      const sealedKey = await store.put(result.sealedBytes, 'pdf')
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          sealedKey,
          sealedSha256: result.sealedSha256,
          sealedAt: new Date(),
          timestampedAt: result.timestampedAt,
          sealCertSerial: result.certSerial,
          sealTsaUrl: result.tsaUrl
        }
      })
    } catch (e) {
      const retryable = e instanceof SealRetryableError
      return { ok: false, error: (e as Error).message, retryable }
    }
  }
  return { ok: true }
}

/**
 * Verzegelt en rondt af. Wordt aangeroepen zodra iedereen heeft getekend én
 * door de SEAL_RETRY-job. Idempotent: een al afgerond dossier doet niets.
 */
export async function sealAndComplete(dossierId: string): Promise<SealOutcome> {
  const current = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { status: true, owner: { select: { signingCertEnabled: true, signingCredentialId: true } } }
  })
  if (!current) return { ok: false, error: 'dossier niet gevonden', retryable: false }
  if (current.status === 'ONDERTEKEND') return { ok: true }

  await buildPreSealArtifacts(dossierId)

  // Moet de accountant er nog een gekwalificeerde handtekening op zetten? Dan
  // stopt het hier: hij autoriseert dat zelf (pincode in de app van de provider).
  // De handtekening komt ná het auditcertificaat, want daarna mag het bestand
  // niet meer worden bewerkt.
  if (awaitsQualifiedSignature(current.owner)) {
    await prisma.dossier.update({ where: { id: dossierId }, data: { status: 'WACHT_OP_WAARMERK' } })
    return { ok: true }
  }

  const outcome = await applySeals(dossierId)

  if (!outcome.ok) {
    // Fail-closed: geen voltooiingsmail, dossier wacht zichtbaar op verzegeling.
    await prisma.dossier.update({ where: { id: dossierId }, data: { status: 'SEALING_FAILED' } })
    await writeAudit({
      type: 'VERZEGELING_MISLUKT',
      dossierId,
      message: outcome.error?.slice(0, 500),
      metadata: { retryable: outcome.retryable ?? false }
    })
    if (outcome.retryable) {
      await enqueueOnce('SEAL_RETRY', dossierId, { dossierId }, { maxAttempts: 12 })
    }
    return outcome
  }

  await completeDossier(dossierId)
  return { ok: true }
}

/** Stap 8: status, archief en voltooiingsmails. Vanaf hier is het bestand read-only. */
async function completeDossier(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: {
      recipients: { orderBy: { order: 'asc' }, include: { client: true } },
      owner: true,
      documents: { orderBy: { order: 'asc' } }
    }
  })
  if (!dossier) return

  const store = storage()
  const attachments: { filename: string; content: Buffer }[] = []
  const hashes: Record<string, { preSeal: string | null; sealed: string | null; timestampedAt: string | null }> = {}
  for (const doc of dossier.documents) {
    if (!doc.sealedKey) continue
    // Verbatim: exact de verzegelde bytes, niet opnieuw gegenereerd.
    const sealed = await store.get(doc.sealedKey)
    attachments.push({ filename: doc.fileName, content: Buffer.from(sealed) })
    hashes[doc.title] = {
      preSeal: doc.preSealSha256,
      sealed: doc.sealedSha256,
      timestampedAt: doc.timestampedAt?.toISOString() ?? null
    }
  }

  const completedAt = new Date()
  // Bewaartermijn: zeven jaar, gelijk aan de dossierbewaartermijn.
  const retentionUntil = new Date(completedAt)
  retentionUntil.setFullYear(retentionUntil.getFullYear() + 7)
  await prisma.dossier.update({
    where: { id: dossierId },
    data: { status: 'ONDERTEKEND', completedAt, retentionUntil }
  })
  await writeAudit({ type: 'VERZEGELD', dossierId, metadata: { hashes, sealed: sealEnabled() } })

  // Getekende stukken automatisch in de klantmap zetten (indien ingesteld).
  if (archiveEnabled() && attachments.length > 0) {
    const clientRec = dossier.recipients.find((r) => r.client)
    const client = clientRec?.client
    const year = dossier.documents.map((d) => d.detectedYear).find((y) => y != null) ?? null
    // Dossier-override wint; anders klantmap + boekjaar als submap.
    const folder =
      dossier.archiveFolder?.trim() ||
      buildDefaultFolder({
        clientBaseFolder: client?.archiveFolder ?? null,
        clientName: client?.displayName ?? clientRec?.name ?? dossier.title,
        clientNumber: client?.clientNumber ?? null,
        year
      })
    try {
      const res = await archiveDossier({ folder, files: attachments })
      await writeAudit({ type: 'GEARCHIVEERD', dossierId, message: `${res.archived} bestand(en) naar ${res.driver}`, metadata: { target: res.target } })
    } catch (e) {
      console.error('[finalize archief]', e)
      await writeAudit({ type: 'GEARCHIVEERD', dossierId, message: `mislukt: ${(e as Error).message}` })
    }
  }

  const targets = [
    ...(dossier.sendCopyToRecipient ? dossier.recipients.map((r) => ({ name: r.name, email: r.email })) : []),
    { name: dossier.owner.name, email: dossier.owner.email }
  ]
  // Dedupe op e-mailadres (eigenaar kan ook ondertekenaar zijn).
  const seen = new Set<string>()
  for (const t of targets) {
    if (seen.has(t.email.toLowerCase())) continue
    seen.add(t.email.toLowerCase())
    const mail = completedEmail({ recipientName: t.name, documentTitle: dossier.title })
    await sendMail({ to: t.email, ...mail, attachments }).catch((e) => console.error('[finalize mail]', e))
  }
}
