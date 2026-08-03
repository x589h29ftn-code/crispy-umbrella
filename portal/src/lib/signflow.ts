import 'server-only'
import type { Dossier, Recipient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { hashSigningToken, generateSigningToken } from '@/lib/auth/signingToken'
import { storage } from '@/lib/storage'
import { stampSignatureImage } from '@/lib/pdf/signing'
import { sealDocument } from '@/lib/pdf/seal'
import { sealEnabled, sealRoute, sealPdf, sha256Hex, SealRetryableError, AlreadySealedError } from '@/lib/seal/sealer'
import { enqueueOnce } from '@/lib/jobs/queue'
import { recomputeStatus } from '@/lib/status'
import { writeAudit } from '@/lib/audit'
import { sendMail } from '@/lib/email/transport'
import { requestEmail, completedEmail, officeTurnEmail } from '@/lib/email/templates'
import { renderTemplate, firstNameFrom } from '@/lib/docanalyze/templates'
import { archiveDossier, archiveEnabled, buildDefaultFolder } from '@/lib/archive'
import { blobBewaardagen } from '@/lib/retention'
import { dossierVerzegelt, dossierRoute } from '@/lib/assurance'
import { buildAuditReportFor } from '@/lib/auditReportData'

/** Datum/tijd voor het zichtbare stempel, bijv. "23-9-2020 14:04:44". */
function formatStampDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export type ResolveResult =
  | { ok: true; recipient: Recipient; dossier: Dossier }
  | { ok: false; reason: 'onbekend' | 'verlopen' | 'gebruikt' | 'afgerond' }

/** Zoekt de externe ontvanger bij een ruwe tekentoken en valideert geldigheid. */
export async function resolveToken(raw: string): Promise<ResolveResult> {
  if (!raw || raw.length < 10) return { ok: false, reason: 'onbekend' }
  const recipient = await prisma.recipient.findUnique({
    where: { tokenHash: hashSigningToken(raw) },
    include: { dossier: true }
  })
  if (!recipient || !recipient.tokenHash) return { ok: false, reason: 'onbekend' }
  if (recipient.tokenUsedAt || recipient.status !== 'PENDING') return { ok: false, reason: 'gebruikt' }
  if (!recipient.tokenExpiresAt || recipient.tokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'verlopen' }
  }
  const { dossier } = recipient
  if (!['VERZONDEN', 'GEDEELTELIJK'].includes(dossier.status)) return { ok: false, reason: 'afgerond' }
  return { ok: true, recipient, dossier }
}

// ---- Workflow: activeren en doorschuiven ----

/**
 * Activeert één ondertekenaar: een externe cliënt krijgt een tekentoken +
 * e-mail met de link; een kantoorgebruiker krijgt een melding dat het document
 * in het portaal op zijn handtekening wacht.
 */
export async function activateSigner(recipientId: string): Promise<void> {
  const r = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: {
      client: true,
      dossier: { include: { owner: true, documents: { orderBy: { order: 'asc' }, take: 1, select: { detectedYear: true } } } }
    }
  })
  if (!r) return
  const dossier = r.dossier

  if (r.role === 'ZELF' && r.accountantId) {
    // Kantoorgebruiker: tekent ingelogd in het portaal.
    const mail = officeTurnEmail({
      recipientName: r.name,
      documentTitle: dossier.title,
      url: `${env.APP_URL}/te-ondertekenen`
    })
    await sendMail({ to: r.email, ...mail }).catch((e) => console.error('[activate office mail]', e))
    await writeAudit({ type: 'VERZONDEN', dossierId: dossier.id, recipientId: r.id, message: `${r.email} (kantoor)` })
    return
  }

  // Externe cliënt: eenmalige token + uitnodigingsmail met de link.
  const ttlMs = dossier.linkTtlDays * 24 * 60 * 60 * 1000
  const { raw, hash } = generateSigningToken()
  await prisma.recipient.update({
    where: { id: r.id },
    data: {
      tokenHash: hash,
      tokenExpiresAt: new Date(Date.now() + ttlMs),
      tokenUsedAt: null,
      // Nieuwe link ⇒ 2e factor opnieuw vereist.
      otpVerifiedAt: null,
      otpHash: null,
      otpExpiresAt: null
    }
  })
  // Vul de invulvelden in het begeleidend bericht in voor deze ontvanger.
  const resolvedMessage = dossier.message
    ? renderTemplate(dossier.message, {
        voornaamKlant: firstNameFrom(r.client?.firstName, r.client?.contactName) ?? r.name,
        bedrijfsnaam: r.client?.companyName ?? r.client?.displayName ?? null,
        boekjaar: dossier.documents[0]?.detectedYear ?? null,
        documenttitel: dossier.title,
        voornaamAfzender: firstNameFrom(dossier.owner.name) ?? dossier.owner.name
      })
    : null

  const mail = requestEmail({
    recipientName: r.name,
    senderName: dossier.owner.name,
    documentTitle: dossier.title,
    url: `${env.APP_URL}/teken/${raw}`,
    message: resolvedMessage
  })
  // Het message-id vastleggen zodat de bezorgstatus (afgeleverd/bounce) later aan
  // deze ontvanger gekoppeld kan worden.
  try {
    const sent = await sendMail({ to: r.email, ...mail })
    await prisma.recipient.update({
      where: { id: r.id },
      data: {
        mailMessageId: sent.messageId,
        mailStatus: 'SENT',
        mailStatusAt: new Date(),
        mailBounceType: null,
        mailBounceReason: null
      }
    })
  } catch (e) {
    console.error('[activate client mail]', e)
    await prisma.recipient.update({
      where: { id: r.id },
      data: { mailStatus: 'FAILED', mailStatusAt: new Date(), mailBounceReason: (e as Error).message.slice(0, 500) }
    })
  }
  await writeAudit({ type: 'VERZONDEN', dossierId: dossier.id, recipientId: r.id, message: r.email })
}

