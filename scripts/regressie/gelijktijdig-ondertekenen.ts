/**
 * Punt 1 uit changeset v1.2: twee ondertekenaars die op hetzelfde moment
 * ondertekenen mogen elkaars stempel niet overschrijven.
 *
 * Voor de fix was de read-modify-write op Document.workingKey niet vergrendeld:
 * beide processen lazen dezelfde bytes, stempelden hun eigen handtekening erop en
 * schreven een nieuwe sleutel weg. De laatste won, de andere handtekening was weg.
 */
import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { applySignature, buildPreSealArtifacts } from '@/lib/signflow'
import { verifyAuditChain, writeAudit } from '@/lib/audit'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

/** Kleine transparante PNG met een gekleurde stip, als "handtekening". */
function pngDataUrl(): string {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKUlEQVR42mNkYPjPwMDAyMDAwMDA' +
    'wMDAwMDAwMDAwMDAwMDAwMDAAAAaEAHzD3jJAAAAAElFTkSuQmCC'
  return `data:image/png;base64,${base64}`
}

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

async function main() {
  const acc = await prisma.accountant.upsert({
    where: { email: 'race@ottovisseraccountants.nl' },
    update: {},
    create: { email: 'race@ottovisseraccountants.nl', name: 'Race Tester', passwordHash: 'x', role: 'BEHEERDER' }
  })
  // Resten van een eerdere run weg.
  for (const d of await prisma.dossier.findMany({ where: { ownerId: acc.id }, select: { id: true } })) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
      await tx.dossier.delete({ where: { id: d.id } })
    })
  }

  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const leeg = await PDFDocument.create()
  leeg.addPage([595, 842])
  const key = await storage().put(Buffer.from(await leeg.save()), 'pdf')

  const dossier = await prisma.dossier.create({
    data: {
      title: 'Gelijktijdig ondertekenen',
      ownerId: acc.id,
      status: 'VERZONDEN',
      signingMode: 'PARALLEL',
      documents: { create: { title: 'Stuk', fileName: 'stuk.pdf', order: 0, originalKey: key, workingKey: key } }
    },
    include: { documents: true }
  })
  const doc = dossier.documents[0]

  const namen = ['Anna Aalbers', 'Bram Bakker']
  const ontvangers = []
  for (const [i, naam] of namen.entries()) {
    const r = await prisma.recipient.create({
      data: {
        dossierId: dossier.id,
        name: naam,
        email: `${naam.split(' ')[0].toLowerCase()}@example.com`,
        role: 'EXTERN',
        order: i,
        status: 'PENDING',
        otpVerifiedAt: new Date()
      }
    })
    await prisma.signatureField.create({
      data: {
        dossierId: dossier.id,
        documentId: doc.id,
        recipientId: r.id,
        kind: 'SIGNATURE',
        page: 0,
        x: 60,
        y: 600 - i * 120,
        width: 180,
        height: 60
      }
    })
    ontvangers.push(r)
  }

  // Het versturen en openen loopt in deze test niet via de echte route, dus die
  // twee auditregels zetten we zelf. Ze horen straks op het certificaat te staan.
  for (const r of ontvangers) {
    await writeAudit({ type: 'VERZONDEN', dossierId: dossier.id, recipientId: r.id, message: r.email })
    await writeAudit({ type: 'GEOPEND', dossierId: dossier.id, recipientId: r.id, message: r.email })
  }

  // Allebei tegelijk, zonder onderling wachten.
  const resultaten = await Promise.allSettled(
    ontvangers.map((r) =>
      applySignature(r.id, pngDataUrl(), {
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36'
      })
    )
  )
  const mislukt = resultaten.filter((r) => r.status === 'rejected')
  check('beide ondertekeningen zijn verwerkt zonder fout', mislukt.length === 0, mislukt)

  const na = await prisma.document.findUniqueOrThrow({ where: { id: doc.id }, select: { workingKey: true } })
  const bytes = await storage().get(na.workingKey!)
  const tekst = await tekstVan(bytes)
  for (const naam of namen) {
    check(`stempel van ${naam} staat in het document`, tekst.includes(naam), tekst.slice(0, 300))
  }
  check(
    'er staat precies één "Digitaal ondertekend door" per ondertekenaar',
    (tekst.match(/Digitaal ondertekend door/g) ?? []).length === namen.length,
    (tekst.match(/Digitaal ondertekend door/g) ?? []).length
  )

  const verwerkt = await prisma.signatureField.count({ where: { documentId: doc.id, filled: true } })
  check('beide tekenvelden staan als gevuld in de database', verwerkt === 2, verwerkt)

  // Dezelfde race zat ook in het auditspoor: twee schrijvers die dezelfde
  // voorganger lezen, laten de hashketen vorken. Dat is niet te herstellen en
  // maakt de controle voor altijd waardeloos.
  const regels = await prisma.auditEvent.findMany({
    where: { dossierId: dossier.id },
    orderBy: { seq: 'asc' },
    select: { prevHash: true, hash: true, type: true }
  })
  const ondertekend = regels.filter((r) => r.type === 'ONDERTEKEND').length
  check('elke ondertekening staat in het auditspoor', ondertekend === 2, ondertekend)
  const dubbeleVoorgangers = new Set(regels.map((r) => r.prevHash)).size !== regels.length
  check('geen twee auditregels met dezelfde voorganger (keten vorkt niet)', !dubbeleVoorgangers, regels.length)

  const keten = await verifyAuditChain()
  check('auditketen is intact na gelijktijdig ondertekenen', keten.ok, keten)

  // Dezelfde persoon die twee keer tegelijk indient. Dat is een ander geval dan
  // twee verschillende ondertekenaars: hier lazen beide verzoeken een ontvanger
  // op PENDING, kwamen beide door de tokencontrole, en stempelden achter elkaar
  // op hetzelfde document. Resultaat waren twee identieke handtekeningen van één
  // persoon en twee ONDERTEKEND-regels, allebei zonder foutmelding. Een
  // dubbelklik is aan de voorkant afgevangen; een herhaalde POST na een haperende
  // verbinding of een tweede tabblad niet.
  const solo = await prisma.recipient.create({
    data: { dossierId: dossier.id, role: 'EXTERN', name: 'S. Olo', email: 'solo@example.nl', order: 9 }
  })
  await prisma.signatureField.create({
    data: { dossierId: dossier.id, recipientId: solo.id, documentId: doc.id, page: 1, x: 300, y: 500, width: 180, height: 60 }
  })
  const dubbel = await Promise.allSettled([
    applySignature(solo.id, pngDataUrl(), { ip: '127.0.0.1', userAgent: 'dubbel-a' }),
    applySignature(solo.id, pngDataUrl(), { ip: '127.0.0.1', userAgent: 'dubbel-b' })
  ])
  check(
    'een herhaalde indiening geeft geen fout naar de gebruiker',
    dubbel.every((u) => u.status === 'fulfilled'),
    dubbel
  )
  const soloNa = await prisma.document.findUniqueOrThrow({ where: { id: doc.id }, select: { workingKey: true } })
  const soloTekst = await tekstVan(await storage().get(soloNa.workingKey!))
  const soloStempels = (soloTekst.match(/S\. Olo/g) ?? []).length
  check('maar er staat precies één stempel van die persoon', soloStempels === 1, soloStempels)
  const soloRegels = await prisma.auditEvent.count({
    where: { dossierId: dossier.id, recipientId: solo.id, type: 'ONDERTEKEND' }
  })
  check('en precies één auditregel', soloRegels === 1, soloRegels)

  // Het ondertekencertificaat is het enige bewijsstuk dat met het bestand
  // meereist. IP en apparaat stonden er ooit altijd als "-" op terwijl ze wél in
  // het auditspoor zaten: het veld werd afgedrukt maar nooit gevuld. Dat valt
  // niemand op, want er staat gewoon iets. Vandaar een harde controle op de
  // inhoud en niet alleen op het bestaan van het certificaat.
  await buildPreSealArtifacts(dossier.id)
  const metCert = await prisma.document.findUniqueOrThrow({
    where: { id: doc.id },
    select: { preSealKey: true }
  })
  check('er is een pre-seal versie met certificaat', !!metCert.preSealKey)
  const certTekst = metCert.preSealKey ? await tekstVan(await storage().get(metCert.preSealKey)) : ''

  check('certificaat vermeldt het IP-adres', certTekst.includes('127.0.0.1'), certTekst.slice(-1200))
  check('geen leeg IP-veld op het certificaat', !/IP-adres bij ondertekenen: -/.test(certTekst))
  check('certificaat vat het apparaat leesbaar samen', certTekst.includes('computer, Windows, Chrome'))
  check('certificaat bevat de volledige user-agent', certTekst.includes('AppleWebKit/537.36'))
  check(
    'certificaat vermeldt wanneer de uitnodiging is verstuurd',
    /Uitnodiging verstuurd: \d{2}-\d{2}-\d{4}/.test(certTekst)
  )
  check('certificaat vermeldt wanneer het is geopend', /Voor het eerst geopend: \d{2}-\d{2}-\d{4}/.test(certTekst))
  check('certificaat beschrijft de omvang van het stuk', /Omvang: \d+ pagina/.test(certTekst))
  check('certificaat telt de handtekeningvelden', /handtekeningveld/.test(certTekst))
  check('certificaat benoemt de tijdzone', certTekst.includes('Europe/Amsterdam'))
  check('certificaat benoemt de identiteitscontrole', /Identiteitscontrole: /.test(certTekst))

  // A.2 uit changeset v1.7. Het organisatiezegel certificeert met DocMDP P=1, dus
  // de stempels moeten pagina-inhoud zijn en er mag geen formulierveld of
  // annotatie meer in staan. Blijven het annotaties, dan kan een viewer ze als
  // verwijderbaar presenteren en hangt het visuele verslag af van een foutmelding.
  const platBytes = metCert.preSealKey ? await storage().get(metCert.preSealKey) : new Uint8Array()
  const { PDFDocument: PDFDoc, PDFName } = await import('@cantoo/pdf-lib')
  const platDoc = await PDFDoc.load(Uint8Array.from(platBytes))
  const veldenOver = platDoc.getForm().getFields().length
  let annotatiesOver = 0
  for (const p of platDoc.getPages()) {
    const a = p.node.get(PDFName.of('Annots')) as { size?: () => number } | undefined
    annotatiesOver += typeof a?.size === 'function' ? a.size() : 0
  }
  check('geen formuliervelden meer na het plat slaan', veldenOver === 0, veldenOver)
  check('geen annotaties meer na het plat slaan', annotatiesOver === 0, annotatiesOver)
  // En het plat slaan mag de stempels niet hebben opgegeten.
  for (const naam of namen) {
    check(`stempel van ${naam} staat nog in het platgeslagen bestand`, certTekst.includes(naam))
  }

  console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
  await prisma.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
