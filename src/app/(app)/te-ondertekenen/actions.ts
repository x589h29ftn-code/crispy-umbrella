'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAccountant, requestContext } from '@/lib/auth/session'
import { applySignature, declineSignature, currentSigners } from '@/lib/signflow'
import { herverifieerVoorOndertekenen } from '@/lib/auth/reauth'
import { consume } from '@/lib/ratelimit'

async function myActiveRecipient(recipientId: string, accountantId: string) {
  const recipient = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: { dossier: { include: { recipients: true } } }
  })
  // C.3: het slot hangt aan één accountant. Niet iedere ingelogde medewerker mag
  // het vullen; overdracht gaat via een expliciete handeling met auditregel.
  if (!recipient || recipient.accountantId !== accountantId) return null
  if (recipient.status !== 'PENDING') return null
  const dossier = recipient.dossier
  if (!['VERZONDEN', 'GEDEELTELIJK'].includes(dossier.status)) return null
  // Is deze persoon nu aan de beurt?
  const active = currentSigners(dossier, dossier.recipients)
  if (!active.some((a) => a.id === recipient.id)) return null
  return recipient
}

export async function officeSignAction(
  recipientId: string,
  signatureDataUrl: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAccountant()

  // Idempotent: bij rol ZELF is er geen eenmalig token dat een tweede indiening
  // tegenhoudt. Dubbelklikken of een herhaalde POST mag geen tweede stempel
  // opleveren. Eerst kijken of het al gedaan is, vóór de foutmelding "u bent niet
  // aan de beurt" — die zou hier onterecht en verwarrend zijn.
  const bestaand = await prisma.recipient.findUnique({
    where: { id: recipientId },
    select: { accountantId: true, status: true }
  })
  if (bestaand?.accountantId === me.id && bestaand.status === 'SIGNED') return { ok: true }

  const recipient = await myActiveRecipient(recipientId, me.id)
  if (!recipient) return { ok: false, error: 'U bent nu niet aan de beurt voor dit document.' }
  if (!/^data:image\/(png|jpe?g);base64,/.test(signatureDataUrl) || signatureDataUrl.length > 1_500_000) {
    return { ok: false, error: 'Ongeldige handtekening.' }
  }

  const ctx = requestContext()
  // Rate-limit vóór de codecontrole, zodat raden niet gratis is.
  if (!(await consume('totp', `${ctx.ip ?? 'onbekend'}:reauth:${recipientId}`))) {
    return { ok: false, error: 'Te veel pogingen. Probeer het over enkele minuten opnieuw.' }
  }
  const reauth = await herverifieerVoorOndertekenen({
    accountantId: me.id,
    recipientId: recipient.id,
    dossierId: recipient.dossierId,
    code: String(code ?? '').trim(),
    ctx
  })
  if (!reauth.ok) return { ok: false, error: reauth.melding }

  try {
    await applySignature(recipient.id, signatureDataUrl, ctx)
  } catch (e) {
    console.error('[office sign]', e)
    return { ok: false, error: 'Ondertekenen mislukt.' }
  }
  revalidatePath('/te-ondertekenen')
  revalidatePath(`/dossiers/${recipient.dossierId}`)
  return { ok: true }
}

export async function officeDeclineAction(recipientId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAccountant()
  const recipient = await myActiveRecipient(recipientId, me.id)
  if (!recipient) return { ok: false, error: 'U bent nu niet aan de beurt.' }
  await declineSignature(recipient.id, reason, requestContext())
  revalidatePath('/te-ondertekenen')
  return { ok: true }
}
