import 'server-only'
import { prisma } from '@/lib/db'
import { sendMail } from '@/lib/email/transport'
import { writeAudit } from '@/lib/audit'
import { sealAndComplete } from '@/lib/signflow'
import { enqueueOnce, type JobRow } from './queue'

// Eén plek waar alle jobsoorten worden uitgevoerd. Een handler die gooit, laat de
// job opnieuw inplannen met backoff (zie queue.fail).

type Payload = Record<string, unknown>

function payloadOf(job: JobRow): Payload {
  return (job.payload ?? {}) as Payload
}

/** Verzegeling opnieuw proberen na een tijdelijke storing (signing-API of TSA). */
async function handleSealRetry(job: JobRow): Promise<void> {
  const dossierId = String(payloadOf(job).dossierId ?? '')
  if (!dossierId) return
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { id: true, status: true, title: true, owner: { select: { email: true, name: true } } }
  })
  if (!dossier) return
  // Al gelukt (bijvoorbeeld handmatig) — niets meer te doen.
  if (dossier.status === 'ONDERTEKEND') return

  const outcome = await sealAndComplete(dossierId)
  if (outcome.ok) return

  // Na drie mislukte pogingen de beheerder/eigenaar op de hoogte stellen.
  if (job.attempts + 1 === 3) {
    await sendMail({
      to: dossier.owner.email,
      subject: `Verzegeling lukt niet: ${dossier.title}`,
      text:
        `Het dossier "${dossier.title}" is door alle partijen ondertekend, maar de verzegeling ` +
        `lukt nog niet. Laatste foutmelding: ${outcome.error ?? 'onbekend'}\n\n` +
        `Het portaal blijft het automatisch opnieuw proberen. Er is nog geen voltooiingsmail verstuurd.`,
      html:
        `<p>Het dossier <strong>${dossier.title}</strong> is door alle partijen ondertekend, maar de ` +
        `verzegeling lukt nog niet.</p><p>Laatste foutmelding: <code>${outcome.error ?? 'onbekend'}</code></p>` +
        `<p>Het portaal blijft het automatisch opnieuw proberen. Er is nog geen voltooiingsmail verstuurd.</p>`
    }).catch((e) => console.error('[seal retry mail]', e))
  }

  // Een document dat pyHanko structureel weigert geeft een 400, geen 502. Zo'n
  // fout is definitief: dan niet blijven rondlopen maar stoppen en melden.
  if (outcome.retryable === false) {
    await writeAudit({
      type: 'VERZEGELING_MISLUKT',
      dossierId,
      message: `definitief gestopt: ${outcome.error?.slice(0, 300) ?? 'onbekend'}`
    })
    return
  }
  throw new Error(outcome.error ?? 'verzegeling mislukt')
}

/** Hoe vaak de opruimtaak zichzelf opnieuw inplant. */
export const CSC_CLEANUP_INTERVAL_MS = 5 * 60_000

/**
 * Verlopen ondertekensessies opruimen (voorbereide PDF's weg, sessie op EXPIRED).
 * Plant zichzelf daarna opnieuw in, zodat er geen aparte cron nodig is.
 */
async function handleCscSessionCleanup(): Promise<void> {
  const { cleanupExpiredSessions } = await import('@/lib/csc/session')
  try {
    const n = await cleanupExpiredSessions()
    if (n > 0) console.log(`[jobs] ${n} verlopen ondertekensessie(s) opgeruimd`)
  } finally {
    // Ook na een fout doorgaan: de reeks mag niet stilvallen.
    await enqueueOnce('CSC_SESSION_CLEANUP', 'periodiek', {}, {
      runAt: new Date(Date.now() + CSC_CLEANUP_INTERVAL_MS),
      maxAttempts: 1_000_000
    }).catch((e) => console.error('[jobs] kon opruimtaak niet opnieuw inplannen', e))
  }
}

/**
 * Eén nieuwe poging na een tijdelijke bounce. De oorspronkelijke link is niet
 * opnieuw te versturen (van het tekentoken bewaren we alleen de hash), dus de
 * ontvanger krijgt een nieuwe uitnodiging met een nieuwe link.
 */
async function handleMailResend(job: JobRow): Promise<void> {
  const recipientId = String(payloadOf(job).recipientId ?? '')
  if (!recipientId) return
  const r = await prisma.recipient.findUnique({
    where: { id: recipientId },
    select: { id: true, status: true, mailStatus: true, mailResendCount: true, dossierId: true, email: true }
  })
  if (!r) return
  // Inmiddels getekend, geweigerd of definitief onbezorgbaar: niets meer doen.
  if (r.status !== 'PENDING' || r.mailStatus === 'BOUNCED' || r.mailStatus === 'COMPLAINED') return

  await prisma.recipient.update({
    where: { id: r.id },
    data: { mailResendCount: { increment: 1 } }
  })
  const { activateSigner } = await import('@/lib/signflow')
  await activateSigner(r.id)
  await writeAudit({
    type: 'HERINNERD',
    dossierId: r.dossierId,
    recipientId: r.id,
    message: `automatisch opnieuw verstuurd na tijdelijke bounce (${r.email})`
  })
}

/** Hoe vaak de bewaartermijn wordt nagelopen. Eén keer per etmaal is genoeg. */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60_000

/**
 * Ruimt dossiers op waarvan de bewaartermijn is verstreken en plant zichzelf
 * daarna opnieuw in.
 */
async function handleRetentionCleanup(): Promise<void> {
  try {
    const { purgeExpiredDossiers } = await import('@/lib/retention')
    const res = await purgeExpiredDossiers()
    if (res.dossiers > 0) {
      console.log(
        `[jobs] bewaartermijn: ${res.dossiers} dossier(s), ${res.documents} document(en) en ` +
          `${res.auditEvents} auditregel(s) opgeruimd`
      )
    }
    if (res.skipped.length > 0) {
      console.error('[jobs] bewaartermijn: overgeslagen', res.skipped)
    }
  } finally {
    await enqueueOnce('RETENTION_CLEANUP', 'periodiek', {}, {
      runAt: new Date(Date.now() + RETENTION_INTERVAL_MS),
      maxAttempts: 1_000_000
    }).catch((e) => console.error('[jobs] kon opruimtaak bewaartermijn niet inplannen', e))
  }
}

export async function runJob(job: JobRow): Promise<void> {
  switch (job.kind) {
    case 'SEAL_RETRY':
      return handleSealRetry(job)
    case 'CSC_SESSION_CLEANUP':
      return handleCscSessionCleanup()
    case 'RETENTION_CLEANUP':
      return handleRetentionCleanup()
    case 'MAIL_RESEND':
      return handleMailResend(job)
    // REMINDER, EXPIRE, ARCHIVE en RETENTION_CLEANUP volgen in een later
    // werkpakket; de queue en de worker staan er al klaar voor.
    default:
      throw new Error(`onbekende jobsoort: ${job.kind}`)
  }
}
