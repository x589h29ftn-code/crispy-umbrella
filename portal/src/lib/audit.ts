import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { AUDIT_LOCK_NAMESPACE, GEEN_DOSSIER } from '@/lib/locks'

export type AuditType =
  | 'AANGEMAAKT'
  | 'VERZONDEN'
  | 'GEOPEND'
  | 'OTP_VERSTUURD'
  | 'OTP_GEVERIFIEERD'
  | 'OTP_MISLUKT'
  | 'OTP_GEBLOKKEERD'
  // Herverificatie met een verse TOTP-code bij het ondertekenen door een
  // kantoorgebruiker. De tegenhanger van OTP_GEVERIFIEERD aan de cliëntkant.
  | 'HERVERIFICATIE_GESLAAGD'
  | 'HERVERIFICATIE_MISLUKT'
  // Een ZELF-ontvanger is overgedragen aan een andere accountant (vakantie,
  // ziekte). Expliciet, met van wie naar wie en door wie.
  | 'ONTVANGER_OVERGEDRAGEN'
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
  // Verlopen verzoek opnieuw verstuurd. Alleen bij VERLOPEN; GEWEIGERD is
  // onherroepelijk en levert een nieuw dossier op.
  | 'HERVERZONDEN'
  | 'MAIL_AFGELEVERD'
  | 'MAIL_GEBOUNCED'
  | 'MAIL_KLACHT'
  // Alleen procesindicatie: openen is onbetrouwbaar en komt bewust NIET op het
  // ondertekencertificaat.
  | 'MAIL_GEOPEND'
  | 'VERLOPEN'
  | 'VERZEGELD'
  | 'VERZEGELING_MISLUKT'
  // Verzegeling stond uit (SEAL_MODE=none): zo is later aanwijsbaar welke stukken
  // uit die periode komen.
  | 'VERZEGELING_OVERGESLAGEN'
  // Grafsteen bij het opruimen door de bewaartermijn, in de ketenloze reeks.
  | 'BEWAARTERMIJN_OPGERUIMD'
  | 'INTEGRITEIT_AFWIJKING'
  | 'GEDOWNLOAD'
  // Het losse auditrapport is opgemaakt (of dat is mislukt).
  | 'AUDITRAPPORT_OPGEMAAKT'
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

/**
 * Berekent de schakel in de hashketen over de inhoud van deze regel.
 *
 * Geëxporteerd zodat het auditrapport de keten van één dossier kan nalopen. De
 * volledige `verifyAuditChain` loopt álle ketens door en zou op het rapport van
 * dossier A melden dat er iets mis is in dossier B — misleidend, want dat zegt
 * niets over dít stuk.
 */
