/**
 * Punt 1, 7, 9 en 10 uit changeset v1.3: opslagsleutels nooit in place
 * overschrijven, losse bestanden opruimen met marge, alle vijf sleutels bij de
 * bewaartermijn, ankers, en de ingebruiknamegrendel.
 *
 *   npm run test:opslag
 */
import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { writeAudit, verifyAuditChain, AuditWriteError } from '@/lib/audit'
import { cleanupOrphanBlobs, ORPHAN_GRACE_MS } from '@/lib/orphans'
import { purgeExpiredDossiers, markArchived } from '@/lib/retention'
import { sorteerKetens, GEEN_DOSSIER, isLockTimeout } from '@/lib/locks'
import { assertReadyForRealSealing } from '@/env'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}
const throws = (fn: () => void) => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

async function accountant() {
  return prisma.accountant.upsert({
    where: { email: 'opslag@ottovisseraccountants.nl' },
    update: {},
    create: { email: 'opslag@ottovisseraccountants.nl', name: 'Opslag Tester', passwordHash: 'x', role: 'BEHEERDER' }
  })
}

async function schoon(accId: string) {
  for (const d of await prisma.dossier.findMany({ where: { ownerId: accId }, select: { id: true } })) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
      await tx.dossier.delete({ where: { id: d.id } })
    })
  }
}

/** 1. Elke schrijfactie levert een nieuwe sleutel; nooit dezelfde overschrijven. */
async function testNieuweSleutels() {
  const store = storage()
  const a = await store.put(Buffer.from('versie een'), 'pdf')
  const b = await store.put(Buffer.from('versie twee'), 'pdf')
  check('twee schrijfacties leveren twee verschillende sleutels', a !== b, { a, b })
  check('de eerste versie is nog leesbaar', (await store.get(a)).toString() === 'versie een')
  check('de tweede versie ook', (await store.get(b)).toString() === 'versie twee')
  await store.remove(a)
  await store.remove(b)
}

/** 2. Losse bestanden: marge respecteren, gerefereerde bestanden overslaan. */
async function testLosseBestanden(accId: string) {
  const store = storage()
  const verweesd = await store.put(Buffer.from('niemand verwijst hiernaar'), 'pdf')
  const gebruikt = await store.put(Buffer.from('hier verwijst een document naar'), 'pdf')
  const dossier = await prisma.dossier.create({
    data: {
      title: 'Met bestand',
      ownerId: accId,
      status: 'CONCEPT',
      documents: { create: { title: 'Stuk', fileName: 'stuk.pdf', order: 0, originalKey: gebruikt } }
    }
  })

  // Binnen de marge: niets mag weg, ook niet de wees.
  const vers = await cleanupOrphanBlobs({ dryRun: true })
  check('een net weggeschreven wees blijft binnen de marge staan', !vers.kandidaten.includes(verweesd), vers)
  check('en wordt als "binnen de marge" geteld', vers.binnenMarge >= 1, vers)

  // Doen alsof de marge voorbij is.
  const straks = new Date(Date.now() + ORPHAN_GRACE_MS + 60_000)
  const oud = await cleanupOrphanBlobs({ dryRun: true, now: straks })
  check('na de marge is de wees een kandidaat', oud.kandidaten.includes(verweesd), oud.kandidaten.slice(0, 5))
  check('een gerefereerd bestand nooit', !oud.kandidaten.includes(gebruikt))

  const echt = await cleanupOrphanBlobs({ now: straks })
  check('de wees is opgeruimd', echt.verwijderd >= 1, echt)
  let weg = false
  try {
    await store.get(verweesd)
  } catch {
    weg = true
  }
  check('en is echt weg', weg)
  check('het gerefereerde bestand staat er nog', (await store.get(gebruikt)).length > 0)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.dossier.delete({ where: { id: dossier.id } })
  })
  await store.remove(gebruikt)
}

/**
 * 3. Het bewaarmodel uit changeset v1.4: nooit op de klok, altijd op de vlag.
 *
 * Dit is het acceptatiecriterium letterlijk: een ondertekend dossier van 200 dagen
 * oud ZONDER vinkje heeft nog al zijn bestanden. Zet het vinkje, zet de klok 91 dagen
 * vooruit, en dan zijn de bestanden weg terwijl alle auditregels en de hashketen
 * intact zijn.
 */