/** Activeert bij het versturen: sequentieel de eerste, parallel iedereen. */
export async function activateInitial(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: { recipients: { orderBy: { order: 'asc' } } }
  })
  if (!dossier) return
  const pending = dossier.recipients.filter((r) => r.status === 'PENDING')
  if (pending.length === 0) return
  if (dossier.signingMode === 'SEQUENTIAL') {
    await activateSigner(pending[0].id)
  } else {
    for (const r of pending) await activateSigner(r.id)
  }
}

/** Geeft de ondertekenaar(s) die nu aan de beurt zijn. */
export function currentSigners<T extends { status: string; order: number }>(dossier: { signingMode: string }, recipients: T[]): T[] {
  const pending = recipients.filter((r) => r.status === 'PENDING').sort((a, b) => a.order - b.order)
  if (pending.length === 0) return []
  return dossier.signingMode === 'SEQUENTIAL' ? [pending[0]] : pending
}

/** Verwerkt de handtekening van één ondertekenaar en schuift de workflow door. */
export async function applySignature(
  recipientId: string,
  signatureDataUrl: string,
  ctx: { ip?: string; userAgent?: string }
): Promise<void> {
  const recipient = await prisma.recipient.findUnique({
    where: { id: recipientId },
    include: { dossier: true, fields: { include: { document: true } } }
  })
  if (!recipient) throw new Error('Ontvanger niet gevonden')
  const dossier = recipient.dossier

  const store = storage()
  const signedAt = new Date()
  const label = { name: recipient.name, dateText: formatStampDate(signedAt) }

  // Hier wordt alléén het zichtbare stempel gezet. De gekwalificeerde
  // handtekening komt later in de keten (na het auditcertificaat, via de
  // CSC-route in sealAndComplete), want ná het waarmerken mag het bestand niet
  // meer worden bewerkt. Eén ondertekenmechanisme — zie docs/verzegeling.md.

  // Groepeer de velden per document en stempel de handtekening in elk document.
  const byDoc = new Map<string, typeof recipient.fields>()
  for (const f of recipient.fields) {
    const arr = byDoc.get(f.documentId) ?? []
    arr.push(f)
    byDoc.set(f.documentId, arr)
  }
  // Bij PARALLEL ondertekenen kunnen twee ontvangers tegelijk indienen. Zonder
  // serialisatie is dit lees-bewerk-schrijf een race: beiden lezen dezelfde
  // workingKey, stempelen hun eigen handtekening op diezelfde versie, en de
  // laatste schrijver wint. Eén handtekening verdwijnt dan zonder foutmelding,
  // terwijl beide ontvangers op SIGNED staan.
  //
  // De rijvergrendeling hieronder laat gelijktijdige indieningen netjes op elkaar
  // wachten, zodat elke stempel op het resultaat van de vorige komt. Het PDF-werk
  // gebeurt binnen de vergrendeling; dat is bij deze documentgroottes goed te doen
  // en correctheid weegt hier zwaarder dan een korte transactie.
  //
  // Eén transactie voor ALLE documenten plus de ontvangerstatus. Zou elk document
  // zijn eigen transactie hebben, dan kan het proces na document 1 omvallen: de
  // eerste is dan gestempeld, de tweede niet, en de ontvanger staat nog op PENDING
  // met een bruikbaar token. Opnieuw indienen zou document 1 een tweede keer
  // stempelen.
  const documentIds = [...byDoc.keys()].sort()
  /** Oude blobs; pas ná de commit opruimen, want een rollback heeft ze nog nodig. */
  const teVerwijderen: string[] = []
  /** Was deze ondertekening al gedaan? Dan is dit verzoek een herhaling. */
  let alGetekend = false
  await prisma.$transaction(
    async (tx) => {
      // Vergrendelen mag niet onbeperkt wachten: de tweede ondertekenaar hangt
      // anders tot de proxy de verbinding afkapt en weet dan niet of het gelukt is.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`)
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '90s'`)

      // EERST de ontvanger claimen, vóór er één byte wordt gestempeld.
      //
      // Het zetten van de status stond hieronder, ná het stempelen, en dat is een
      // gat: twee gelijktijdige indieningen door DEZELFDE persoon lezen beide een
      // ontvanger op PENDING, komen beide door de tokencontrole, en stempelen dan
      // achter elkaar op hetzelfde document. Resultaat: twee identieke
      // handtekeningen van één persoon en twee ONDERTEKEND-regels, allebei zonder
      // foutmelding. Nagemeten: dat gebeurde ook echt.
      //
      // Een dubbelklik is aan de voorkant afgevangen, maar een herhaalde POST na
      // een haperende verbinding of een tweede tabblad niet.
      //
      // `updateMany` met `status: 'PENDING'` in de voorwaarde is de claim: de
      // database staat maar één winnaar toe. De tweede transactie wacht op de
      // rijvergrendeling, ziet daarna SIGNED en krijgt count 0. Rolt de transactie
      // terug, dan rolt de claim mee terug — dus geen ontvanger die op SIGNED
      // blijft staan zonder stempel.
      const geclaimd = await tx.recipient.updateMany({
        where: { id: recipientId, status: 'PENDING' },
        data: { status: 'SIGNED', signedAt, tokenUsedAt: signedAt }
      })
      if (geclaimd.count === 0) {
        alGetekend = true
        return
      }

      for (const documentId of documentIds) {
        const fields = byDoc.get(documentId)!
        await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR UPDATE`
        // Binnen de vergrendeling opnieuw lezen: een gelijktijdige indiening kan
        // de sleutel net hebben vervangen.
        const fresh = await tx.document.findUnique({
          where: { id: documentId },
          select: { workingKey: true }
        })
        if (!fresh?.workingKey) continue

        let bytes = await store.get(fresh.workingKey)
        for (const f of fields) {
          bytes = Buffer.from(
            await stampSignatureImage(
              bytes,
              { page: f.page, x: f.x, y: f.y, width: f.width, height: f.height },
              signatureDataUrl,
              label
            )
          )
        }

        // Nooit dezelfde sleutel overschrijven: bij een rollback zou de blob dan
        // gewijzigd zijn en de database niet, en stempelt de volgende ondertekenaar
        // op een bestand dat volgens de database nog onbewerkt is. Elke schrijfactie
        // maakt een nieuwe sleutel (nanoid, dus nooit een botsing) en de transactie
        // verplaatst alleen de verwijzing.
        const newKey = await store.put(bytes, 'pdf')
        await tx.document.update({ where: { id: documentId }, data: { workingKey: newKey } })
        // Opruimen pas ná de commit. Zou dat hier gebeuren, dan is bij een rollback
        // de oude blob weg terwijl de database er nog naar wijst: dataverlies.
        teVerwijderen.push(fresh.workingKey)
      }

      // De status is hierboven al gezet, als claim. Deze regel hoort er nog wel bij
      // en staat bewust in DEZELFDE transactie als de stempels: valt het proces
      // ertussen om, dan mag er geen document zijn met stempels terwijl de velden
      // nog als leeg te boek staan.
      await tx.signatureField.updateMany({ where: { recipientId }, data: { filled: true } })

      // Bewijskritiek: zonder deze regel is er een handtekening zonder spoor.
      // 'required' rolt de hele transactie terug, dus dan is er ook geen stempel.
      await writeAudit(
        {
          type: 'ONDERTEKEND',
          dossierId: dossier.id,
          recipientId,
          message: recipient.email,
          ip: ctx.ip,
          userAgent: ctx.userAgent
        },
        { mode: 'required', tx }
      )
    },
    { timeout: 180_000, maxWait: 30_000 }
  )

  // Was het een herhaald verzoek, dan is er niets gebeurd en hoeft er niets te
  // worden opgeruimd of doorgeschoven. Geen fout naar de aanroeper: de
  // handtekening staat er, dus voor de gebruiker is dit gelukt.
  if (alGetekend) return

  // Vanaf hier is de commit binnen: de oude versies mogen weg.
  for (const key of teVerwijderen) await store.remove(key).catch(() => {})

  await advanceWorkflow(dossier.id)
}

