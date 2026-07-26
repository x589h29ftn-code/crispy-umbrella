/**
 * Betrouwbaarheidsniveau per dossier, en het losse auditrapport.
 *
 * De afzender kiest per verzoek hoeveel bewijskracht hij wil. Zonder zegel is het
 * auditrapport hét bewijsstuk, dus dan moet er ook werkelijk in staan wat we
 * beweren dat erin staat — vandaar dat deze test de PDF opbouwt en de tekst
 * teruglezt in plaats van te vertrouwen op "er komt een bestand uit".
 *
 *   npm run test:niveaus
 */
import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { writeAudit } from '@/lib/audit'
import { hashPassword } from '@/lib/auth/password'
import {
  beschikbareNiveaus,
  standaardNiveau,
  niveauControle,
  dossierVerzegelt,
  dossierRoute,
  ASSURANCE_LABEL,
  ASSURANCE_UITLEG
} from '@/lib/assurance'
import { buildAuditReportFor } from '@/lib/auditReportData'
import { consentTextVoor, consentHash } from '@/lib/consent'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

const EMAIL = 'niveaus@ottovisseraccountants.nl'

async function tekstVan(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise
  let out = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    out += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
  }
  return out
}

async function schoonVooraf() {
  const oud = await prisma.accountant.findUnique({ where: { email: EMAIL }, select: { id: true } })
  if (!oud) return
  const dossiers = await prisma.dossier.findMany({ where: { ownerId: oud.id }, select: { id: true } })
  for (const d of dossiers) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
      await tx.dossier.delete({ where: { id: d.id } })
    })
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.auditEvent.deleteMany({ where: { accountantId: oud.id } })
    await tx.accountant.delete({ where: { id: oud.id } })
  })
}

