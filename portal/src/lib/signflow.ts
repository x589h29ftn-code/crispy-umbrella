import 'server-only'
import type { Dossier, Recipient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { hashSigningToken, generateSigningToken } from '@/lib/auth/signingToken'
import { storage } from '@/lib/storage'
import { stampSignatureImage } from '@/lib/pdf/signing'
import { sealDocument } from '@/lib/pdf/seal'
import { recomputeStatus } from '@/lib/status'
import { writeAudit } from '@/lib/audit'
import { sendMail } from '@/lib/email/transport'
import { requestEmail, completedEmail, officeTurnEmail } from '@/lib/email/templates'

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
  const r = await prisma.recipient.findUnique({ where: { id: recipientId }, include: { dossier: { include: { owner: true } } } })
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
  const mail = requestEmail({
    recipientName: r.name,
    senderName: dossier.owner.name,
    documentTitle: dossier.title,
    url: `${env.APP_URL}/teken/${raw}`,
    message: dossier.message
  })
  await sendMail({ to: r.email, ...mail }).catch((e) => console.error('[activate client mail]', e))
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
        await stampSignatureImage(bytes, { page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }, signatureDataUrl)
      )
    }
    const newKey = await store.put(bytes, 'pdf')
    await store.remove(doc.workingKey)
    await prisma.document.update({ where: { id: documentId }, data: { workingKey: newKey } })
  }

  await prisma.$transaction([
    prisma.signatureField.updateMany({ where: { recipientId }, data: { filled: true } }),
    prisma.recipient.update({
      where: { id: recipientId },
      data: { status: 'SIGNED', signedAt: new Date(), tokenUsedAt: new Date() }
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
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: { recipients: { orderBy: { order: 'asc' } }, owner: true, documents: { orderBy: { order: 'asc' } } }
  })
  if (!dossier) return
  if (dossier.status === 'ONDERTEKEND') return

  const store = storage()
  const signers = dossier.recipients.map((r) => ({
    name: r.name,
    email: r.email,
    signedAt: r.signedAt,
    otpVerifiedAt: r.otpVerifiedAt
  }))
  const attachments: { filename: string; content: Buffer }[] = []
  const hashes: Record<string, string> = {}
  for (const doc of dossier.documents) {
    if (!doc.workingKey) continue
    const working = await store.get(doc.workingKey)
    const { sealedBytes, sha256 } = await sealDocument({
      pdfBytes: working,
      dossierTitle: doc.title,
      dossierId: dossier.id,
      signers
    })
    const sealedKey = await store.put(sealedBytes, 'pdf')
    await prisma.document.update({ where: { id: doc.id }, data: { sealedKey, documentSha256: sha256 } })
    attachments.push({ filename: doc.fileName, content: Buffer.from(sealedBytes) })
    hashes[doc.title] = sha256
  }

  await prisma.dossier.update({
    where: { id: dossierId },
    data: { status: 'ONDERTEKEND', completedAt: new Date() }
  })
  await writeAudit({ type: 'VERZEGELD', dossierId, metadata: { hashes } })

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
