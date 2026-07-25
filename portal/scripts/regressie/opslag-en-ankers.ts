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
import { purgeExpiredDossiers } from '@/lib/retention'
import { sorteerKetens, GEEN_DOSSIER, isLockTimeout } from '@/lib/locks'
import { assertReadyForRealSealing, assertValidatorHasNoCredentials } from '@/env'

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

/** 3. Bewaartermijn ruimt alle vijf de sleutels op en verantwoordt dat. */
async function testVijfSleutels(accId: string) {
  const store = storage()
  const sleutels = {
    originalKey: await store.put(Buffer.from('origineel'), 'pdf'),
    workingKey: await store.put(Buffer.from('werkversie'), 'pdf'),
    preSealKey: await store.put(Buffer.from('voor verzegelen'), 'pdf'),
    postQualifiedKey: await store.put(Buffer.from('na waarmerken'), 'pdf'),
    sealedKey: await store.put(Buffer.from('verzegeld'), 'pdf')
  }
  const dossier = await prisma.dossier.create({
    data: {
      title: 'Bewaartermijn met alle sleutels',
      ownerId: accId,
      status: 'ONDERTEKEND',
      retentionUntil: new Date(Date.now() - 86_400_000),
      documents: { create: { title: 'Stuk', fileName: 'stuk.pdf', order: 0, ...sleutels } }
    }
  })
  await writeAudit({ type: 'AANGEMAAKT', dossierId: dossier.id, message: 'aangemaakt' })

  const res = await purgeExpiredDossiers()
  check('het dossier is opgeruimd', res.dossiers >= 1, res)

  for (const [soort, key] of Object.entries(sleutels)) {
    let weg = false
    try {
      await store.get(key)
    } catch {
      weg = true
    }
    check(`${soort} is verwijderd`, weg)
  }

  const grafsteen = await prisma.auditEvent.findFirst({
    where: { type: 'BEWAARTERMIJN_OPGERUIMD' },
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
  check('en het aantal verwijderde bestanden', meta.blobsVerwijderd === 5 && meta.blobsTotaal === 5, meta)
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

/** 6. De ingebruiknamegrendel: drie voorwaarden zodra er echt verzegeld wordt. */
function testGrendel() {
  const compleet = {
    SEAL_MODE: 'sealer',
    VALIDATOR_ISOLATED: true,
    SEALER_URL: 'http://sealer:8000',
    SEALER_VALIDATE_URL: 'http://validator:8000',
    AUDIT_ANCHOR_TARGETS: 'archief,mail',
    AUDIT_HMAC_KEY_V1: 'x'.repeat(40)
  }
  check('met alles geregeld mag het portaal starten', !throws(() => assertReadyForRealSealing(compleet)))
  check(
    'zonder verzegeling blokkeert de grendel niets',
    !throws(() =>
      assertReadyForRealSealing({ ...compleet, SEAL_MODE: 'none', VALIDATOR_ISOLATED: false, AUDIT_ANCHOR_TARGETS: '', AUDIT_HMAC_KEY_V1: undefined })
    )
  )
  check(
    'zonder gescheiden validator weigert hij',
    throws(() => assertReadyForRealSealing({ ...compleet, VALIDATOR_ISOLATED: false }))
  )
  // De vlag alléén is niet genoeg: wijst de validatie nog naar dezelfde container,
  // dan is de scheiding een bewering en geen scheiding.
  check(
    'de vlag zonder eigen URL is niet genoeg',
    throws(() => assertReadyForRealSealing({ ...compleet, SEALER_VALIDATE_URL: undefined }))
  )
  check(
    'en dezelfde URL als de sealer ook niet',
    throws(() => assertReadyForRealSealing({ ...compleet, SEALER_VALIDATE_URL: 'http://sealer:8000' }))
  )
  check(
    'zonder ankerbestemming weigert hij',
    throws(() => assertReadyForRealSealing({ ...compleet, AUDIT_ANCHOR_TARGETS: '' }))
  )
  check(
    'een onbekende ankerbestemming telt niet mee',
    throws(() => assertReadyForRealSealing({ ...compleet, AUDIT_ANCHOR_TARGETS: 'ergens-anders' }))
  )
  check(
    'zonder HMAC-sleutel weigert hij',
    throws(() => assertReadyForRealSealing({ ...compleet, AUDIT_HMAC_KEY_V1: undefined }))
  )

  // De omgekeerde grendel op de validator-container.
  check(
    'de validator mag geen ondertekengegevens in zijn omgeving hebben',
    throws(() => assertValidatorHasNoCredentials({ VALIDATOR_ONLY: true, CLEVERBASE_CSC_CLIENT_SECRET: 'geheim' }))
  )
  check(
    'zonder die gegevens start hij wel',
    !assertValidatorHasNoCredentialsFaalt({ VALIDATOR_ONLY: true, CLEVERBASE_CSC_CLIENT_SECRET: '  ' })
  )
  check(
    'buiten de validator gelden die gegevens gewoon',
    !assertValidatorHasNoCredentialsFaalt({ VALIDATOR_ONLY: false, CLEVERBASE_CSC_CLIENT_SECRET: 'geheim' })
  )
}

function assertValidatorHasNoCredentialsFaalt(cfg: Parameters<typeof assertValidatorHasNoCredentials>[0]): boolean {
  return throws(() => assertValidatorHasNoCredentials(cfg))
}

async function main() {
  const acc = await accountant()
  await schoon(acc.id)

  testVergrendeling()
  testGrendel()
  await testNieuweSleutels()
  await testLosseBestanden(acc.id)
  await testVijfSleutels(acc.id)
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