export function chainHash(input: {
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
 * Schrijft één append-only auditregel en hangt hem aan de hashketen.
 *
 * Twee standen. Voor de meeste soorten (`bestEffort`) mag het auditspoor de flow
 * niet blokkeren: een mislukte GEDOWNLOAD-regel is hinderlijk, geen ramp. Voor de
 * bewijskritieke soorten (`required`, zie VERPLICHTE_TYPEN) is stil falen wél een
 * probleem: dan is er een handtekening zonder bewijsspoor, precies het scenario
 * waarvoor het auditspoor bestaat. Die gooien door, zodat de aanroeper terugrolt.
 *
 * De keten maakt manipulatie in de database aantoonbaar: wie een regel wijzigt
 * of verwijdert, breekt de keten vanaf dat punt. In de database staat daarnaast
 * een trigger die UPDATE en DELETE hoe dan ook weigert.
 */

/**
 * Gebeurtenissen waarbij stil falen onacceptabel is. Bij deze soorten is de
 * auditregel het bewijs zelf: een handtekening zonder spoor is precies het
 * scenario waarvoor het auditspoor bestaat.
 *
 * De lijst blijft kort. Elke toevoeging maakt het ondertekenen afhankelijk van
 * het auditpad, en dat is een beschikbaarheidsrisico.
 */
const VERPLICHTE_TYPEN: ReadonlySet<AuditType> = new Set<AuditType>([
  'ONDERTEKEND',
  'GEKWALIFICEERD_ONDERTEKEND',
  'OTP_GEVERIFIEERD',
  // De tegenhanger van OTP_GEVERIFIEERD voor de kantoorkant: dit is wat bewijst
  // dat de accountant er op dat moment zélf bij was.
  'HERVERIFICATIE_GESLAAGD',
  'VERZEGELD',
  'GEWEIGERD'
])

/** Minimale vorm van een Prisma-client; werkt zowel met prisma als met een tx. */
type AuditClient = Pick<Prisma.TransactionClient, 'auditEvent' | '$executeRaw'>

export interface WriteAuditOptions {
  /**
   * `required` gooit door en laat de omliggende transactie terugrollen;
   * `bestEffort` logt luid en gaat verder. Standaard wordt de soort bepaald door
   * VERPLICHTE_TYPEN, zodat een aanroep zonder opties toch het juiste doet.
   */
  mode?: 'required' | 'bestEffort'
  /** Schrijf binnen een bestaande transactie, zodat een throw die meeneemt. */
  tx?: Prisma.TransactionClient
}

/** Het eigenlijke schrijven; verwacht een client waarin al een transactie loopt. */
async function schrijfRegel(client: AuditClient, input: AuditInput): Promise<void> {
  const createdAt = new Date()
  // De keten loopt PER DOSSIER, niet globaal. Dat is bewust: de bewaartermijn
  // ruimt een compleet dossier op, en bij één globale keten zou zo'n legitieme
  // opruiming de keten breken. Een keten die altijd "gebroken" is, wordt
  // genegeerd en beschermt dus niets. Regels zonder dossier (inloggen,
  // certificaat ingetrokken) vormen samen één eigen keten.
  const chainKey = input.dossierId ?? GEEN_DOSSIER
  // Eén schrijver per keten. Zonder deze vergrendeling lezen twee gelijktijdige
  // schrijvers (twee ondertekenaars die op hetzelfde moment indienen) dezelfde
  // laatste regel, verwijzen beide nieuwe regels naar dezelfde prevHash, en vorkt
  // de keten. De verificatie meldt dan voor altijd een breuk die niemand heeft
  // veroorzaakt — precies het soort valse alarm waardoor een controle wordt
  // genegeerd.
  //
  // `_xact_` en niet de sessievariant: een sessie-lock overleeft het einde van de
  // transactie en gaat met de verbinding terug in de pool, waarna die keten voor
  // altijd blokkeert. Transactie-locks vallen bij commit én rollback vrij.
  //
  // De casts zijn nodig: zonder ze stuurt de driver een bigint mee en bestaat er
  // geen pg_advisory_xact_lock met die signatuur.
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_NAMESPACE}::int, hashtext(${chainKey})::int)`
  const prev = await client.auditEvent.findFirst({
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
  await client.auditEvent.create({
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
}

export async function writeAudit(input: AuditInput, opts?: WriteAuditOptions): Promise<void> {
  const mode = opts?.mode ?? (VERPLICHTE_TYPEN.has(input.type) ? 'required' : 'bestEffort')
  try {
    if (opts?.tx) {
      await schrijfRegel(opts.tx, input)
    } else {
      await prisma.$transaction((tx) => schrijfRegel(tx, input))
    }
  } catch (e) {
    if (mode === 'required') {
      // Doorgooien: de aanroeper hoort hierop terug te rollen. Een handtekening
      // zonder bewijsregel is erger dan een mislukte indiening die te herhalen is.
      console.error(`[audit] VERPLICHTE auditregel ${input.type} mislukt`, e)
      throw new AuditWriteError(input.type, e as Error)
    }
    console.error('[audit] kon auditregel niet schrijven', e)
  }
}

/** Fout bij een verplichte auditregel; de aanroeper moet hierop terugrollen. */
export class AuditWriteError extends Error {
  constructor(
    readonly auditType: AuditType,
    readonly cause: Error
  ) {
    super(`auditregel ${auditType} kon niet worden vastgelegd: ${cause.message}`)
    this.name = 'AuditWriteError'
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
 * Wat dit aantoont:
 *  - elke wijziging aan een regel (de inhoud past niet meer bij de hash);
 *  - elke verwijdering middenin een keten (de volgende regel sluit niet aan);
 *  - het verwijderen van de KOP van een keten. Dat werkt via één invariant: de
 *    eerste regel van een keten heeft prevHash = null. Knipt iemand de kop eraf,
 *    dan begint de keten met een regel die naar een hash verwijst die niet meer
 *    bestaat, en dat is zichtbaar.
 *
 * Waar de grens ligt: dit beschermt tegen DELETE. Wie de noodschakelaar
 * app.audit_purge kan zetten, kan ook UPDATE en daarmee de hele keten
 * herschrijven. Het is dus een beveiliging tegen applicatiefouten en tegen
 * databasetoegang zónder applicatietoegang, niet tegen een beheerder met alle
 * rechten. Zie docs/beheer.md.
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
      const isChainStart = !s
      if (!s) {
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

      // De invariant die het afknippen van de kop aantoonbaar maakt: de eerste
      // regel van een keten hoort prevHash = null te hebben. Is dat niet zo, dan
      // verwijst hij naar een voorganger die er niet meer is.
      if (isChainStart && row.prevHash !== null) {
        return fail('eerste regel van deze keten verwijst naar een ontbrekende voorganger')
      }
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
