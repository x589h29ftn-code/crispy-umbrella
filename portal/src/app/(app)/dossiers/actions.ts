'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { extname } from 'node:path'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { requireAccountant, requestContext } from '@/lib/auth/session'
import { storage } from '@/lib/storage'
import { convertOfficeToPdf, OFFICE_EXTENSIONS } from '@/lib/pdf/officeConvert'
import { stampSignatureImage } from '@/lib/pdf/signing'
import { dossierCreateSchema, saveFieldsSchema, type SaveFieldsInput } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit'
import { recomputeStatus } from '@/lib/status'
import { generateSigningToken } from '@/lib/auth/signingToken'
import { sendMail } from '@/lib/email/transport'
import { requestEmail, reminderEmail } from '@/lib/email/templates'

export interface FormState {
  error?: string
}

async function ownedDossier(id: string) {
  const acc = await requireAccountant()
  const dossier = await prisma.dossier.findUnique({ where: { id }, include: { recipients: true, fields: true } })
  if (!dossier) return null
  if (dossier.ownerId !== acc.id && acc.role !== 'BEHEERDER') return null
  return { acc, dossier }
}

export async function createDossierAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const acc = await requireAccountant()
  const parsed = dossierCreateSchema.safeParse({
    title: formData.get('title'),
    message: formData.get('message')
  })
  if (!parsed.success) return { error: 'Geef het document een titel.' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Kies een PDF- of Word-bestand.' }
  if (file.size > 18_000_000) return { error: 'Bestand te groot (max 18 MB).' }

  const ext = extname(file.name).slice(1).toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())

  let pdfBytes: Uint8Array
  if (ext === 'pdf') {
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return { error: 'Dit lijkt geen geldig PDF-bestand.' }
    }
    pdfBytes = bytes
  } else if (OFFICE_EXTENSIONS.includes(ext)) {
    const res = await convertOfficeToPdf(file.name, bytes)
    if (!res.ok || !res.data) return { error: res.error ?? 'Conversie mislukt.' }
    pdfBytes = res.data
  } else {
    return { error: 'Alleen PDF- of Word-bestanden worden ondersteund.' }
  }

  const store = storage()
  const originalKey = await store.put(pdfBytes, 'pdf')
  const workingKey = await store.put(pdfBytes, 'pdf')

  const dossier = await prisma.dossier.create({
    data: {
      title: parsed.data.title,
      fileName: file.name.replace(/\.[^.]+$/, '.pdf'),
      ownerId: acc.id,
      status: 'CONCEPT',
      originalKey,
      workingKey,
      message: parsed.data.message?.trim() || null,
      // Checkbox 'ontvanger ook een kopie mailen' (standaard aangevinkt).
      sendCopyToRecipient: formData.get('sendCopyToRecipient') === 'on'
    }
  })
  await writeAudit({ type: 'AANGEMAAKT', dossierId: dossier.id, accountantId: acc.id, ...requestContext() })
  redirect(`/dossiers/${dossier.id}/voorbereiden`)
}

export async function saveFieldsAction(
  dossierId: string,
  payload: SaveFieldsInput
): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedDossier(dossierId)
  if (!owned) return { ok: false, error: 'Dossier niet gevonden.' }
  if (owned.dossier.status !== 'CONCEPT') return { ok: false, error: 'Dit dossier is al verstuurd.' }

  const parsed = saveFieldsSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ongeldige velden.' }
  const { selfFields, recipients } = parsed.data
  if (recipients.length === 0) return { ok: false, error: 'Voeg minstens één ontvanger toe.' }

  // Vervang bestaande ontvangers/velden (dossier is nog concept).
  await prisma.$transaction([
    prisma.signatureField.deleteMany({ where: { dossierId } }),
    prisma.recipient.deleteMany({ where: { dossierId } })
  ])

  await prisma.$transaction(async (tx) => {
    for (const [i, r] of recipients.entries()) {
      const recipient = await tx.recipient.create({
        data: {
          dossierId,
          clientId: r.clientId ?? null,
          role: 'EXTERN',
          name: r.name,
          email: r.email.toLowerCase(),
          phone: r.phone ?? null,
          verificationMethod: r.verificationMethod,
          order: i
        }
      })
      await tx.signatureField.createMany({
        data: r.fields.map((f) => ({ dossierId, recipientId: recipient.id, ...f }))
      })
    }
    if (selfFields.length) {
      await tx.signatureField.createMany({
        data: selfFields.map((f) => ({ dossierId, recipientId: null, ...f }))
      })
    }
  })

  revalidatePath(`/dossiers/${dossierId}`)
  return { ok: true }
}