/** Zet DECLINED en werkt de workflow bij. */
export async function declineSignature(
  recipientId: string,
  reason: string | undefined,
  ctx: { ip?: string; userAgent?: string }
): Promise<void> {
  const recipient = await prisma.recipient.findUnique({ where: { id: recipientId } })
  if (!recipient) return
  await prisma.recipient.update({
    where: { id: recipientId },
    data: { status: 'DECLINED', declinedReason: reason || null, tokenUsedAt: new Date() }
  })
  await writeAudit({ type: 'GEWEIGERD', dossierId: recipient.dossierId, recipientId, message: reason || undefined, ...ctx })
  await advanceWorkflow(recipient.dossierId)
}

/**
 * Herberekent de status, activeert bij sequentieel de volgende ondertekenaar,
 * en verzegelt + mailt zodra iedereen getekend heeft.
 */
export async function advanceWorkflow(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: { recipients: { orderBy: { order: 'asc' } }, owner: true }
  })
  if (!dossier) return

  const status = recomputeStatus(dossier.status, dossier.recipients)
  if (status === 'GEWEIGERD') {
    await prisma.dossier.update({ where: { id: dossierId }, data: { status } })
    // Verzender op de hoogte stellen.
    await sendMail({
      to: dossier.owner.email,
      subject: `Ondertekening geweigerd: ${dossier.title}`,
      text: `Een ontvanger heeft geweigerd het document "${dossier.title}" te ondertekenen.`,
      html: `<p>Een ontvanger heeft geweigerd het document <strong>${dossier.title}</strong> te ondertekenen.</p>`
    }).catch(() => {})
    return
  }

  const stillPending = dossier.recipients.filter((r) => r.status === 'PENDING')
  if (stillPending.length === 0) {
    await finalize(dossierId)
    return
  }

  await prisma.dossier.update({ where: { id: dossierId }, data: { status } })

  // Sequentieel: activeer de volgende die nog niet geactiveerd is.
  if (dossier.signingMode === 'SEQUENTIAL') {
    const next = stillPending[0]
    const alreadyActivated = next.role === 'ZELF' ? false : !!next.tokenHash
    // Voor kantoorgebruikers bepalen we 'reeds genotificeerd' aan de hand van
    // een eerder VERZONDEN-auditregel.
    const officeNotified =
      next.role === 'ZELF' &&
      (await prisma.auditEvent.count({ where: { dossierId, recipientId: next.id, type: 'VERZONDEN' } })) > 0
    if (!alreadyActivated && !officeNotified) {
      await activateSigner(next.id)
    }
  }
}

