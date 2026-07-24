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
import type { DocumentKind } from '@prisma/client'
import { extractText } from '@/lib/docanalyze/extractText'
import { classifyText } from '@/lib/docanalyze/classify'
import { analyzeDocument, type AnalyzeResult } from '@/lib/docanalyze/analyze'
import { buildCombinedSuggestion } from '@/lib/docanalyze/templates'
import { scanBuffer, scanEnabled } from '@/lib/security/virusscan'

export interface FormState {
  error?: string
}

/**
 * Herkent een geüpload document (tekstlaag, met OCR-terugval) en stelt een
 * titel en begeleidend bericht voor. Wordt vanuit het nieuw-dossierformulier
 * aangeroepen zodra een bestand is gekozen. Wijzigt niets in de database.
 */
export async function analyzeDocumentAction(
  formData: FormData
): Promise<{ ok: false } | ({ ok: true } & AnalyzeResult)> {
  const acc = await requireAccountant()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > 18_000_000) return { ok: false }
  const ext = extname(file.name).slice(1).toLowerCase()
  if (ext !== 'pdf' && !OFFICE_EXTENSIONS.includes(ext)) return { ok: false }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await analyzeDocument(ext, bytes, acc.name)
    return { ok: true, ...result }
  } catch {
    return { ok: false }
  }
}

/**
 * Stelt één gecombineerde titel en begeleidend bericht voor bij meerdere
 * herkende documenten (jaarrekening, notulen en bevestiging gaan vrijwel altijd
 * samen). Geeft null bij minder dan twee herkende documenten.
 */
export async function combineSuggestionAction(
  items: { kind: DocumentKind; year: number | null }[]
): Promise<{ title: string; body: string } | null> {
  const acc = await requireAccountant()
  if (!Array.isArray(items) || items.length === 0) return null
  return buildCombinedSuggestion(items, acc.name)
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
    message: formData.get('message'),
    linkTtlDays: formData.get('linkTtlDays') ?? 10
  })
  if (!parsed.success) return { error: 'Geef het document een titel.' }

  // Eén of meer documenten, elk met een eigen titel (files en titels lopen
  // per index gelijk op).
  const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  const titles = formData.getAll('docTitle').map((t) => String(t ?? '').trim())
  if (files.length === 0) return { error: 'Kies minstens één PDF- of Word-bestand.' }
  if (files.length > 20) return { error: 'Maximaal 20 documenten per verzoek.' }

  const store = storage()
  const prepared: {
    title: string
    fileName: string
    originalKey: string
    workingKey: string
    detectedKind: ReturnType<typeof classifyText>['kind'] | null
    detectedYear: number | null
    ocrUsed: boolean
  }[] = []
  for (const [i, file] of files.entries()) {
    if (file.size > 18_000_000) return { error: `"${file.name}" is te groot (max 18 MB).` }
    const ext = extname(file.name).slice(1).toLowerCase()
    const bytes = new Uint8Array(await file.arrayBuffer())
    // Virusscan (indien ingeschakeld). Fail-closed: bij een scanfout weigeren.
    if (scanEnabled()) {
      const verdict = await scanBuffer(bytes).catch(() => ({ clean: false, virus: 'scan mislukt' }))
      if (!verdict.clean) return { error: `"${file.name}" is geweigerd door de virusscan${verdict.virus ? ` (${verdict.virus})` : ''}.` }
    }
    let pdfBytes: Uint8Array
    if (ext === 'pdf') {
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        return { error: `"${file.name}" lijkt geen geldig PDF-bestand.` }
      }
      pdfBytes = bytes
    } else if (OFFICE_EXTENSIONS.includes(ext)) {
      const res = await convertOfficeToPdf(file.name, bytes)
      if (!res.ok || !res.data) return { error: res.error ?? `Conversie van "${file.name}" mislukt.` }
      pdfBytes = res.data
    } else {
      return { error: `"${file.name}": alleen PDF- of Word-bestanden worden ondersteund.` }
    }
    // Herkenning voor inzicht/auditspoor (best-effort, blokkeert nooit).
    let detectedKind: ReturnType<typeof classifyText>['kind'] | null = null
    let detectedYear: number | null = null
    let ocrUsed = false
    try {
      const src = ext === 'pdf' ? bytes : pdfBytes
      const { text, ocrUsed: used } = await extractText(ext === 'pdf' ? 'pdf' : 'pdf', src)
      const c = classifyText(text)
      detectedKind = c.kind === 'OVERIG' ? null : c.kind
      detectedYear = c.year
      ocrUsed = used
    } catch {
      /* herkenning is optioneel */
    }
    prepared.push({
      title: titles[i] || file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name.replace(/\.[^.]+$/, '.pdf'),
      originalKey: await store.put(pdfBytes, 'pdf'),
      workingKey: await store.put(pdfBytes, 'pdf'),
      detectedKind,
      detectedYear,
      ocrUsed
    })
  }

  const base = {
    ownerId: acc.id,
    status: 'CONCEPT' as const,
    message: parsed.data.message?.trim() || null,
    linkTtlDays: parsed.data.linkTtlDays,
    sendCopyToRecipient: formData.get('sendCopyToRecipient') === 'on'
  }

  // Verzendwijze: alles in één verzoek (standaard) of elk document apart.
  const separate = formData.get('deliveryMode') === 'separate' && prepared.length > 1
  const ctx = requestContext()

  if (separate) {
    // Eén dossier per document; elk krijgt zijn eigen e-mail/link en status.
    for (const [i, p] of prepared.entries()) {
      const d = await prisma.dossier.create({
        data: {
          ...base,
          title: p.title || `${parsed.data.title} (${i + 1})`,
          documents: {
            create: [
              {
                title: p.title,
                fileName: p.fileName,
                order: 0,
                originalKey: p.originalKey,
                workingKey: p.workingKey,
                detectedKind: p.detectedKind,
                detectedYear: p.detectedYear,
                ocrUsed: p.ocrUsed
              }
            ]
          }
        }
      })
      await writeAudit({ type: 'AANGEMAAKT', dossierId: d.id, accountantId: acc.id, ...ctx })
    }
    redirect('/dashboard?nieuw=apart')
  }

  const dossier = await prisma.dossier.create({
    data: {
      ...base,
      title: parsed.data.title,
      documents: {
        create: prepared.map((p, i) => ({
          title: p.title,
          fileName: p.fileName,
          order: i,
          originalKey: p.originalKey,
          workingKey: p.workingKey,
          detectedKind: p.detectedKind,
          detectedYear: p.detectedYear,
          ocrUsed: p.ocrUsed
        }))
      }
    }
  })
  await writeAudit({ type: 'AANGEMAAKT', dossierId: dossier.id, accountantId: acc.id, ...ctx })
  redirect(`/dossiers/${dossier.id}/voorbereiden`)
}

