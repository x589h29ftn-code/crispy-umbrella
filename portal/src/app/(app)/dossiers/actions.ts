'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { extname } from 'node:path'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { requireAccountant, requestContext } from '@/lib/auth/session'
import { storage } from '@/lib/storage'
import { convertOfficeToPdf, OFFICE_EXTENSIONS } from '@/lib/pdf/officeConvert'
import { dossierCreateSchema, saveFieldsSchema, type SaveFieldsInput } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit'
import { generateSigningToken } from '@/lib/auth/signingToken'
import { sendMail } from '@/lib/email/transport'
import { reminderEmail, officeTurnEmail } from '@/lib/email/templates'
import { activateInitial, currentSigners } from '@/lib/signflow'

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
  const { signingMode, signers } = parsed.data
  if (signers.length === 0) return { ok: false, error: 'Voeg minstens één ondertekenaar toe.' }

  // Vervang bestaande ondertekenaars/velden (dossier is nog concept).
  await prisma.$transaction([
    prisma.signatureField.deleteMany({ where: { dossierId } }),
    prisma.recipient.deleteMany({ where: { dossierId } })
  ])

  await prisma.$transaction(async (tx) => {
    for (const [i, s] of signers.entries()) {
      const isOffice = s.kind === 'office'
      const recipient = await tx.recipient.create({
        data: {
          dossierId,
          clientId: isOffice ? null : s.clientId ?? null,
          accountantId: isOffice ? s.accountantId ?? null : null,
          role: isOffice ? 'ZELF' : 'EXTERN',
          name: s.name,
          email: s.email.toLowerCase(),
          phone: s.phone ?? null,
          verificationMethod: s.verificationMethod,
          order: i
        }
      })
      await tx.signatureField.createMany({
        data: s.fields.map((f) => ({ dossierId, recipientId: recipient.id, ...f }))
      })
    }
  })
  await prisma.dossier.update({ where: { id: dossierId }, data: { signingMode } })

  revalidatePath(`/dossiers/${dossierId}`)
  return { ok: true }
}

export async function sendDossierAction(dossierId: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedDossier(dossierId)
  if (!owned) return { ok: false, error: 'Dossier niet gevonden.' }
  const { dossier } = owned
  if (dossier.status !== 'CONCEPT') return { ok: false, error: 'Dit dossier is al verstuurd.' }
  if (dossier.recipients.length === 0) return { ok: false, error: 'Geen ondertekenaars ingesteld.' }
  if (!dossier.workingKey) return { ok: false, error: 'Documentbestand ontbreekt.' }

  const ttlMs = env.SIGN_LINK_TTL_DAYS * 24 * 60 * 60 * 1000
  await prisma.dossier.update({
    where: { id: dossier.id },
    data: { status: 'VERZONDEN', sentAt: new Date(), expiresAt: new Date(Date.now() + ttlMs) }
  })
  // Activeer de eerste (sequentieel) of iedereen (parallel), inclusief e-mails.
  await activateInitial(dossier.id)

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
  // Alleen de ondertekenaar(s) die nú aan de beurt zijn krijgen een herinnering.
  const active = currentSigners(dossier, dossier.recipients)
  if (active.length === 0) return { ok: false, error: 'Er is niemand die nu aan de beurt is.' }

  const ttlMs = env.SIGN_LINK_TTL_DAYS * 24 * 60 * 60 * 1000
  for (const r of active) {
    if (r.role === 'ZELF' && r.accountantId) {
      const mail = officeTurnEmail({
        recipientName: r.name,
        documentTitle: dossier.title,
        url: `${env.APP_URL}/te-ondertekenen`
      })
      await sendMail({ to: r.email, ...mail })
    } else {
      const t = generateSigningToken()
      await prisma.recipient.update({
        where: { id: r.id },
        data: { tokenHash: t.hash, tokenExpiresAt: new Date(Date.now() + ttlMs), tokenUsedAt: null }
      })
      const mail = reminderEmail({
        recipientName: r.name,
        senderName: acc.name,
        documentTitle: dossier.title,
        url: `${env.APP_URL}/teken/${t.raw}`
      })
      await sendMail({ to: r.email, ...mail })
    }
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