/** Verzegelt elk document en verstuurt de kopieën. */
async function finalize(dossierId: string): Promise<void> {
  await sealAndComplete(dossierId)
}

/**
 * Bouwt per document het pre-seal-artefact: auditcertificaat erachter en
 * platgeslagen. Idempotent — bestaat `preSealKey` al (bijvoorbeeld na een
 * mislukte verzegeling), dan wordt de auditpagina niet nóg een keer toegevoegd.
 */
export async function buildPreSealArtifacts(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: {
      recipients: { orderBy: { order: 'asc' } },
      documents: { orderBy: { order: 'asc' } }
    }
  })
  if (!dossier) return
  const store = storage()

  // IP, apparaat en de momenten van versturen/openen staan niet op Recipient maar
  // in het auditspoor — dat is de bewijsadministratie. Ze hier ophalen houdt één
  // bron van waarheid en voorkomt dat het certificaat en het spoor uiteenlopen.
  const events = await prisma.auditEvent.findMany({
    where: { dossierId, type: { in: ['VERZONDEN', 'GEOPEND', 'ONDERTEKEND'] }, recipientId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { recipientId: true, type: true, createdAt: true, ipAddress: true, userAgent: true }
  })
  type Spoor = { sentAt?: Date; openedAt?: Date; ip?: string | null; userAgent?: string | null }
  const spoor = new Map<string, Spoor>()
  for (const e of events) {
    if (!e.recipientId) continue
    const s = spoor.get(e.recipientId) ?? {}
    // Eerste uitnodiging en eerste opening: dat is de doorlooptijd die telt.
    if (e.type === 'VERZONDEN' && !s.sentAt) s.sentAt = e.createdAt
    if (e.type === 'GEOPEND' && !s.openedAt) s.openedAt = e.createdAt
    // Bij ONDERTEKEND juist de laatste: dat is de handtekening die er staat.
    if (e.type === 'ONDERTEKEND') {
      s.ip = e.ipAddress
      s.userAgent = e.userAgent
    }
    spoor.set(e.recipientId, s)
  }

  const signers = dossier.recipients.map((r) => ({
    name: r.name,
    email: r.email,
    signedAt: r.signedAt,
    otpVerifiedAt: r.otpVerifiedAt,
    reauthVerifiedAt: r.reauthVerifiedAt,
    sentAt: spoor.get(r.id)?.sentAt ?? null,
    openedAt: spoor.get(r.id)?.openedAt ?? null,
    ip: spoor.get(r.id)?.ip ?? null,
    userAgent: spoor.get(r.id)?.userAgent ?? null,
    // Kantoorgebruikers tekenen ingelogd; die krijgen geen verificatiecode.
    verification: (r.role === 'ZELF' ? 'KANTOOR' : r.verificationMethod) as 'EMAIL' | 'SMS' | 'KANTOOR',
    presentedHashes: (r.presentedHashes ?? null) as Record<string, string> | null,
    consentTextSnapshot: r.consentTextSnapshot,
    consentShownAt: r.consentShownAt
  }))

  // Veldtelling per document, zodat het certificaat het stuk beschrijft waar het
  // aan vastzit.
  const veldTelling = await prisma.signatureField.groupBy({
    by: ['documentId', 'kind'],
    where: { dossierId },
    _count: { _all: true }
  })
  const veldenVoor = (documentId: string) => {
    const aantal = (k: 'SIGNATURE' | 'INITIALS' | 'DATE') =>
      veldTelling.find((v) => v.documentId === documentId && v.kind === k)?._count._all ?? 0
    return { signature: aantal('SIGNATURE'), initials: aantal('INITIALS'), date: aantal('DATE') }
  }

  for (const doc of dossier.documents) {
    if (doc.preSealKey || !doc.workingKey) continue
    const working = await store.get(doc.workingKey)
    // Stap 3+4: auditcertificaat toevoegen en plat slaan.
    const { sealedBytes, sha256 } = await sealDocument({
      pdfBytes: working,
      dossierTitle: doc.title,
      dossierId: dossier.id,
      documentId: doc.id,
      sealed: dossierVerzegelt(dossier.assuranceLevel),
      fieldCounts: veldenVoor(doc.id),
      signers
    })
    // Stap 5: hash over precies deze bytes, vlak vóór het zegel.
    const preSealKey = await store.put(sealedBytes, 'pdf')
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        preSealKey,
        preSealSha256: sha256Hex(sealedBytes),
        documentSha256: sha256,
        sealStage: 'PRESEAL'
      }
    })
  }
}