/** Stelt de archiefbestemming voor dit dossier in (override op de standaard). */
export async function setArchiveFolderAction(dossierId: string, folder: string): Promise<{ ok: boolean; error?: string }> {
  const owned = await ownedDossier(dossierId)
  if (!owned) return { ok: false, error: 'Dossier niet gevonden.' }
  await prisma.dossier.update({ where: { id: dossierId }, data: { archiveFolder: folder.trim() || null } })
  revalidatePath(`/dossiers/${dossierId}`)
  return { ok: true }
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

  // Alle velden moeten naar een document van dít dossier verwijzen.
  const docIds = new Set((await prisma.document.findMany({ where: { dossierId }, select: { id: true } })).map((d) => d.id))
  for (const s of signers) {
    for (const f of s.fields) {
      if (!docIds.has(f.documentId)) return { ok: false, error: 'Ongeldig document bij een tekenveld.' }
    }
  }

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

  const ttlMs = dossier.linkTtlDays * 24 * 60 * 60 * 1000
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

  const ttlMs = dossier.linkTtlDays * 24 * 60 * 60 * 1000
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
        data: {
          tokenHash: t.hash,
          tokenExpiresAt: new Date(Date.now() + ttlMs),
          tokenUsedAt: null,
          otpVerifiedAt: null,
          otpHash: null,
          otpExpiresAt: null
        }
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
  // Alles is al getekend; alleen de verzegeling ontbreekt nog. Intrekken zou het
  // bewijs weggooien terwijl de handtekeningen al gezet zijn.
  if (dossier.status === 'SEALING_FAILED') {
    return { ok: false, error: 'Dit dossier is volledig ondertekend en wacht op verzegeling; intrekken kan niet meer.' }
  }
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