export async function sendDossierAction(dossierId: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedDossier(dossierId)
  if (!owned) return { ok: false, error: 'Dossier niet gevonden.' }
  const { acc, dossier } = owned
  if (dossier.status !== 'CONCEPT') return { ok: false, error: 'Dit dossier is al verstuurd.' }
  if (dossier.recipients.length === 0) return { ok: false, error: 'Geen ontvangers ingesteld.' }
  if (!dossier.workingKey) return { ok: false, error: 'Documentbestand ontbreekt.' }

  const store = storage()

  // Stempel de eigen handtekening op de eventuele eigen velden.
  const selfFields = dossier.fields.filter((f) => f.recipientId === null)
  if (selfFields.length) {
    if (!acc.signaturePng) {
      return { ok: false, error: 'Stel eerst uw eigen handtekening in bij Instellingen.' }
    }
    let bytes = await store.get(dossier.workingKey)
    for (const f of selfFields) {
      bytes = Buffer.from(
        await stampSignatureImage(bytes, { page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }, acc.signaturePng)
      )
    }
    const newKey = await store.put(bytes, 'pdf')
    await store.remove(dossier.workingKey)
    await prisma.dossier.update({ where: { id: dossier.id }, data: { workingKey: newKey } })
    await prisma.signatureField.updateMany({ where: { dossierId, recipientId: null }, data: { filled: true } })
  }

  const ttlMs = env.SIGN_LINK_TTL_DAYS * 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + ttlMs)

  for (const r of dossier.recipients) {
    const { raw, hash } = generateSigningToken()
    await prisma.recipient.update({
      where: { id: r.id },
      data: { tokenHash: hash, tokenExpiresAt: expiresAt, tokenUsedAt: null }
    })
    const url = `${env.APP_URL}/teken/${raw}`
    const mail = requestEmail({
      recipientName: r.name,
      senderName: acc.name,
      documentTitle: dossier.title,
      url,
      message: dossier.message
    })
    await sendMail({ to: r.email, ...mail })
    await writeAudit({ type: 'VERZONDEN', dossierId, recipientId: r.id, accountantId: acc.id, message: r.email })
  }

  await prisma.dossier.update({
    where: { id: dossier.id },
    data: { status: 'VERZONDEN', sentAt: new Date(), expiresAt }
  })
  revalidatePath(`/dossiers/${dossierId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function remindDossierAction(dossierId: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedDossier(dossierId)
  if (!owned) return { ok: false, error: 'Dossier niet gevonden.' }
  const { acc, dossier } = owned
  if (!['VERZONDEN', 'GEDEELTELIJK'].includes(dossier.status)) {
    return { ok: false, error: 'Er is niets om aan te herinneren.' }
  }
  const pending = dossier.recipients.filter((r) => r.status === 'PENDING')
  if (pending.length === 0) return { ok: false, error: 'Alle ontvangers hebben al getekend.' }

  const ttlMs = env.SIGN_LINK_TTL_DAYS * 24 * 60 * 60 * 1000
  for (const r of pending) {
    let raw: string
    if (!r.tokenHash || !r.tokenExpiresAt || r.tokenExpiresAt.getTime() < Date.now()) {
      const t = generateSigningToken()
      raw = t.raw
      await prisma.recipient.update({
        where: { id: r.id },
        data: { tokenHash: t.hash, tokenExpiresAt: new Date(Date.now() + ttlMs), tokenUsedAt: null }
      })
    } else {
      // Bestaande, nog geldige link opnieuw sturen is niet mogelijk (we bewaren
      // alleen de hash) — geef daarom een nieuwe token uit.
      const t = generateSigningToken()
      raw = t.raw
      await prisma.recipient.update({
        where: { id: r.id },
        data: { tokenHash: t.hash, tokenExpiresAt: new Date(Date.now() + ttlMs), tokenUsedAt: null }
      })
    }
    const url = `${env.APP_URL}/teken/${raw}`
    const mail = reminderEmail({ recipientName: r.name, senderName: acc.name, documentTitle: dossier.title, url })
    await sendMail({ to: r.email, ...mail })
    await writeAudit({ type: 'HERINNERD', dossierId, recipientId: r.id, accountantId: acc.id, message: r.email })
  }
  await prisma.dossier.update({ where: { id: dossier.id }, data: { lastReminderAt: new Date() } })
  revalidatePath(`/dossiers/${dossierId}`)
  return { ok: true }
}

export async function withdrawDossierAction(dossierId: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedDossier(dossierId)
  if (!owned) return { ok: false, error: 'Dossier niet gevonden.' }
  const { acc, dossier } = owned
  if (dossier.status === 'ONDERTEKEND') return { ok: false, error: 'Een afgerond dossier kan niet worden ingetrokken.' }
  await prisma.recipient.updateMany({
    where: { dossierId, status: 'PENDING' },
    data: { tokenHash: null, tokenExpiresAt: null }
  })
  await prisma.dossier.update({ where: { id: dossier.id }, data: { status: 'VERLOPEN' } })
  await writeAudit({ type: 'INGETROKKEN', dossierId, accountantId: acc.id, ...requestContext() })
  revalidatePath(`/dossiers/${dossierId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}
