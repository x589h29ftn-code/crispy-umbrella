import 'server-only'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { encryptString, decryptString } from '@/lib/storage/crypto'
import { writeAudit } from '@/lib/audit'
import { sendMail } from '@/lib/email/transport'
import { credentialInfo, type CscConfig } from './client'

// Sessiebeheer voor de ondertekenflow met gebruikersautorisatie. Tussen het
// voorbereiden van de documenten en de callback verlaat de accountant de
// applicatie, dus alles wat we daarna nodig hebben ligt vast in de database.

export type CscSessionStatus = 'PREPARED' | 'AUTHORIZING' | 'SIGNED' | 'FAILED' | 'EXPIRED'

/** 32 random bytes: onvoorspelbaar, en onze CSRF-bescherming op de redirect. */
export function newState(): string {
  return randomBytes(32).toString('base64url')
}

export interface CreateSessionInput {
  accountantId: string
  credentialId: string
  dossierId?: string | null
  /** Volgorde is bindend: signHash geeft de handtekeningen in deze orde terug. */
  documentIds: string[]
  preparedKeys: Record<string, string>
  hashesBase64: Record<string, string>
  serviceToken?: string | null
}

export async function createSession(input: CreateSessionInput): Promise<{ id: string; state: string }> {
  const state = newState()
  const session = await prisma.cscSigningSession.create({
    data: {
      state,
      accountantId: input.accountantId,
      credentialId: input.credentialId,
      dossierId: input.dossierId ?? null,
      documentIds: input.documentIds,
      preparedKeys: input.preparedKeys,
      hashes: input.hashesBase64,
      // Nooit in leesbare vorm: hetzelfde envelope-schema als de documentopslag.
      serviceToken: input.serviceToken
        ? encryptString(env.STORAGE_ENCRYPTION_KEY, input.serviceToken)
        : null,
      status: 'PREPARED',
      expiresAt: new Date(Date.now() + env.CLEVERBASE_SIGN_TIMEOUT_MS)
    },
    select: { id: true, state: true }
  })
  return session
}

export type ResolveSessionResult =
  | { ok: true; session: ResolvedSession }
  | { ok: false; reason: 'onbekend' | 'verlopen' | 'afgehandeld' | 'geen-eigenaar' }

export interface ResolvedSession {
  id: string
  state: string
  accountantId: string
  credentialId: string
  dossierId: string | null
  documentIds: string[]
  preparedKeys: Record<string, string>
  hashesBase64: Record<string, string>
  serviceToken: string | null
  status: CscSessionStatus
}

/**
 * Zoekt de sessie bij een state uit de callback en controleert:
 *  - bestaat de state (CSRF: een aanvaller kan hem niet raden);
 *  - hoort de sessie bij de INGELOGDE accountant (anders een IDOR op de flow);
 *  - is hij niet verlopen of al afgehandeld.
 */
export async function resolveSession(state: string, currentAccountantId: string): Promise<ResolveSessionResult> {
  if (!state || state.length < 20) return { ok: false, reason: 'onbekend' }
  const row = await prisma.cscSigningSession.findUnique({ where: { state } })
  if (!row) return { ok: false, reason: 'onbekend' }
  // Bewust vóór de vervalcheck: over een sessie van iemand anders zeggen we niets.
  if (row.accountantId !== currentAccountantId) return { ok: false, reason: 'geen-eigenaar' }
  if (row.status === 'SIGNED' || row.status === 'FAILED') return { ok: false, reason: 'afgehandeld' }
  if (row.expiresAt.getTime() < Date.now() || row.status === 'EXPIRED') {
    await markSession(row.id, 'EXPIRED', 'sessie verlopen voordat de bevestiging binnenkwam')
    return { ok: false, reason: 'verlopen' }
  }
  return {
    ok: true,
    session: {
      id: row.id,
      state: row.state,
      accountantId: row.accountantId,
      credentialId: row.credentialId,
      dossierId: row.dossierId,
      documentIds: row.documentIds,
      preparedKeys: (row.preparedKeys ?? {}) as Record<string, string>,
      hashesBase64: (row.hashes ?? {}) as Record<string, string>,
      serviceToken: row.serviceToken ? decryptString(env.STORAGE_ENCRYPTION_KEY, row.serviceToken) : null,
      status: row.status as CscSessionStatus
    }
  }
}