export interface SealOutcome {
  ok: boolean
  error?: string
  retryable?: boolean
}

/**
 * Wacht dit dossier op een gekwalificeerde handtekening waarvoor de accountant
 * zelf moet autoriseren? Dat is het enige ondertekenmechanisme dat er nog is:
 * de sleutel staat bij de provider in een HSM en komt alleen in beweging als de
 * accountant zelf autoriseert. Er is bewust geen variant waarbij de server
 * namens hem tekent.
 */
function awaitsQualifiedSignature(owner: { signingCertEnabled: boolean; signingCredentialId: string | null }): boolean {
  // Alleen in route B. Staat SEAL_MODE op 'organisation', dan sluit het
  // organisatiezegel het dossier af en heeft de accountant niets te doen — ook
  // niet als hij toevallig een beroepscertificaat gekoppeld heeft. Zonder deze
  // voorwaarde zou een dossier op WACHT_OP_WAARMERK blijven staan wachten op een
  // handeling die in route A niet bestaat.
  if (env.SEAL_MODE !== 'qualified') return false
  return env.PROFESSIONAL_SIGNING_DRIVER === 'cleverbase' && owner.signingCertEnabled && !!owner.signingCredentialId
}

/**
 * Rondt af nadat de accountant zijn gekwalificeerde handtekening heeft gezet.
 * De documenten hebben dan al een sealedKey; afhankelijk van de instelling komt
 * er nog een organisatiezegel bij.
 */
export async function completeAfterQualifiedSigning(dossierId: string): Promise<SealOutcome> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { status: true } })
  if (!dossier) return { ok: false, error: 'dossier niet gevonden', retryable: false }
  if (dossier.status === 'ONDERTEKEND') return { ok: true }

  // Nog niet alles ondertekend? Dan blijft het dossier wachten.
  const open = await prisma.document.count({ where: { dossierId, preSealKey: { not: null }, sealedKey: null } })
  if (open > 0) return { ok: true }

  // Eén ondertekenmechanisme: de gekwalificeerde handtekening van de accountant IS
  // de verzegeling. Er komt geen organisatiezegel bovenop. Dat scheelt een tweede
  // certificaat, een tweede storingsbron en een uitleg die niemand wil geven.
  await completeDossier(dossierId)
  return { ok: true }
}

/** Naam van de dossiereigenaar, voor een leesbare foutmelding. */
async function ownerNaam(dossierId: string): Promise<string> {
  const d = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { owner: { select: { name: true } } }
  })
  return d?.owner.name ?? 'de eigenaar'
}


/**
 * Stap 6+7: verzegelt elk document één keer cryptografisch en legt de
 * zegelgegevens vast. Fail-closed: lukt het niet, dan is de uitkomst niet ok en
 * wordt er niets afgerond.
 *
 * Staat `SEAL_MODE` op 'none', dan wordt het pre-seal-artefact één-op-één de
 * definitieve versie (huidig gedrag: zichtbare stempels + auditcertificaat,
 * zonder cryptografisch zegel).
 */
