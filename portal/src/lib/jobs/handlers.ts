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

  // Niet-herhaalbare fout: niet blijven proberen.
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

export async function runJob(job: JobRow): Promise<void> {
  switch (job.kind) {
    case 'SEAL_RETRY':
      return handleSealRetry(job)
    case 'CSC_SESSION_CLEANUP':
      return handleCscSessionCleanup()
    // REMINDER, EXPIRE, ARCHIVE en RETENTION_CLEANUP volgen in een later
    // werkpakket; de queue en de worker staan er al klaar voor.
    default:
      throw new Error(`onbekende jobsoort: ${job.kind}`)
  }
}
