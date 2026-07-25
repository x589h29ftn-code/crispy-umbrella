import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export type AuditType =
  | 'AANGEMAAKT'
  | 'VERZONDEN'
  | 'GEOPEND'
  | 'OTP_VERSTUURD'
  | 'OTP_GEVERIFIEERD'
  | 'OTP_MISLUKT'
  | 'OTP_GEBLOKKEERD'
  | 'TOEGANGSCODE_GEVERIFIEERD'
  | 'TOEGANGSCODE_MISLUKT'
  | 'ONDERTEKEND'
  | 'GEKWALIFICEERD_ONDERTEKEND'
  | 'CSC_AUTORISATIE_GESTART'
  | 'CSC_AUTORISATIE_ONTVANGEN'
  | 'CSC_AUTORISATIE_VERLOPEN'
  | 'CSC_ONDERTEKENING_MISLUKT'
  | 'CERTIFICAAT_INGETROKKEN'
  | 'GEWEIGERD'
  | 'HERINNERD'
  | 'MAIL_AFGELEVERD'
  | 'MAIL_GEBOUNCED'
  | 'MAIL_KLACHT'
  // Alleen procesindicatie: openen is onbetrouwbaar en komt bewust NIET op het
  // ondertekencertificaat.
  | 'MAIL_GEOPEND'
  | 'VERLOPEN'
  | 'VERZEGELD'
  | 'VERZEGELING_MISLUKT'
  | 'INTEGRITEIT_AFWIJKING'
  | 'GEDOWNLOAD'
  | 'INGETROKKEN'
  | 'INGELOGD'
  | 'GEARCHIVEERD'

export interface AuditInput {
  type: AuditType
  dossierId?: string
  accountantId?: string
  recipientId?: string
  message?: string
  ip?: string
  userAgent?: string
  metadata?: Prisma.InputJsonValue
}

/**
 * Stabiele JSON-weergave: sleutels gesorteerd, op elk niveau. Nodig omdat
 * Postgres JSONB de sleutelvolgorde niet bewaart — zonder canonicalisatie zou de
 * keten na het teruglezen onterecht "gebroken" lijken.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** Berekent de schakel in de hashketen over de inhoud van deze regel. */
function chainHash(input: {
  prevHash: string | null
  type: string
  dossierId?: string | null
  recipientId?: string | null
  message?: string | null
  metadata?: unknown
  createdAt: Date
}): string {
  const parts = [
    input.prevHash ?? '',
    input.type,
    input.dossierId ?? '',
    input.recipientId ?? '',
    input.message ?? '',
    input.metadata === undefined || input.metadata === null ? '' : canonicalJson(input.metadata),
    input.createdAt.toISOString()
  ]
  return createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

/**
 * Schrijft één append-only auditregel en hangt hem aan de hashketen. Faalt stil
 * (het auditspoor mag de flow nooit blokkeren), maar logt wel luid.
 *
 * De keten maakt manipulatie in de database aantoonbaar: wie een regel wijzigt
 * of verwijdert, breekt de keten vanaf dat punt. In de database staat daarnaast
 * een trigger die UPDATE en DELETE hoe dan ook weigert.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const createdAt = new Date()
    // De keten loopt PER DOSSIER, niet globaal. Dat is bewust: de bewaartermijn
    // ruimt een compleet dossier op, en bij één globale keten zou zo'n legitieme
    // opruiming de keten breken. Een keten die altijd "gebroken" is, wordt
    // genegeerd en beschermt dus niets. Regels zonder dossier (inloggen,
    // certificaat ingetrokken) vormen samen één eigen keten.
    const prev = await prisma.auditEvent.findFirst({
      where: { dossierId: input.dossierId ?? null },
      orderBy: [{ seq: 'desc' }],
      select: { hash: true }
    })
    const prevHash = prev?.hash ?? null
    const hash = chainHash({
      prevHash,
      type: input.type,
      dossierId: input.dossierId,
      recipientId: input.recipientId,
      message: input.message,
      metadata: input.metadata,
      createdAt
    })
    await prisma.auditEvent.create({
      data: {
        type: input.type,
        dossierId: input.dossierId,
        accountantId: input.accountantId,
        recipientId: input.recipientId,
        message: input.message,
        ipAddress: input.ip,
        userAgent: input.userAgent,
        metadata: input.metadata,
        createdAt,
        prevHash,
        hash
      }
    })
  } catch (e) {
    console.error('[audit] kon auditregel niet schrijven', e)
  }
}

export interface ChainVerifyResult {
  ok: boolean
  checked: number
  /** Aantal gecontroleerde ketens (één per dossier, plus één zonder dossier). */
  chains: number
  /** Eerste regel waar een keten breekt (null als alles klopt). */
  brokenAt: { id: string; type: string; createdAt: Date; reason: string; dossierId: string | null } | null
}

/**
 * Loopt de volledige hashketen door en meldt waar hij breekt.
 *
 * Wat dit wél aantoont: elke wijziging aan een regel, en elke verwijdering
 * middenin de reeks (de volgende regel sluit dan niet meer aan of er ontbreekt
 * een volgnummer).
 *
 * Wat dit NIET aantoont: het verwijderen van de oudste regels aan het begin.
 * Daarvoor is een anker buiten deze database nodig. De opruiming door de
 * bewaartermijn doet precies dat legitiem, dus het beginvolgnummer wordt
 * gerapporteerd in plaats van als fout aangemerkt.
 *
 * Regels van vóór de invoering van de keten (hash = null) worden overgeslagen.
 */
export async function verifyAuditChain(batchSize = 2000): Promise<ChainVerifyResult> {
  // Per keten bijhouden waar we zijn. Regels van verschillende dossiers staan door
  // elkaar heen, dus we lopen één keer door alles en houden per keten de stand bij.
  const state = new Map<string, { prevHash: string | null; started: boolean }>()
  let cursor: string | undefined
  let checked = 0

  for (;;) {
    const rows = await prisma.auditEvent.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ seq: 'asc' }],
      select: {
        id: true,
        type: true,
        dossierId: true,
        recipientId: true,
        message: true,
        metadata: true,
        createdAt: true,
        prevHash: true,
        hash: true
      }
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id

    for (const row of rows) {
      // Regel van vóór de hashketen: overslaan.
      if (row.hash === null) continue

      const key = row.dossierId ?? ''
      let s = state.get(key)
      if (!s) {
        // Begin van deze keten: nemen we als startpunt.
        s = { prevHash: row.prevHash, started: true }
        state.set(key, s)
      }

      const fail = (reason: string): ChainVerifyResult => ({
        ok: false,
        checked,
        chains: state.size,
        brokenAt: {
          id: row.id,
          type: row.type,
          createdAt: row.createdAt,
          reason,
          dossierId: row.dossierId
        }
      })

      if (row.prevHash !== s.prevHash) return fail('prevHash sluit niet aan binnen deze keten')
      const expected = chainHash({
        prevHash: row.prevHash,
        type: row.type,
        dossierId: row.dossierId,
        recipientId: row.recipientId,
        message: row.message,
        metadata: row.metadata,
        createdAt: row.createdAt
      })
      if (expected !== row.hash) return fail('inhoud wijkt af van de hash')

      s.prevHash = row.hash
      checked += 1
    }
  }
  return { ok: true, checked, chains: state.size, brokenAt: null }
}