async function applySeals(dossierId: string): Promise<SealOutcome> {
  const documents = await prisma.document.findMany({
    where: { dossierId },
    orderBy: { order: 'asc' }
  })
  // Niet de globale instelling maar de keuze voor dít dossier. SEAL_MODE zegt wat
  // de server kán; assuranceLevel zegt wat de afzender voor dit stuk wilde.
  const niveau = (
    await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { assuranceLevel: true } })
  ).assuranceLevel
  const store = storage()

  for (const doc of documents) {
    // Idempotent op de expliciete stand, niet op gevulde sleutels.
    if (doc.sealStage === 'SEALED') continue
    if (!doc.preSealKey) continue
    const preSeal = await store.get(doc.preSealKey)

    if (!dossierVerzegelt(niveau)) {
      // Geen cryptografisch zegel: het pre-seal-artefact wordt de definitieve
      // versie. Vastleggen in het auditspoor welke stukken uit deze periode komen.
      const sealedKey = await store.put(preSeal, 'pdf')
      await prisma.document.update({
        where: { id: doc.id },
        data: { sealedKey, sealedSha256: sha256Hex(preSeal), sealedAt: new Date(), sealStage: 'SEALED' }
      })
      await writeAudit({
        type: 'VERZEGELING_OVERGESLAGEN',
        dossierId,
        message:
          niveau === 'AUDITSPOOR'
            ? `${doc.title} — bewust zonder zegel verstuurd (niveau auditspoor)`
            : `${doc.title} — verzegeling staat uit (SEAL_MODE=none)`,
        metadata: { niveau }
      })
      continue
    }

    try {
      const result = await sealPdf({
        pdfBytes: preSeal,
        appearanceText: 'Verzegeld door Otto Visser & Partners Accountants',
        // Route A: certificerend met P=1. Het zegel is de eerste handtekening in
        // dit document, dus het mag zijn eigen veld aanmaken en alles daarna
        // dichtzetten. Geen appearanceBox: het zegel is onzichtbaar, de zichtbare
        // verantwoording staat op het ondertekencertificaat.
        //
        // Route B zet hier 'fill_forms' (P=2), zodat het beroepscertificaat
        // daarna nog een vooraf geplaatst veld kan invullen.
        certify: dossierRoute(niveau) === 'organisatie' ? 'no_changes' : 'fill_forms'
      })
      const sealedKey = await store.put(result.sealedBytes, 'pdf')
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          sealedKey,
          sealedSha256: result.sealedSha256,
          sealedAt: new Date(),
          timestampedAt: result.timestampedAt,
          sealCertSerial: result.certSerial,
          sealTsaUrl: result.tsaUrl,
          sealStage: 'SEALED'
        }
      })
    } catch (e: unknown) {
      // De sealer meldt dat dit veld al is ondertekend: de bytes waren dus al
      // verzegeld en alleen de administratie liep achter. Inhalen, geen fout.
      if (e instanceof AlreadySealedError) {
        const sealedKey = await store.put(preSeal, 'pdf')
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            sealedKey,
            sealedSha256: sha256Hex(preSeal),
            sealedAt: new Date(),
            timestampedAt: e.signingTime,
            sealCertSerial: e.certSerial,
            sealStage: 'SEALED'
          }
        })
        await writeAudit({
          type: 'VERZEGELD',
          dossierId,
          message: `${doc.title} — was al verzegeld, administratie ingehaald`
        })
        continue
      }
      const retryable = e instanceof SealRetryableError
      return { ok: false, error: (e as Error).message, retryable }
    }
  }
  return { ok: true }
}

/**
 * Verzegelt en rondt af. Wordt aangeroepen zodra iedereen heeft getekend én
 * door de SEAL_RETRY-job. Idempotent: een al afgerond dossier doet niets.
 */
