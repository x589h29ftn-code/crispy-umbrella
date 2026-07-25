import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

// Durable job queue op Postgres. Geen Redis of extra broker: met
// SELECT ... FOR UPDATE SKIP LOCKED kunnen meerdere workers naast elkaar draaien
// zonder dezelfde job twee keer te pakken.

export type JobKind =
  | 'SEAL_RETRY'
  | 'REMINDER'
  | 'EXPIRE'
  | 'ARCHIVE'
  | 'RETENTION_CLEANUP'
  | 'CSC_SESSION_CLEANUP'
  | 'MAIL_RESEND'
  | 'ORPHAN_CLEANUP'
  | 'WAARMERK_NUDGE'
  | 'AUDIT_ANCHOR'

export interface JobRow {
  id: string
  kind: string
  payload: Prisma.JsonValue
  attempts: number
  maxAttempts: number
}

/** Backoff uit de opdracht: 1, 5, 15, 60 minuten, daarna elk uur (max 24 uur). */
export function backoffMs(attempts: number): number {
  const ladder = [1, 5, 15, 60].map((m) => m * 60_000)
  return attempts < ladder.length ? ladder[attempts] : 60 * 60_000
}

/** Zet een job in de wachtrij. */
export async function enqueue(
  kind: JobKind,
  payload: Prisma.InputJsonValue,
  opts?: { runAt?: Date; maxAttempts?: number }
): Promise<string> {
  const job = await prisma.job.create({
    data: {
      kind,
      payload,
      runAt: opts?.runAt ?? new Date(),
      maxAttempts: opts?.maxAttempts ?? 10
    },
    select: { id: true }
  })
  return job.id
}

/**
 * Zorgt dat er precies één openstaande job van dit soort voor deze sleutel is.
 * Voorkomt dat een dossier tien keer in de wachtrij belandt.
 */
export async function enqueueOnce(
  kind: JobKind,
  dedupeKey: string,
  payload: Prisma.InputJsonValue,
  opts?: { runAt?: Date; maxAttempts?: number }
): Promise<string | null> {
  const open = await prisma.job.findFirst({
    where: { kind, completedAt: null, payload: { path: ['dedupeKey'], equals: dedupeKey } },
    select: { id: true }
  })
  if (open) return null
  return enqueue(kind, { ...(payload as object), dedupeKey } as Prisma.InputJsonValue, opts)
}

/**
 * Claimt tot `limit` jobs die nu mogen lopen. Stale locks (ouder dan
 * staleAfterMs) worden weer vrijgegeven zodat een gecrashte worker niets blokkeert.
 */
export async function claim(limit: number, workerId: string, staleAfterMs = 10 * 60_000): Promise<JobRow[]> {
  const staleBefore = new Date(Date.now() - staleAfterMs)
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<JobRow[]>`
      SELECT "id", "kind", "payload", "attempts", "maxAttempts"
      FROM "Job"
      WHERE "completedAt" IS NULL
        AND "runAt" <= NOW()
        AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
        AND "attempts" < "maxAttempts"
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `
    if (rows.length === 0) return []
    await tx.job.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { lockedAt: new Date(), lockedBy: workerId }
    })
    return rows
  })
}

/** Job geslaagd: markeren als afgerond. */
export async function complete(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null }
  })
}

/**
 * Job mislukt: teller omhoog en opnieuw inplannen met backoff. Bij het bereiken
 * van maxAttempts blijft de job staan met de laatste fout (niet stil verdwijnen).
 */
export async function fail(job: JobRow, error: string): Promise<{ exhausted: boolean; nextRunAt: Date | null }> {
  const attempts = job.attempts + 1
  const exhausted = attempts >= job.maxAttempts
  const nextRunAt = exhausted ? null : new Date(Date.now() + backoffMs(job.attempts))
  await prisma.job.update({
    where: { id: job.id },
    data: {
      attempts,
      lastError: error.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      ...(nextRunAt ? { runAt: nextRunAt } : {})
    }
  })
  return { exhausted, nextRunAt }
}

export function newWorkerId(): string {
  return `${process.pid}-${randomUUID().slice(0, 8)}`
}