async function main() {
  await schoonVooraf()

  // --- De niveaulogica ---
  const beschikbaar = beschikbareNiveaus()
  check('auditspoor is altijd beschikbaar', beschikbaar.includes('AUDITSPOOR'), beschikbaar)
  check(
    'zonder certificaat is auditspoor het enige niveau',
    process.env.SEAL_MODE === 'none' || process.env.SEAL_MODE === undefined ? beschikbaar.length === 1 : true,
    beschikbaar
  )
  check('het standaardniveau is er ook echt een', beschikbaar.includes(standaardNiveau()), standaardNiveau())

  check('auditspoor verzegelt niet', !dossierVerzegelt('AUDITSPOOR'))
  check('zegel verzegelt wel', dossierVerzegelt('ZEGEL'))
  check('beroeps verzegelt wel', dossierVerzegelt('BEROEPS'))
  check('auditspoor kent geen route', dossierRoute('AUDITSPOOR') === 'geen')
  check('zegel gaat via route A', dossierRoute('ZEGEL') === 'organisatie')
  check('beroeps gaat via route B', dossierRoute('BEROEPS') === 'beroeps')

  // Een niveau dat de server niet kan, moet worden geweigerd mét bruikbare uitleg.
  if (!beschikbaar.includes('ZEGEL')) {
    const controle = niveauControle('ZEGEL')
    check('een niet-beschikbaar niveau wordt geweigerd', !controle.ok)
    check(
      'en de melding zegt wat er moet gebeuren',
      !controle.ok && controle.melding.includes('SEAL_MODE'),
      !controle.ok ? controle.melding : ''
    )
  }
  for (const n of beschikbaar) {
    check(`${n} heeft een label`, !!ASSURANCE_LABEL[n])
    check(`${n} heeft uitleg van betekenis`, (ASSURANCE_UITLEG[n] ?? '').length > 60)
  }

  // --- Een dossier met een volledig verloop, zonder zegel ---
  const acc = await prisma.accountant.create({
    data: {
      email: EMAIL,
      name: 'N. Iveau',
      passwordHash: await hashPassword('Wachtwoord-Voor-Test-1'),
      totpEnabled: true
    }
  })
  const store = storage()
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const leeg = await PDFDocument.create()
  leeg.addPage([595, 842])
  const bytes = Buffer.from(await leeg.save())

  const dossier = await prisma.dossier.create({
    data: {
      title: 'Akkoordverklaring aangifte IB 2025',
      ownerId: acc.id,
      status: 'ONDERTEKEND',
      assuranceLevel: 'AUDITSPOOR',
      sentAt: new Date(Date.now() - 3600_000),
      completedAt: new Date(),
      documents: {
        create: [
          {
            title: 'Akkoordverklaring IB',
            fileName: 'akkoord-ib.pdf',
            order: 0,
            originalKey: await store.put(bytes, 'pdf'),
            sealedKey: await store.put(bytes, 'pdf'),
            documentSha256: 'a'.repeat(64),
            preSealSha256: 'b'.repeat(64),
            sealedSha256: 'c'.repeat(64),
            sealStage: 'SEALED',
            sealedAt: new Date(),
            detectedKind: 'AKKOORD_IB',
            detectedYear: 2025
          }
        ]
      }
    },
    include: { documents: true }
  })

  const verklaring = consentTextVoor('EXTERN')
  const client = await prisma.recipient.create({
    data: {
      dossierId: dossier.id,
      role: 'EXTERN',
      name: 'K. Lient',
      email: 'client@example.nl',
      phone: '0612345678',
      verificationMethod: 'SMS',
      order: 0,
      status: 'SIGNED',
      signedAt: new Date(),
      otpVerifiedAt: new Date(Date.now() - 60_000),
      mailStatus: 'BOUNCED',
      mailStatusAt: new Date(Date.now() - 1800_000),
      mailBounceReason: 'mailbox full (test)',
      consentTextSnapshot: verklaring,
      consentTextHash: consentHash(verklaring),
      consentShownAt: new Date(Date.now() - 120_000),
      presentedHashes: { [dossier.documents[0].id]: 'd'.repeat(64) }
    }
  })

  // Een verloop dat lijkt op de werkelijkheid, inclusief een herinnering.
  await writeAudit({ type: 'AANGEMAAKT', dossierId: dossier.id, accountantId: acc.id })
  await writeAudit({ type: 'VERZONDEN', dossierId: dossier.id, recipientId: client.id, message: client.email })
  await writeAudit({ type: 'MAIL_GEBOUNCED', dossierId: dossier.id, recipientId: client.id, message: 'mailbox full (test)' })
  await writeAudit({ type: 'HERINNERD', dossierId: dossier.id, recipientId: client.id })
  await writeAudit({ type: 'GEOPEND', dossierId: dossier.id, recipientId: client.id, message: client.email })
  await writeAudit({ type: 'OTP_VERSTUURD', dossierId: dossier.id, recipientId: client.id, metadata: { kanaal: 'sms' } })
  await writeAudit({ type: 'OTP_GEVERIFIEERD', dossierId: dossier.id, recipientId: client.id })
  await writeAudit({
    type: 'ONDERTEKEND',
    dossierId: dossier.id,
    recipientId: client.id,
    message: client.email,
    ip: '84.24.101.7',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile Safari/604.1'
  })

  const rapport = await buildAuditReportFor(dossier.id)
  check('er komt een auditrapport uit', !!rapport)
  if (!rapport) {
    console.log('\n1 TEST(EN) MISLUKT')
    await prisma.$disconnect()
    process.exit(1)
  }
  check('het rapport heeft een eigen vingerafdruk', /^[0-9a-f]{64}$/.test(rapport.sha256), rapport.sha256)
  check('de ketencontrole van dit dossier is intact', rapport.chainOk)
  check('alle acht gebeurtenissen zijn meegenomen', rapport.gebeurtenissen === 8, rapport.gebeurtenissen)

  const tekst = await tekstVan(rapport.bytes)

  // Het verzoek en het niveau.
  check('het rapport noemt de titel', tekst.includes('Akkoordverklaring aangifte IB 2025'))
  check('het rapport noemt het dossierkenmerk', tekst.includes(dossier.id))
  check('het rapport benoemt het niveau', tekst.includes('Auditspoor'))
  check('en zegt hardop dat er geen zegel is', tekst.includes('geen digitaal zegel'), tekst.slice(0, 400))

  // Per ondertekenaar.
  check('de ondertekenaar staat erin', tekst.includes('K. Lient'))
  check('het IP-adres staat erin', tekst.includes('84.24.101.7'))
  check('het apparaat staat erin', tekst.includes('iPhone'))
  check('het verificatiekanaal is benoemd', tekst.includes('(sms)'))
  check('de gelezen verklaring staat er letterlijk in', tekst.includes('akkoord met de inhoud'))
  check('de getoonde versie staat erin', tekst.includes('d'.repeat(48)))

  // De bounce moet erin staan en niet weggepoetst zijn: daar komt de discussie
  // "ik heb het nooit gekregen" op aan.
  check('de bezorgstatus staat erin', tekst.includes('BOUNCED'))
  check('en de reden van de bounce ook', tekst.includes('mailbox full'))
  check('de herinnering is geteld', /Herinneringen verstuurd: 1/.test(tekst))

  // De documenten.
  check('de documenttitel staat erin', tekst.includes('Akkoordverklaring IB'))
  check('de vingerafdruk van het eindbestand staat erin', tekst.includes('c'.repeat(48)))
  check('het boekjaar staat erin', tekst.includes('2025'))

  // Het volledige spoor.
  for (const type of ['AANGEMAAKT', 'VERZONDEN', 'MAIL_GEBOUNCED', 'HERINNERD', 'GEOPEND', 'OTP_GEVERIFIEERD', 'ONDERTEKEND']) {
    check(`het spoor bevat ${type}`, tekst.includes(type))
  }
  check('de volgnummers staan erin', /#\d+/.test(tekst))

  // De eerlijkheid over wat het niet aantoont — dat is geen bijzaak.
  check('het rapport zegt dat het uit onze eigen database komt', tekst.includes('eigen database'))
  check(
    'en dat de code geen identiteit bewijst',
    tekst.includes('niet de identiteit') || tekst.includes('geen identiteitsbewijs')
  )
  check('en wijst naar de hash in de voltooiingsmail', tekst.includes('voltooiingsmail'))

  // --- Het rapport gaat naar de CLIËNT, dus wat er niet in hoort, hoort er niet in ---
  // Het auditspoor is intern: het bevat het credential-id van de accountant bij
  // zijn certificaatprovider, het pad in SharePoint, het message-id van de
  // mailprovider en foutmeldingen die de configuratie prijsgeven. Dat stond
  // letterlijk in het rapport, want de metadata werd als JSON afgedrukt.
  await writeAudit({
    type: 'GEARCHIVEERD',
    dossierId: dossier.id,
    message: '1 bestand(en) naar sharepoint',
    metadata: { target: 'Getekende stukken/1234 - Geheime Klant BV/2025' }
  })
  await writeAudit({
    type: 'VERZEGELING_MISLUKT',
    dossierId: dossier.id,
    message: 'sealer gaf 502: connect ECONNREFUSED sealer-intern.ovp.local:8000',
    metadata: { retryable: true, oorzaak: 'geen ondertekenmechanisme' }
  })
  await writeAudit({
    type: 'GEKWALIFICEERD_ONDERTEKEND',
    dossierId: dossier.id,
    accountantId: acc.id,
    message: 'cleverbase (RA)',
    metadata: { documentIds: ['geheim-id'], credentialId: 'CRED-GEHEIM-12345' }
  })

  const filterRapport = await buildAuditReportFor(dossier.id)
  const filterTekst = filterRapport ? await tekstVan(filterRapport.bytes) : ''
  check('het credential-id staat NIET in het rapport', !filterTekst.includes('CRED-GEHEIM-12345'), 'gelekt')
  check('het archiefpad staat NIET in het rapport', !filterTekst.includes('Geheime Klant BV'), 'gelekt')
  check('de interne hostnaam staat NIET in het rapport', !filterTekst.includes('sealer-intern'), 'gelekt')
  check('de configuratie-oorzaak staat NIET in het rapport', !filterTekst.includes('geen ondertekenmechanisme'), 'gelekt')
  check('interne document-id\'s staan NIET in het rapport', !filterTekst.includes('geheim-id'), 'gelekt')
  // Maar de gebeurtenis zelf moet wél zichtbaar blijven, met een leesbare regel.
  check('de mislukte verzegeling staat er wel als gebeurtenis in', filterTekst.includes('VERZEGELING_MISLUKT'))
  check('met een neutrale uitleg', filterTekst.includes('verzegelen is op dat moment niet gelukt'))
  check('en het archiveren ook', filterTekst.includes('GEARCHIVEERD'))
  // De bounce-reden gaat over de eigen mailbox van de ontvanger en blijft staan.
  check('de reden van de bounce blijft wel staan', filterTekst.includes('mailbox full'))

  // --- Een gebroken keten moet als gebroken worden gemeld ---
  const doelwit = await prisma.auditEvent.findFirstOrThrow({
    where: { dossierId: dossier.id, type: 'GEOPEND' },
    select: { id: true, message: true }
  })
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.$executeRawUnsafe(`UPDATE "AuditEvent" SET message = $1 WHERE id = $2`, 'gerommeld', doelwit.id)
  })
  const kapot = await buildAuditReportFor(dossier.id)
  check('een gemanipuleerde regel maakt de ketencontrole rood', kapot?.chainOk === false, kapot?.chainOk)
  const kapotTekst = kapot ? await tekstVan(kapot.bytes) : ''
  check('en dat staat met zoveel woorden in het rapport', kapotTekst.includes('NIET intact'), kapotTekst.slice(-600))

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.$executeRawUnsafe(`UPDATE "AuditEvent" SET message = $1 WHERE id = $2`, doelwit.message, doelwit.id)
  })
  const hersteld = await buildAuditReportFor(dossier.id)
  check('na herstel is de keten weer intact', hersteld?.chainOk === true)

  await schoonVooraf()
  console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
  await prisma.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
