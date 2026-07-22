import 'server-only'
import type { Dossier, Recipient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashSigningToken } from '@/lib/auth/signingToken'
import { storage } from '@/lib/storage'
import { stampSignatureImage } from '@/lib/pdf/signing'
import { sealDocument } from '@/lib/pdf/seal'
import { recomputeStatus } from '@/lib/status'
import { writeAudit } from '@/lib/audit'
import { sendMail } from '@/lib/email/transport'
import { completedEmail } from '@/lib/email/templates'

export type ResolveResult =
  | { ok: true; recipient: Recipient; dossier: Dossier }
  | { ok: false; reason: 'onbekend' | 'verlopen' | 'gebruikt' | 'afgerond' }

/** Zoekt de ontvanger bij een ruwe tekentoken en valideert de geldigheid. */
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

/** Verwerkt de handtekening van één ontvanger en verzegelt zodra alles rond is. */
export async function applySignature(
  recipientId: string,
  signatureDataUrl: string,
  ctx: { ip?: string; userAgent?: string }
): Promise<void> {
  const recipient = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: { dossier: true, fields: true }
  })
  if (!recipient) throw new Error('Ontvanger niet gevonden')
  const dossier = recipient.dossier
  if (!dossier.workingKey) throw new Error('Documentbestand ontbreekt')

  const store = storage()
  let bytes = await store.get(dossier.workingKey)
  for (const f of recipient.fields) {
    bytes = Buffer.from(
      await stampSignatureImage(bytes, { page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }, signatureDataUrl)
    )
  }
  const newKey = await store.put(bytes, 'pdf')
  await store.remove(dossier.workingKey)

  await prisma.$transaction([
    prisma.dossier.update({ where: { id: dossier.id }, data: { workingKey: newKey } }),
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

  await finalizeIfComplete(dossier.id)
}

/** Zet DECLINED en werkt de dossierstatus bij. */
export async function declineSignature(
  recipientId: string,
  reason: string | undefined,
  ctx: { ip?: string; userAgent?: string }
): Promise<void> {
  const recipient = await prisma.recipient.findUnique({ where: { id: recipientId }, include: { dossier: true } })
  if (!recipient) return
  await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: 'DECLINED', declinedReason: reason || null, tokenUsedAt: new Date() }
  })
  await writeAudit({ type: 'GEWEIGERD', dossierId: recipient.dossierId, recipientId, message: reason || undefined, ...ctx })
  const all = await prisma.recipient.findMany({ where: { dossierId: recipient.dossierId } })
  const status = recomputeStatus(recipient.dossier.status, all)
  await prisma.dossier.update({ where: { id: recipient.dossierId }, data: { status } })
}

/** Herberekent de status en verzegelt + mailt zodra alle partijen getekend hebben. */
export async function finalizeIfComplete(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: { recipients: true, fields: true, owner: true }
  })
  if (!dossier) return

  const status = recomputeStatus(dossier.status, dossier.recipients)
  if (status !== 'ONDERTEKEND') {
    if (status !== dossier.status) await prisma.dossier.update({ where: { id: dossierId }, data: { status } })
    return
  }

  // Alles getekend → verzegelen.
  if (!dossier.workingKey) return
  const store = storage()
  const working = await store.get(dossier.workingKey)
  const { sealedBytes, sha256 } = await sealDocument({
    pdfBytes: working,
    dossierTitle: dossier.title,
    dossierId: dossier.id,
    signers: dossier.recipients.map((r) => ({
      name: r.name,
      email: r.email,
      signedAt: r.signedAt,
      otpVerifiedAt: r.otpVerifiedAt
    }))
  })
  const sealedKey = await store.put(sealedBytes, 'pdf')
  await prisma.dossier.update({
    where: { id: dossierId },
    data: { status: 'ONDERTEKEND', sealedKey, documentSha256: sha256, completedAt: new Date() }
  })
  await writeAudit({ type: 'VERZEGELD', dossierId, metadata: { sha256 } })

  // Voltooiingsmails met de verzegelde PDF. De eigenaar/verzender krijgt hem
  // altijd; de ontvangers alleen als de kopie-optie voor dit dossier aanstaat.
  const attachment = { filename: dossier.fileName, content: Buffer.from(sealedBytes) }
  const targets = [
    ...(dossier.sendCopyToRecipient ? dossier.recipients.map((r) => ({ name: r.name, email: r.email })) : []),
    { name: dossier.owner.name, email: dossier.owner.email }
  ]
  for (const t of targets) {
    const mail = completedEmail({ recipientName: t.name, documentTitle: dossier.title })
    await sendMail({ to: t.email, ...mail, attachments: [attachment] }).catch((e) =>
      console.error('[signflow] voltooiingsmail mislukt', e)
    )
  }
}