export async function markSession(id: string, status: CscSessionStatus, error?: string): Promise<void> {
  await prisma.cscSigningSession.update({
    where: { id },
    data: { status, lastError: error?.slice(0, 1000) ?? null }
  })
}

/**
 * Ruimt verlopen sessies op: de voorbereide tijdelijke PDF's weg en de sessie op
 * EXPIRED. Wordt door de CSC_SESSION_CLEANUP-job aangeroepen.
 */
export async function cleanupExpiredSessions(now = new Date()): Promise<number> {
  const stale = await prisma.cscSigningSession.findMany({
    where: { status: { in: ['PREPARED', 'AUTHORIZING'] }, expiresAt: { lt: now } },
    select: { id: true, preparedKeys: true }
  })
  if (stale.length === 0) return 0
  const { storage } = await import('@/lib/storage')
  const store = storage()
  for (const s of stale) {
    const keys = Object.values((s.preparedKeys ?? {}) as Record<string, string>)
    for (const key of keys) {
      await store.remove(key).catch(() => {})
    }
    await markSession(s.id, 'EXPIRED', 'opgeruimd: bevestiging niet ontvangen binnen de geldigheidsduur')
  }
  return stale.length
}

/**
 * Controleert bij de provider of het certificaat nog geldig is. Cleverbase trekt
 * het beroepscertificaat in zodra de NBA-inschrijving eindigt of wordt geschorst;
 * dan moet het portaal daar meteen naar handelen.
 *
 * Wordt bij ELKE ondertekensessie aangeroepen, niet alleen bij het inrichten.
 */
export async function assertCredentialUsable(input: {
  cfg: CscConfig
  serviceToken: string
  accountantId: string
  credentialId: string
}): Promise<{ ok: true; certificates: string[] } | { ok: false; reason: string }> {
  const info = await credentialInfo(input.cfg, input.serviceToken, input.credentialId)
  const status = (info.keyStatus ?? '').toLowerCase()
  await prisma.accountant.update({
    where: { id: input.accountantId },
    data: { signingCertStatus: info.keyStatus }
  })

  if (status && status !== 'enabled') {
    // Intrekking of schorsing: certificaat uitzetten, vastleggen en melden.
    await prisma.accountant.update({
      where: { id: input.accountantId },
      data: { signingCertEnabled: false, signingCertDisabledAt: new Date() }
    })
    const acc = await prisma.accountant.findUnique({
      where: { id: input.accountantId },
      select: { name: true, email: true }
    })
    await writeAudit({
      type: 'CERTIFICAAT_INGETROKKEN',
      accountantId: input.accountantId,
      message: `certificaatstatus bij de provider: ${info.keyStatus ?? 'onbekend'}`,
      metadata: { credentialId: input.credentialId, status: info.keyStatus }
    })
    await notifyCertificateDisabled(acc?.name ?? 'onbekend', info.keyStatus ?? 'onbekend')
    return {
      ok: false,
      reason:
        `Het beroepscertificaat is bij de provider niet bruikbaar (status: ${info.keyStatus ?? 'onbekend'}). ` +
        'Gekwalificeerd ondertekenen is voor deze gebruiker uitgezet.'
    }
  }
  if (info.certificates.length === 0) {
    return { ok: false, reason: 'De provider gaf geen certificaatketen terug; ondertekenen kan niet.' }
  }
  return { ok: true, certificates: info.certificates }
}

async function notifyCertificateDisabled(name: string, status: string): Promise<void> {
  const beheerders = await prisma.accountant.findMany({
    where: { role: 'BEHEERDER', active: true },
    select: { email: true }
  })
  if (beheerders.length === 0) return
  const subject = `Beroepscertificaat niet meer bruikbaar: ${name}`
  const text =
    `Het beroepscertificaat van ${name} is bij de provider niet meer bruikbaar (status: ${status}).\n\n` +
    `Gekwalificeerd ondertekenen is voor deze gebruiker automatisch uitgezet. Dit gebeurt onder meer ` +
    `wanneer de inschrijving in het NBA-register eindigt of wordt geschorst.`
  for (const b of beheerders) {
    await sendMail({
      to: b.email,
      subject,
      text,
      html: `<p>${text.replace(/\n\n/g, '</p><p>')}</p>`
    }).catch((e) => console.error('[certificaat ingetrokken mail]', e))
  }
}
