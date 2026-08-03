import 'server-only'
import { prisma } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { sendMail } from './transport'
import { enqueueOnce } from '@/lib/jobs/queue'
import type { NormalisedMailEvent } from './webhook'

// Verwerkt de bezorgstatussen. Belangrijk: een dossier mag niet stil doodbloeden
// doordat het e-mailadres fout is. Bij een harde bounce krijgt de eigenaar bericht
// en gaan er geen herinneringen meer naar dat adres.

/** Hoeveel keer we na een tijdelijke bounce automatisch opnieuw versturen. */
export const MAX_SOFT_RESENDS = 1

export interface ProcessResult {
  handled: boolean
  duplicate?: boolean
  reason?: string
}

/**
 * Slaat de gebeurtenis op en werkt de ontvanger bij. Idempotent: dezelfde
 * gebeurtenis twee keer aanbieden doet niets extra (unieke providerEventId).
 */
export async function processMailEvent(
  provider: 'postmark' | 'resend',
  event: NormalisedMailEvent,
  rawPayload: unknown
): Promise<ProcessResult> {
  const recipient = event.messageId
    ? await prisma.recipient.findFirst({
        where: { mailMessageId: event.messageId },
        include: { dossier: { select: { id: true, title: true, ownerId: true } } }
      })
    : null

  // Eerst vastleggen; de unieke index doet het dedupe-werk.
  try {
    await prisma.mailEvent.create({
      data: {
        provider,
        providerEventId: event.providerEventId,
        type: event.type,
        messageId: event.messageId,
        recipientId: recipient?.id ?? null,
        payload: rawPayload as never
      }
    })
  } catch {
    // Al eerder verwerkt.
    return { handled: false, duplicate: true }
  }

  if (!recipient) {
    // Bijvoorbeeld een mail aan een beheerder, of een ouder bericht.
    return { handled: true, reason: 'geen bijbehorende ontvanger' }
  }

  switch (event.type) {
    case 'Delivery':
      await prisma.recipient.update({
        where: { id: recipient.id },
        data: { mailStatus: 'DELIVERED', mailStatusAt: event.occurredAt }
      })
      await writeAudit({
        type: 'MAIL_AFGELEVERD',
        dossierId: recipient.dossierId,
        recipientId: recipient.id,
        message: recipient.email,
        metadata: { provider, messageId: event.messageId }
      })
      return { handled: true }

    case 'Open':
      // Alleen procesindicatie. Bewust niet op het ondertekencertificaat: een
      // gemiste opening (geblokkeerde afbeeldingen) en een valse opening
      // (privacybescherming die mail vooraf ophaalt) komen beide voor.
      if (!recipient.mailOpenedAt) {
        await prisma.recipient.update({
          where: { id: recipient.id },
          data: { mailOpenedAt: event.occurredAt }
        })
        await writeAudit({
          type: 'MAIL_GEOPEND',
          dossierId: recipient.dossierId,
          recipientId: recipient.id,
          message: `${recipient.email} (indicatie, niet als bewijs)`,
          metadata: { provider }
        })
      }
      return { handled: true }

    case 'SpamComplaint':
      await prisma.recipient.update({
        where: { id: recipient.id },
        data: { mailStatus: 'COMPLAINED', mailStatusAt: event.occurredAt }
      })
      await writeAudit({
        type: 'MAIL_KLACHT',
        dossierId: recipient.dossierId,
        recipientId: recipient.id,
        message: recipient.email,
        metadata: { provider }
      })
      await notifyOwner(recipient.dossier, recipient.name, recipient.email, 'als spam gemarkeerd')
      return { handled: true }

    case 'Bounce': {
      const soft = event.bounceType === 'soft'
      const canRetry = soft && recipient.mailResendCount < MAX_SOFT_RESENDS
      await prisma.recipient.update({
        where: { id: recipient.id },
        data: {
          // Een tijdelijke bounce waarop we nog een poging doen, is nog geen
          // definitieve mislukking.
          mailStatus: canRetry ? 'QUEUED' : 'BOUNCED',
          mailStatusAt: event.occurredAt,
          mailBounceType: event.bounceType ?? null,
          mailBounceReason: event.bounceReason ?? null
        }
      })
      await writeAudit({
        type: 'MAIL_GEBOUNCED',
        dossierId: recipient.dossierId,
        recipientId: recipient.id,
        message: `${recipient.email} (${event.bounceType ?? 'onbekend'})${canRetry ? ' — één nieuwe poging over een uur' : ''}`,
        metadata: { provider, reason: event.bounceReason, bounceType: event.bounceType }
      })

      if (canRetry) {
        // Eén automatische herzending na een uur; daarna behandelen als hard.
        await enqueueOnce(
          'MAIL_RESEND',
          recipient.id,
          { recipientId: recipient.id },
          { runAt: new Date(Date.now() + 60 * 60_000), maxAttempts: 3 }
        )
      } else {
        await notifyOwner(
          recipient.dossier,
          recipient.name,
          recipient.email,
          soft ? 'herhaaldelijk niet bezorgd' : 'definitief onbezorgbaar'
        )
      }
      return { handled: true }
    }

    default:
      return { handled: true, reason: 'niet-relevant type' }
  }
}

async function notifyOwner(
  dossier: { id: string; title: string; ownerId: string },
  name: string,
  email: string,
  wat: string
): Promise<void> {
  const owner = await prisma.accountant.findUnique({
    where: { id: dossier.ownerId },
    select: { email: true }
  })
  if (!owner) return
  const text =
    `De uitnodiging voor "${dossier.title}" aan ${name} (${email}) is ${wat}.\n\n` +
    `Controleer het e-mailadres en verstuur het verzoek daarna opnieuw. Er gaan geen ` +
    `herinneringen meer naar dit adres.`
  await sendMail({
    to: owner.email,
    subject: `Mail niet bezorgd: ${dossier.title}`,
    text,
    html: `<p>${text.replace(/\n\n/g, '</p><p>')}</p>`
  }).catch((e) => console.error('[bounce melding]', e))
}

/**
 * Mag er nog een herinnering naar dit adres? Naar een gebouncet of als spam
 * gemarkeerd adres blijven mailen schaadt de bezorgbaarheid van het hele domein.
 */
export function mailBlocked(r: { mailStatus: string | null }): boolean {
  return r.mailStatus === 'BOUNCED' || r.mailStatus === 'COMPLAINED'
}

/** Ontvangers met een mailprobleem, voor het overzicht in het portaal. */
export async function recipientsWithMailProblem(ownerId: string, isBeheerder: boolean) {
  return prisma.recipient.findMany({
    where: {
      mailStatus: { in: ['BOUNCED', 'COMPLAINED', 'FAILED'] },
      status: 'PENDING',
      dossier: { status: { in: ['VERZONDEN', 'GEDEELTELIJK'] }, ...(isBeheerder ? {} : { ownerId }) }
    },
    orderBy: { mailStatusAt: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      email: true,
      mailStatus: true,
      mailBounceReason: true,
      mailStatusAt: true,
      dossier: { select: { id: true, title: true } }
    }
  })
}
