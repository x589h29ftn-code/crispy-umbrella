import 'server-only'
import { env } from '@/env'
import { claim, complete, enqueueOnce, fail, newWorkerId } from './queue'
import { runJob } from './handlers'

// Achtergrondwerker. Draait als aparte container (zie docker-compose.yml) zodat
// hij niet meelift op de webcontainer. Meerdere workers naast elkaar kunnen
// geen dubbel werk doen: claim() gebruikt FOR UPDATE SKIP LOCKED.

let stopping = false

/** Verwerkt één ronde en geeft terug hoeveel jobs zijn gedraaid. */
export async function runOnce(workerId: string, batch = env.WORKER_BATCH): Promise<number> {
  const jobs = await claim(batch, workerId)
  for (const job of jobs) {
    try {
      await runJob(job)
      await complete(job.id)
      console.log(`[worker] ${job.kind} ${job.id} klaar`)
    } catch (e) {
      const { exhausted, nextRunAt } = await fail(job, (e as Error).message)
      console.error(
        `[worker] ${job.kind} ${job.id} mislukt (poging ${job.attempts + 1}/${job.maxAttempts})` +
          (exhausted ? ' — geen pogingen meer' : ` — opnieuw om ${nextRunAt?.toISOString()}`),
        e
      )
    }
  }
  return jobs.length
}

/** Blijft draaien tot het proces een stopsignaal krijgt. */
export async function runForever(): Promise<void> {
  const workerId = newWorkerId()
  console.log(`[worker] gestart (${workerId}), interval ${env.WORKER_POLL_MS} ms`)
  // Zorg dat de terugkerende taken lopen; daarna plannen ze zichzelf.
  for (const kind of [
    'CSC_SESSION_CLEANUP',
    'RETENTION_CLEANUP',
    'REMINDER',
    'EXPIRE',
    'WAARMERK_NUDGE',
    'ARCHIVE_NUDGE',
    'ORPHAN_CLEANUP'
  ] as const) {
    await enqueueOnce(kind, 'periodiek', {}, { maxAttempts: 1_000_000 }).catch((e) =>
      console.error(`[worker] kon ${kind} niet inplannen`, e)
    )
  }
  // Het dagelijkse anker heeft een eigen dedupe-sleutel, omdat er ook ankers per
  // afgerond dossier in de wachtrij komen.
  await enqueueOnce('AUDIT_ANCHOR', 'dagelijks', {}, { maxAttempts: 1_000_000 }).catch((e) =>
    console.error('[worker] kon AUDIT_ANCHOR niet inplannen', e)
  )
  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} ontvangen, afronden…`)
    stopping = true
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  while (!stopping) {
    try {
      const done = await runOnce(workerId)
      // Was er werk, dan direct doorgaan; anders even wachten.
      if (done === 0) await sleep(env.WORKER_POLL_MS)
    } catch (e) {
      console.error('[worker] ronde mislukt', e)
      await sleep(env.WORKER_POLL_MS)
    }
  }
  console.log('[worker] gestopt')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