async function testBewaarmodel(accId: string) {
  const store = storage()
  const sleutels = {
    originalKey: await store.put(Buffer.from('origineel'), 'pdf'),
    workingKey: await store.put(Buffer.from('werkversie'), 'pdf'),
    preSealKey: await store.put(Buffer.from('voor verzegelen'), 'pdf'),
    postQualifiedKey: await store.put(Buffer.from('na waarmerken'), 'pdf'),
    sealedKey: await store.put(Buffer.from('verzegeld'), 'pdf')
  }
  const tweehonderdDagenTerug = new Date(Date.now() - 200 * 86_400_000)
  const dossier = await prisma.dossier.create({
    data: {
      title: 'Ondertekend maar nooit afgevinkt',
      ownerId: accId,
      status: 'ONDERTEKEND',
      completedAt: tweehonderdDagenTerug,
      documents: { create: { title: 'Stuk', fileName: 'stuk.pdf', order: 0, ...sleutels } }
    }
  })
  await prisma.$executeRawUnsafe(`UPDATE "Dossier" SET "updatedAt" = $1 WHERE id = $2`, tweehonderdDagenTerug, dossier.id)
  await writeAudit({ type: 'AANGEMAAKT', dossierId: dossier.id, message: 'aangemaakt' })
  await writeAudit({ type: 'VERZEGELD', dossierId: dossier.id, message: 'verzegeld' })

  // Zonder vinkje: er mag NIETS verdwijnen, hoe oud het ook is.
  const zonderVinkje = await purgeExpiredDossiers()
  const naZonder = await prisma.document.findFirstOrThrow({ where: { dossierId: dossier.id } })
  check(
    'een ondertekend dossier van 200 dagen zonder vinkje houdt al zijn bestanden',
    !!naZonder.sealedKey && !!naZonder.originalKey,
    { sealedKey: naZonder.sealedKey, resultaat: zonderVinkje }
  )
  check('en wordt ook niet als opgeruimd geteld', zonderVinkje.blobsGewist === 0, zonderVinkje)

  // Vinkje zetten.
  const gezet = await markArchived({ dossierId: dossier.id, accountantId: accId, note: '12345 - Test BV/2024' })
  check('het archiveervinkje is te zetten op een afgerond dossier', gezet.ok, gezet)
  const gearchiveerd = await prisma.dossier.findUniqueOrThrow({
    where: { id: dossier.id },
    select: { archivedAt: true, archivedById: true, archivedNote: true }
  })
  check('wie en wanneer staat vast', !!gearchiveerd.archivedAt && gearchiveerd.archivedById === accId, gearchiveerd)
  const archiefRegel = await prisma.auditEvent.findFirst({
    where: { dossierId: dossier.id, type: 'GEARCHIVEERD' },
    select: { message: true }
  })
  check('het archiveren staat in het auditspoor met de map', !!archiefRegel?.message?.includes('12345'), archiefRegel)

  // Vinkje net gezet: de termijn is nog niet om.
  const teVroeg = await purgeExpiredDossiers()
  const naVroeg = await prisma.document.findFirstOrThrow({ where: { dossierId: dossier.id } })
  check('direct na het vinkje verdwijnt er nog niets', !!naVroeg.sealedKey, teVroeg)

  // Klok 91 dagen vooruit.
  const straks = new Date(Date.now() + 91 * 86_400_000)
  const res = await purgeExpiredDossiers({ now: straks })
  check('na de termijn zijn de bestanden gewist', res.blobsGewist >= 1, res)

  const naDoc = await prisma.document.findFirstOrThrow({ where: { dossierId: dossier.id } })
  check(
    'alle vijf de sleutels zijn leeg',
    !naDoc.originalKey && !naDoc.workingKey && !naDoc.preSealKey && !naDoc.postQualifiedKey && !naDoc.sealedKey,
    naDoc
  )
  for (const [soort, key] of Object.entries(sleutels)) {
    let weg = false
    try {
      await store.get(key)
    } catch {
      weg = true
    }
    check(`bestand ${soort} is echt verwijderd`, weg)
  }

  // EN DIT IS DE OMKERING: het bewijs blijft staan.
  const dossierNog = await prisma.dossier.findUnique({ where: { id: dossier.id }, select: { title: true } })
  check('het dossier zelf bestaat nog', !!dossierNog)
  const auditNog = await prisma.auditEvent.count({ where: { dossierId: dossier.id } })
  check('het auditspoor is niet aangeraakt', auditNog >= 3, auditNog)
  const docNog = await prisma.document.count({ where: { dossierId: dossier.id } })
  check('de documentrij met de hashes bestaat nog', docNog === 1, docNog)

  const grafsteen = await prisma.auditEvent.findFirst({
    where: { dossierId: dossier.id, type: 'BEWAARTERMIJN_OPGERUIMD' },
    orderBy: { seq: 'desc' },
    select: { metadata: true }
  })
  const meta = (grafsteen?.metadata ?? {}) as Record<string, unknown>
  const perSoort = (meta.sleutels ?? {}) as Record<string, number>
  check(
    'de grafsteen verantwoordt alle vijf de sleuteltypen',
    Object.keys(perSoort).length === 5 && Object.values(perSoort).every((n) => n === 1),
    perSoort
  )
  check('en meldt dat het bewijs blijft', meta.bewijsBlijft === true && meta.fase === 'blobs', meta)

  const keten = await verifyAuditChain()
  check('de hashketen is intact na het wissen van de bestanden', keten.ok, keten)
}

