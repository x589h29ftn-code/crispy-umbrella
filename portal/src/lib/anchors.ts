import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { canonicalJson } from '@/lib/audit'
import { sendMail } from '@/lib/email/transport'
import { archiveEnabled, archiveDossier } from '@/lib/archive'

// Ankers: de kop van de auditketen buiten de database vastleggen.
//
// Waarom. De hashketen maakt elke wijziging van een bestaande regel zichtbaar,
// maar iemand die de hele database kan herschrijven kan de keten ook consistent
// opnieuw uitrekenen. Dat is niet de kwaadwillende beheerder als voornaamste
// scenario, maar databasetoegang ZONDER applicatietoegang: een gelekte
// DATABASE_URL, een gestolen dump, een gecompromitteerde db-container. Wie dan de
// keten herschrijft, kan een anker dat elders staat niet bijwerken.
//
// Wat het NIET oplost, en dat is belangrijk om niet te overschatten: een
// herschrijving van gebeurtenissen TUSSEN twee ankers blijft onzichtbaar. Dat
// venster sluit alleen een HMAC-keten met een sleutel die niet in de database
// staat. Het anker bij afronding sluit het venster wel voor het bewijs dat telt:
// op dat moment is het dossier definitief.
//
// Twee bestemmingen, niet één. Het archief is best-effort en mail kan stil falen;
// met één bestemming heb je geen anker maar de illusie ervan.

export interface AnchorChain {
  dossierId: string | null
  laatsteSeq: string
  /** Null alleen bij regels van vóór de hashketen; die zijn er in de praktijk niet. */
  laatsteHash: string | null
  regels: number
}

export interface AnchorPayload {
  kind: 'dossier' | 'dagelijks'
  opgemaaktOp: string
  ketens: AnchorChain[]
}

/** Bestemmingen uit AUDIT_ANCHOR_TARGETS: 'archief' en/of 'mail'. */
export function anchorTargets(): ('archief' | 'mail')[] {
  return env.AUDIT_ANCHOR_TARGETS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is 'archief' | 'mail' => s === 'archief' || s === 'mail')
}

export function anchoringEnabled(): boolean {
  return anchorTargets().length > 0
}

async function ketenVan(dossierId: string | null): Promise<AnchorChain | null> {
  // Prisma wil hier expliciet null en niet undefined voor de dossierloze keten.
  const [laatste, regels] = await Promise.all([
    prisma.auditEvent.findFirst({
      where: { dossierId },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true }
    }),
    prisma.auditEvent.count({ where: { dossierId } })
  ])
  if (!laatste) return null
  return {
    dossierId: dossierId ?? null,
    laatsteSeq: laatste.seq.toString(),
    laatsteHash: laatste.hash,
    regels
  }
}

function anchorTekst(payload: AnchorPayload): string {
  const regels = [
    'Anker van het auditspoor — Ondertekenportaal Otto Visser & Partners',
    '',
    `Soort:      ${payload.kind === 'dossier' ? 'bij afronding van een dossier' : 'dagelijkse stand'}`,
    `Opgemaakt:  ${payload.opgemaaktOp}`,
    '',
    'Bewaar dit bericht. Het legt de stand van het auditspoor vast op dit moment.',
    'Wijkt de database later af van onderstaande hashes, dan is het spoor gewijzigd.',
    ''
  ]
  for (const k of payload.ketens) {
    regels.push(`Keten:      ${k.dossierId ?? '(regels zonder dossier)'}`)
    regels.push(`  regels:   ${k.regels}`)
    regels.push(`  laatste:  #${k.laatsteSeq}`)
    regels.push(`  hash:     ${k.laatsteHash}`)
    regels.push('')
  }
  return regels.join('\n')
}

/**
 * Legt een anker vast en verstuurt het naar alle ingestelde bestemmingen.
 *
 * Faalt nooit hard: een mislukte bestemming wordt vastgelegd, zodat de dagelijkse
 * controle kan zien dat er drie dagen achter elkaar niets is aangekomen.
 */