export async function sealAndComplete(dossierId: string): Promise<SealOutcome> {
  const current = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: {
      status: true,
      assuranceLevel: true,
      owner: { select: { signingCertEnabled: true, signingCredentialId: true } }
    }
  })
  if (!current) return { ok: false, error: 'dossier niet gevonden', retryable: false }
  if (current.status === 'ONDERTEKEND') return { ok: true }

  await buildPreSealArtifacts(dossierId)

  // Moet de accountant er nog een gekwalificeerde handtekening op zetten? Dan
  // stopt het hier: hij autoriseert dat zelf (pincode in de app van de provider).
  // De handtekening komt ná het auditcertificaat, want daarna mag het bestand
  // niet meer worden bewerkt.
  //
  // Belangrijk: alleen als er nog iets te waarmerken IS. Staat de gekwalificeerde
  // handtekening er al op en faalde daarna alleen het organisatiezegel, dan zou
  // terugvallen naar deze wachtstand de accountant onnodig opnieuw om een pincode
  // vragen — bij een batch van vijftig stukken vijftig keer.
  if (current.assuranceLevel === 'BEROEPS' && awaitsQualifiedSignature(current.owner)) {
    const teWaarmerken = await prisma.document.count({
      where: { dossierId, preSealKey: { not: null }, sealStage: 'PRESEAL' }
    })
    if (teWaarmerken > 0) {
      await prisma.dossier.update({ where: { id: dossierId }, data: { status: 'WACHT_OP_WAARMERK' } })
      return { ok: true }
    }
    // Alles al gewaarmerkt: afronden.
    return completeAfterQualifiedSigning(dossierId)
  }

  // Route B: bij SEAL_MODE=qualified is de gekwalificeerde handtekening van de
  // accountant DE verzegeling. Kan de eigenaar van dit dossier niet gekwalificeerd
  // ondertekenen, dan is er niets om mee te verzegelen — en dan mag het stuk niet
  // als afgerond de deur uit. Fail-closed, met een melding die zegt wat er moet
  // gebeuren.
  //
  // In route A geldt dit niet: daar zegelt de organisatie zelf, onbeheerd, en is
  // er geen accountant nodig. Die valt hieronder door naar applySeals.
  if (current.assuranceLevel === 'BEROEPS') {
    const reden =
      env.PROFESSIONAL_SIGNING_DRIVER === 'none'
        ? 'PROFESSIONAL_SIGNING_DRIVER staat op "none"'
        : `voor ${await ownerNaam(dossierId)} staat gekwalificeerd ondertekenen niet aan, of er is geen credential gekoppeld`
    const outcome: SealOutcome = {
      ok: false,
      error:
        `SEAL_MODE=qualified, maar dit dossier kan niet gekwalificeerd worden ondertekend: ${reden}. ` +
        `Zet het beroepscertificaat aan voor de eigenaar (Instellingen > Gebruikers), of zet ` +
        `SEAL_MODE=none met ALLOW_UNSEALED=true zolang er nog geen certificaat is.`,
      // Dit is een configuratiefout, geen storing. Opnieuw proberen lost niets op.
      retryable: false
    }
    await prisma.dossier.update({ where: { id: dossierId }, data: { status: 'SEALING_FAILED' } })
    await writeAudit({
      type: 'VERZEGELING_MISLUKT',
      dossierId,
      message: outcome.error?.slice(0, 500),
      metadata: { retryable: false, oorzaak: 'geen ondertekenmechanisme' }
    })
    return outcome
  }

  // SEAL_MODE=none: geen cryptografische handtekening. Dat is vastgelegd op het
  // ondertekencertificaat en in het auditspoor (zie applySeals).
  const outcome = await applySeals(dossierId)

  if (!outcome.ok) {
    // Fail-closed: geen voltooiingsmail, dossier wacht zichtbaar op verzegeling.
    await prisma.dossier.update({ where: { id: dossierId }, data: { status: 'SEALING_FAILED' } })
    await writeAudit({
      type: 'VERZEGELING_MISLUKT',
      dossierId,
      message: outcome.error?.slice(0, 500),
      metadata: { retryable: outcome.retryable ?? false }
    })
    if (outcome.retryable) {
      await enqueueOnce('SEAL_RETRY', dossierId, { dossierId }, { maxAttempts: 12 })
    }
    return outcome
  }

  await completeDossier(dossierId)
  return { ok: true }
}

