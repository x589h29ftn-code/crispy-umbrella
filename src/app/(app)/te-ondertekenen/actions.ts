'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAccountant, requestContext } from '@/lib/auth/session'
import { applySignature, declineSignature, currentSigners } from '@/lib/signflow'

async function myActiveRecipient(recipientId: string, accountantId: string) {
  const recipient = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: { dossier: { include: { recipients: true } } }
  })
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
  signatureDataUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAccountant()
  const recipient = await myActiveRecipient(recipientId, me.id)
  if (!recipient) return { ok: false, error: 'U bent nu niet aan de beurt voor dit document.' }
  if (!/^data:image\/(png|jpe?g);base64,/.test(signatureDataUrl) || signatureDataUrl.length > 1_500_000) {
    return { ok: false, error: 'Ongeldige handtekening.' }
  }
  try {
    await applySignature(recipient.id, signatureDataUrl, requestContext())
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
