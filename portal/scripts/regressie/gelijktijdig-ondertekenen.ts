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

async function paginasVan(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
  }
  return out
}

async function tekstVan(bytes: Uint8Array): Promise<string> {
  return (await paginasVan(bytes)).join('\n')
}

/**
 * Tekst die buiten de rechterkantlijn valt.
 *
 * `drawText` kapt niets af: te lange tekst loopt gewoon van de pagina af. In de
 * tekstlaag staat hij dan nog helemaal, dus een controle op de inhoud ziet zo'n
 * fout niet — alleen de meetkunde verraadt hem. Daarom wordt hier per tekstitem
 * de rechterrand vergeleken met de paginabreedte.
 */
async function buitenDeKantlijn(bytes: Uint8Array, marge = 48): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise
  const buiten: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const breedte = page.getViewport({ scale: 1 }).width
    for (const it of (await page.getTextContent()).items) {
      if (!('str' in it) || !it.str.trim()) continue
      const rechts = it.transform[4] + it.width
      // Eén punt speling voor afrondingsverschillen in de breedtemeting.
      if (rechts > breedte - marge + 1) buiten.push(`p${i}: ${it.str}`)
    }
  }
  return buiten
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
  check('certificaat benoemt de identiteitscontrole', /Identiteitscontrole:/.test(certTekst))
  // De omschrijving van de identiteitscontrole is langer dan één regel en werd
  // bij de paginarand afgekapt ("... op het moment van"), midden in wat er nu
  // precies is gecontroleerd. Nu breekt hij af op woordgrenzen.
  check(
    'omschrijving van de identiteitscontrole staat er voluit',
    certTekst.includes('verificatiecode per e-mail naar dat adres') ||
      certTekst.includes('verificatiecode per sms naar het opgegeven nummer') ||
      certTekst.includes('verse verificatiecode op het moment van ondertekenen'),
    certTekst.slice(certTekst.indexOf('Identiteitscontrole'), certTekst.indexOf('Identiteitscontrole') + 300)
  )
  const overloop = metCert.preSealKey ? await buitenDeKantlijn(await storage().get(metCert.preSealKey)) : []
  check('geen tekst op het certificaat loopt van de pagina af', overloop.length === 0, overloop.slice(0, 5))

  // Los van deze fixture, want die heeft alleen externe ondertekenaars met de
  // kortste omschrijving. De omschrijving bij een kantoorondertekening is de
  // langste die voorkomt, en die liep eerder van de pagina af. Daarom hier een
  // certificaat met álle lange varianten erin.
  {
    const { PDFDocument: LeegDoc } = await import('@cantoo/pdf-lib')
    const leeg = await LeegDoc.create()
    leeg.addPage([595.28, 841.89])
    const { sealDocument } = await import('@/lib/pdf/seal')
    const langeUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
    const proef = await sealDocument({
      pdfBytes: await leeg.save(),
      dossierTitle: 'Jaarrekening 2025 en de bijbehorende publicatiestukken — Een Tamelijk Lange Bedrijfsnaam Holding B.V.',
      dossierId: 'cmproefdossierkenmerk000000',
      sealed: false,
      fieldCounts: { signature: 3, initials: 1, date: 1 },
      signers: (['KANTOOR', 'SMS', 'EMAIL'] as const).map((v, i) => ({
        name: `Ondertekenaar ${i + 1} met een lange naam`,
        email: `ondertekenaar${i + 1}@een-tamelijk-lang-domein-voorbeeld.nl`,
        verification: v,
        ip: '198.51.100.24',
        userAgent: langeUa,
        sentAt: new Date(),
        openedAt: new Date(),
        otpVerifiedAt: new Date(),
        reauthVerifiedAt: new Date(),
        signedAt: new Date()
      }))
    })
    const proefOverloop = await buitenDeKantlijn(proef.sealedBytes)
    check(
      'certificaat blijft binnen de kantlijn bij de langste omschrijvingen',
      proefOverloop.length === 0,
      proefOverloop.slice(0, 5)
    )
  }

  // Het integriteitsblok hoort op één pagina: kop, uitleg, vingerafdruk en de
  // eventuele waarschuwing. Eerder bleven kop en uitleg achter op de vorige
  // pagina en begon de nieuwe met een kale hash zonder tekst erbij.
  // Geankerd op de pagina van de vingerafdruk zelf, niet op die van de kop: de
  // breuk die hier fout ging liet de kop en de uitleg juist staan en verplaatste
  // alleen de hash. Een controle die bij de kop begint, ziet dat niet.
  const certPaginas = metCert.preSealKey ? await paginasVan(await storage().get(metCert.preSealKey)) : []
  const hashPagina = certPaginas.findIndex((p) => /\b[0-9a-f]{32}\b/.test(p))
  check('certificaat toont de vingerafdruk', hashPagina >= 0)
  if (hashPagina >= 0) {
    const blad = certPaginas[hashPagina]
    check('de kop "Integriteit" staat bij de vingerafdruk', blad.includes('Integriteit'), blad.slice(0, 400))
    check(
      'de uitleg staat op dezelfde pagina als de vingerafdruk',
      blad.includes('SHA-256-vingerafdruk is berekend'),
      blad.slice(0, 400)
    )
    check(
      'het moment van opmaak staat op dezelfde pagina als de vingerafdruk',
      blad.includes('Certificaat opgemaakt op'),
      blad.slice(-400)
    )
    if (certTekst.includes('Dit document is niet verzegeld.')) {
      check(
        'de waarschuwing zonder zegel staat bij de vingerafdruk',
        blad.includes('Dit document is niet verzegeld.'),
        blad.slice(-400)
      )
    }
  }

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