/** Stap 8: status, archief en voltooiingsmails. Vanaf hier is het bestand read-only. */
async function completeDossier(dossierId: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: {
      recipients: { orderBy: { order: 'asc' }, include: { client: true } },
      owner: true,
      documents: { orderBy: { order: 'asc' } }
    }
  })
  if (!dossier) return

  const store = storage()
  const attachments: { filename: string; content: Buffer }[] = []
  const hashes: Record<string, { preSeal: string | null; sealed: string | null; timestampedAt: string | null }> = {}
  for (const doc of dossier.documents) {
    if (!doc.sealedKey) continue
    // Verbatim: exact de verzegelde bytes, niet opnieuw gegenereerd.
    const sealed = await store.get(doc.sealedKey)
    attachments.push({ filename: doc.fileName, content: Buffer.from(sealed) })
    hashes[doc.title] = {
      preSeal: doc.preSealSha256,
      sealed: doc.sealedSha256,
      timestampedAt: doc.timestampedAt?.toISOString() ?? null
    }
  }

  const completedAt = new Date()
  // Bewaartermijn: zeven jaar, gelijk aan de dossierbewaartermijn.
  const retentionUntil = new Date(completedAt)
  retentionUntil.setFullYear(retentionUntil.getFullYear() + 7)
  await prisma.dossier.update({
    where: { id: dossierId },
    data: { status: 'ONDERTEKEND', completedAt, retentionUntil }
  })
  await writeAudit({ type: 'VERZEGELD', dossierId, metadata: { hashes, sealed: sealEnabled() } })

  // Het losse auditrapport. Altijd maken, niet alleen bij niveau AUDITSPOOR: het
  // is goedkoop, en de vraag "wie tekende hier precies wat, en wanneer" komt bij
  // een verzegeld stuk net zo goed langs. Bij AUDITSPOOR is dit hét bewijsstuk.
  //
  // Best-effort: mislukt het opmaken, dan is dat een auditregel en geen reden om
  // het afronden te blokkeren. De onderliggende gegevens staan in de database en
  // het rapport is opnieuw te genereren.
  let auditRapport: { filename: string; content: Buffer } | null = null
  try {
    const rapport = await buildAuditReportFor(dossierId)
    if (rapport) {
      const key = await store.put(rapport.bytes, 'pdf')
      await prisma.dossier.update({
        where: { id: dossierId },
        data: { auditReportKey: key, auditReportSha256: rapport.sha256 }
      })
      auditRapport = { filename: 'Auditrapport.pdf', content: Buffer.from(rapport.bytes) }
      attachments.push(auditRapport)
      await writeAudit({
        type: 'AUDITRAPPORT_OPGEMAAKT',
        dossierId,
        message: `auditrapport opgemaakt (${rapport.gebeurtenissen} gebeurtenissen)`,
        metadata: { sha256: rapport.sha256, ketenIntact: rapport.chainOk }
      })
    }
  } catch (e) {
    console.error('[auditrapport]', e)
    await writeAudit({ type: 'AUDITRAPPORT_OPGEMAAKT', dossierId, message: `mislukt: ${(e as Error).message}` })
  }
  // Getekende stukken automatisch in de klantmap zetten (indien ingesteld).
  if (archiveEnabled() && attachments.length > 0) {
    const clientRec = dossier.recipients.find((r) => r.client)
    const client = clientRec?.client
    const year = dossier.documents.map((d) => d.detectedYear).find((y) => y != null) ?? null
    // Dossier-override wint; anders klantmap + boekjaar als submap.
    const folder =
      dossier.archiveFolder?.trim() ||
      buildDefaultFolder({
        clientBaseFolder: client?.archiveFolder ?? null,
        clientName: client?.displayName ?? clientRec?.name ?? dossier.title,
        clientNumber: client?.clientNumber ?? null,
        year
      })
    try {
      const res = await archiveDossier({ folder, files: attachments })
      await writeAudit({ type: 'GEARCHIVEERD', dossierId, message: `${res.archived} bestand(en) naar ${res.driver}`, metadata: { target: res.target } })
    } catch (e) {
      console.error('[finalize archief]', e)
      await writeAudit({ type: 'GEARCHIVEERD', dossierId, message: `mislukt: ${(e as Error).message}` })
    }
  }


  // De controlegetallen van de verzegelde bestanden. Die gaan mee in de body van
  // de mail, zodat ze in de mailbox van de cliënt terechtkomen met zijn eigen
  // ontvangstdatum — buiten ons beheer.
  const mailHashes = dossier.documents
    .filter((d) => d.sealedKey && d.sealedSha256)
    .map((d) => ({ title: d.title, sha256: d.sealedSha256! }))

  // Downloadtoken per ontvanger. Apart van het tekentoken: dat is eenmalig en
  // verbruikt, en dat moet zo blijven. Dit token is herbruikbaar en kan niet
  // worden gebruikt om te ondertekenen (andere route, andere validatie).
  const downloadDagen = blobBewaardagen()
  const downloadLinks = new Map<string, string>()
  if (dossier.sendCopyToRecipient) {
    for (const r of dossier.recipients) {
      const { raw, hash } = generateSigningToken()
      await prisma.recipient.update({
        where: { id: r.id },
        data: {
          downloadTokenHash: hash,
          downloadTokenExpiresAt: new Date(Date.now() + downloadDagen * 24 * 60 * 60 * 1000)
        }
      })
      downloadLinks.set(r.id, `${env.APP_URL}/downloaden/${raw}`)
    }
  }

  const targets = [
    ...(dossier.sendCopyToRecipient
      ? dossier.recipients.map((r) => ({ name: r.name, email: r.email, url: downloadLinks.get(r.id) ?? null }))
      : []),
    { name: dossier.owner.name, email: dossier.owner.email, url: null }
  ]
  // Dedupe op e-mailadres (eigenaar kan ook ondertekenaar zijn).
  const seen = new Set<string>()
  for (const t of targets) {
    if (seen.has(t.email.toLowerCase())) continue
    seen.add(t.email.toLowerCase())
    const mail = completedEmail({
      recipientName: t.name,
      documentTitle: dossier.title,
      hashes: mailHashes,
      downloadUrl: t.url,
      downloadDagen
    })
    await sendMail({ to: t.email, ...mail, attachments }).catch((e) => console.error('[finalize mail]', e))
  }

  // Anker: de kop van de keten van dít dossier buiten de database vastleggen. Nu is
  // het bewijs definitief, dus dit is het moment waarop het anker het meeste waard
  // is. Via de wachtrij, zodat een onbereikbaar archief of een trage mailserver het
  // afronden niet ophoudt.
  await enqueueOnce('AUDIT_ANCHOR', `dossier:${dossierId}`, { dossierId }, { maxAttempts: 5 }).catch((e) =>
    console.error('[finalize anker]', e)
  )
}