export async function writeAnchor(input: {
  kind: 'dossier' | 'dagelijks'
  dossierIds?: (string | null)[]
}): Promise<{ id: string; delivered: boolean } | null> {
  const targets = anchorTargets()
  if (targets.length === 0) return null

  let ketens: AnchorChain[] = []
  if (input.kind === 'dossier') {
    for (const id of input.dossierIds ?? []) {
      const k = await ketenVan(id)
      if (k) ketens.push(k)
    }
  } else {
    // Alle ketens die nog lopen, plus de dossierloze reeks.
    const dossiers = await prisma.dossier.findMany({
      where: { status: { notIn: ['ONDERTEKEND', 'GEWEIGERD', 'VERLOPEN'] } },
      select: { id: true }
    })
    for (const d of dossiers) {
      const k = await ketenVan(d.id)
      if (k) ketens.push(k)
    }
    const zonder = await ketenVan(null)
    if (zonder) ketens.push(zonder)
  }
  if (ketens.length === 0) return null
  // Vaste volgorde, anders verschilt de hash bij dezelfde inhoud.
  ketens = ketens.sort((a, b) => String(a.dossierId).localeCompare(String(b.dossierId)))

  const payload: AnchorPayload = {
    kind: input.kind,
    opgemaaktOp: new Date().toISOString(),
    ketens
  }
  const hash = createHash('sha256').update(canonicalJson(payload)).digest('hex')
  const tekst = anchorTekst(payload)
  const bestandsnaam = `auditanker-${payload.kind}-${payload.opgemaaktOp.slice(0, 19).replace(/[:T]/g, '-')}.txt`

  const deliveries: { target: string; ok: boolean; detail?: string }[] = []

  if (targets.includes('archief')) {
    if (!archiveEnabled()) {
      deliveries.push({ target: 'archief', ok: false, detail: 'archiefdriver staat uit' })
    } else {
      try {
        await archiveDossier({
          folder: env.AUDIT_ANCHOR_ARCHIVE_FOLDER,
          files: [{ filename: bestandsnaam, content: Buffer.from(tekst, 'utf8') }]
        })
        deliveries.push({ target: 'archief', ok: true })
      } catch (e) {
        deliveries.push({ target: 'archief', ok: false, detail: (e as Error).message.slice(0, 300) })
      }
    }
  }

  if (targets.includes('mail')) {
    const to = env.AUDIT_ANCHOR_MAIL_TO
    if (!to) {
      deliveries.push({ target: 'mail', ok: false, detail: 'AUDIT_ANCHOR_MAIL_TO ontbreekt' })
    } else {
      try {
        await sendMail({
          to,
          subject: `Auditanker ${payload.kind} — ${payload.opgemaaktOp.slice(0, 10)} (${hash.slice(0, 12)})`,
          text: tekst,
          html: `<pre style="font-family:ui-monospace,monospace;font-size:12px">${tekst
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')}</pre>`
        })
        deliveries.push({ target: 'mail', ok: true })
      } catch (e) {
        deliveries.push({ target: 'mail', ok: false, detail: (e as Error).message.slice(0, 300) })
      }
    }
  }

  const delivered = deliveries.some((d) => d.ok)
  const row = await prisma.auditAnchor.create({
    data: {
      kind: payload.kind,
      dossierId: input.kind === 'dossier' ? (input.dossierIds?.[0] ?? null) : null,
      payload: payload as unknown as object,
      hash,
      deliveries,
      delivered
    },
    select: { id: true }
  })
  if (!delivered) console.error('[anker] geen enkele bestemming gelukt', deliveries)
  return { id: row.id, delivered }
}

/**
 * Zijn er drie dagen achter elkaar geen ankers aangekomen? Dan is het anker een
 * illusie geworden en moet iemand het weten.
 */
export async function anchorHealth(now = new Date()): Promise<{
  ok: boolean
  laatsteGelukt: Date | null
  dagenStil: number
}> {
  if (!anchoringEnabled()) return { ok: true, laatsteGelukt: null, dagenStil: 0 }
  const laatste = await prisma.auditAnchor.findFirst({
    where: { delivered: true },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true }
  })
  if (!laatste) return { ok: false, laatsteGelukt: null, dagenStil: Infinity }
  const dagen = Math.floor((now.getTime() - laatste.createdAt.getTime()) / 86_400_000)
  return { ok: dagen < 3, laatsteGelukt: laatste.createdAt, dagenStil: dagen }
}