/** 3b. Nooit afgeronde dossiers mogen zonder vinkje weg. */
async function testNooitAfgerond(accId: string) {
  const store = storage()
  const key = await store.put(Buffer.from('nooit verstuurd'), 'pdf')
  const oud = new Date(Date.now() - 200 * 86_400_000)
  const dossier = await prisma.dossier.create({
    data: {
      title: 'Concept dat nooit is verstuurd',
      ownerId: accId,
      status: 'CONCEPT',
      documents: { create: { title: 'Stuk', fileName: 'stuk.pdf', order: 0, originalKey: key } }
    }
  })
  await prisma.$executeRawUnsafe(`UPDATE "Dossier" SET "updatedAt" = $1 WHERE id = $2`, oud, dossier.id)

  const res = await purgeExpiredDossiers()
  check('een oud, nooit verstuurd concept gaat zonder vinkje weg', res.blobsGewist >= 1, res)
  let weg = false
  try {
    await store.get(key)
  } catch {
    weg = true
  }
  check('het bestand is verwijderd', weg)
}

/** 4. Verplichte auditregels rollen de transactie terug. */
async function testVerplichteAudit(accId: string) {
  const dossier = await prisma.dossier.create({ data: { title: 'Verplichte regel', ownerId: accId, status: 'CONCEPT' } })

  // Een bewijskritieke regel in een transactie die daarna faalt: de regel mag niet
  // achterblijven, want dan zou er een spoor zijn van iets wat niet is gebeurd.
  let teruggerold = false
  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit({ type: 'ONDERTEKEND', dossierId: dossier.id, message: 'test' }, { mode: 'required', tx })
      throw new Error('kunstmatige fout na de auditregel')
    })
  } catch {
    teruggerold = true
  }
  const aanwezig = await prisma.auditEvent.count({ where: { dossierId: dossier.id, type: 'ONDERTEKEND' } })
  check('een teruggerolde transactie laat geen auditregel achter', teruggerold && aanwezig === 0, { teruggerold, aanwezig })

  // En een verplichte regel die zelf niet kan worden geschreven, gooit door.
  let gegooid: unknown = null
  try {
    await prisma.$transaction(async (tx) => {
      // dossierId dat niet bestaat: de foreign key weigert de insert.
      await writeAudit({ type: 'VERZEGELD', dossierId: 'bestaat-niet-xyz', message: 'test' }, { mode: 'required', tx })
    })
  } catch (e) {
    gegooid = e
  }
  check('een mislukte verplichte regel gooit AuditWriteError', gegooid instanceof AuditWriteError, gegooid)

  // Een gewone regel blijft stil falen: het auditspoor mag de flow niet blokkeren.
  let stil = true
  try {
    await writeAudit({ type: 'GEDOWNLOAD', dossierId: 'bestaat-niet-xyz', message: 'test' })
  } catch {
    stil = false
  }
  check('een niet-kritieke regel faalt stil', stil)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.dossier.delete({ where: { id: dossier.id } })
  })
}

/** 5. De vergrendelingsvolgorde en de herkenning van een lock timeout. */
function testVergrendeling() {
  const gesorteerd = sorteerKetens(['zzz', null, 'aaa', 'mmm'])
  check(
    'ketens worden oplopend gesorteerd met de dossierloze keten als laatste',
    JSON.stringify(gesorteerd) === JSON.stringify(['aaa', 'mmm', 'zzz', GEEN_DOSSIER]),
    gesorteerd
  )
  check('dubbele sleutels worden ontdubbeld', sorteerKetens(['a', 'a', null, null]).length === 2)
  check('een lock timeout wordt herkend', isLockTimeout({ code: '55P03' }))
  check('een statement timeout ook', isLockTimeout({ meta: { code: '57014' } }))
  check('een gewone fout niet', !isLockTimeout(new Error('iets anders')))
}

/** 6. De ingebruiknamegrendel: bij qualified moet er een provider zijn. */
function testGrendel() {
  check(
    'qualified met een werkende provider mag starten',
    !throws(() => assertReadyForRealSealing({ SEAL_MODE: 'qualified', PROFESSIONAL_SIGNING_DRIVER: 'cleverbase' }))
  )
  // Dit is de gevaarlijkste stille toestand: de configuratie zegt dat er wordt
  // verzegeld, maar er is niets om mee te verzegelen.
  check(
    'qualified zonder provider weigert te starten',
    throws(() => assertReadyForRealSealing({ SEAL_MODE: 'qualified', PROFESSIONAL_SIGNING_DRIVER: 'none' }))
  )
  check(
    'zonder verzegeling blokkeert de grendel niets',
    !throws(() => assertReadyForRealSealing({ SEAL_MODE: 'none', PROFESSIONAL_SIGNING_DRIVER: 'none' }))
  )
  check(
    'de gereserveerde waarde organisation weigert te starten',
    throws(() => assertReadyForRealSealing({ SEAL_MODE: 'organisation', PROFESSIONAL_SIGNING_DRIVER: 'cleverbase' }))
  )
}

async function main() {
  const acc = await accountant()
  await schoon(acc.id)

  testVergrendeling()
  testGrendel()
  await testNieuweSleutels()
  await testLosseBestanden(acc.id)
  await testBewaarmodel(acc.id)
  await testNooitAfgerond(acc.id)
  await testVerplichteAudit(acc.id)

  const keten = await verifyAuditChain()
  check('auditketen is intact', keten.ok, keten)

  await schoon(acc.id)
  console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
  await prisma.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
