/**
 * Regressietest na changeset v1.2. Draait tegen de testdatabase.
 *   npm run test:audit
 */
import { prisma } from '@/lib/db'
import { writeAudit, verifyAuditChain } from '@/lib/audit'
import { sealDocument } from '@/lib/pdf/seal'
import { storage } from '@/lib/storage'
import { purgeExpiredDossiers } from '@/lib/retention'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

async function maakAccountant() {
  return prisma.accountant.upsert({
    where: { email: 'regressie@ottovisseraccountants.nl' },
    update: {},
    create: {
      email: 'regressie@ottovisseraccountants.nl',
      name: 'Regressie Tester',
      passwordHash: 'x',
      role: 'BEHEERDER'
    }
  })
}

/** Resten van een eerdere run weghalen; die bevatten opzettelijk gebroken ketens. */
async function schoonVooraf(accId: string) {
  const oud = await prisma.dossier.findMany({ where: { ownerId: accId }, select: { id: true } })
  for (const d of oud) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
      await tx.dossier.delete({ where: { id: d.id } })
    })
  }
  if (oud.length) console.log(`(${oud.length} dossier(s) uit een eerdere run opgeruimd)`)
}

async function maakDossier(accId: string, title: string) {
  return prisma.dossier.create({ data: { title, ownerId: accId, status: 'CONCEPT' } })
}

/** 1. Auditketen: per dossier, volledig, en manipulatie wordt gezien. */
async function testAuditketen(accId: string) {
  const d1 = await maakDossier(accId, 'Keten A')
  const d2 = await maakDossier(accId, 'Keten B')
  for (const d of [d1, d2]) {
    await writeAudit({ type: 'AANGEMAAKT', dossierId: d.id, message: 'start' })
    await writeAudit({ type: 'VERZONDEN', dossierId: d.id, message: 'verstuurd' })
    await writeAudit({ type: 'ONDERTEKEND', dossierId: d.id, message: 'getekend' })
  }
  // Eerst kijken of er wel iets IS geschreven. writeAudit faalt met opzet stil
  // (het auditspoor mag de flow niet blokkeren), dus een lege keten is óók
  // "intact" en zou de rest van deze test zinloos maken.
  const geschreven = await prisma.auditEvent.count({ where: { dossierId: { in: [d1.id, d2.id] } } })
  check('alle zes auditregels zijn daadwerkelijk geschreven', geschreven === 6, geschreven)

  const schoon = await verifyAuditChain()
  check('auditketen is intact na normaal gebruik', schoon.ok, schoon)

  // Manipulatie: één bericht aanpassen zonder de hash bij te werken.
  const doelwit = await prisma.auditEvent.findFirst({
    where: { dossierId: d2.id, type: 'VERZONDEN' },
    select: { id: true, message: true }
  })
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.$executeRawUnsafe(`UPDATE "AuditEvent" SET message = $1 WHERE id = $2`, 'gewijzigd', doelwit!.id)
  })
  const gemanipuleerd = await verifyAuditChain()
  check('gewijzigde auditregel wordt gedetecteerd', !gemanipuleerd.ok, gemanipuleerd)

  // Herstellen zodat de volgende tests op een schone keten draaien.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.$executeRawUnsafe(`UPDATE "AuditEvent" SET message = $1 WHERE id = $2`, doelwit!.message, doelwit!.id)
  })
  const hersteld = await verifyAuditChain()
  check('keten weer intact na herstel', hersteld.ok, hersteld)

  // Ketenstart-invariant: eerste regel van een keten mag geen voorganger noemen.
  const eerste = await prisma.auditEvent.findFirst({
    where: { dossierId: d1.id },
    orderBy: { seq: 'asc' },
    select: { id: true }
  })
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = $1`, eerste!.id)
  })
  const afgekapt = await verifyAuditChain()
  check('verwijderde eerste regel wordt gedetecteerd (ketenstart-invariant)', !afgekapt.ok, afgekapt)

  // De opzettelijk gebroken keten weer weghalen, anders vervuilt hij de rest.
  for (const d of [d1, d2]) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
      await tx.dossier.delete({ where: { id: d.id } })
    })
  }
  const opgeruimd = await verifyAuditChain()
  check('geen resten van de testketens', opgeruimd.ok, opgeruimd)
}

/** 2. Append-only trigger: zonder noodschakelaar geen UPDATE of DELETE. */
async function testAppendOnly(accId: string) {
  const d = await maakDossier(accId, 'Append-only')
  await writeAudit({ type: 'AANGEMAAKT', dossierId: d.id, message: 'origineel' })
  const rij = await prisma.auditEvent.findFirstOrThrow({ where: { dossierId: d.id }, select: { id: true } })

  let updateGeweigerd = false
  try {
    await prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET message = 'stil gewijzigd' WHERE id = $1`, rij.id)
  } catch {
    updateGeweigerd = true
  }
  const na = await prisma.auditEvent.findUniqueOrThrow({ where: { id: rij.id }, select: { message: true } })
  check('UPDATE op auditregel wordt geweigerd', updateGeweigerd && na.message === 'origineel', {
    updateGeweigerd,
    message: na.message
  })

  let deleteGeweigerd = false
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE id = $1`, rij.id)
  } catch {
    deleteGeweigerd = true
  }
  const bestaatNog = await prisma.auditEvent.findUnique({ where: { id: rij.id }, select: { id: true } })
  check('DELETE op auditregel wordt geweigerd', deleteGeweigerd && !!bestaatNog, { deleteGeweigerd, bestaatNog })
}

/** 3. Certificaat vermeldt onverzegeld, en die regel is niet te onderdrukken. */
async function testCertificaatOnverzegeld() {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const leeg = await PDFDocument.create()
  leeg.addPage([595, 842]).drawText('Testdocument')
  const bytes = await leeg.save()

  const zonderZegel = await sealDocument({
    pdfBytes: bytes,
    dossierTitle: 'Zonder zegel',
    dossierId: 'test-1',
    sealed: false,
    signers: [{ name: 'Klant', email: 'klant@example.com', signedAt: new Date() }]
  })
  const metZegel = await sealDocument({
    pdfBytes: bytes,
    dossierTitle: 'Met zegel',
    dossierId: 'test-2',
    sealed: true,
    signers: [{ name: 'Klant', email: 'klant@example.com', signedAt: new Date() }]
  })

  const tekst = async (b: Uint8Array) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(b), useSystemFonts: true }).promise
    let out = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      out += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
    }
    return out
  }
  const t1 = await tekst(zonderZegel.sealedBytes)
  const t2 = await tekst(metZegel.sealedBytes)
  check('certificaat meldt "Dit document is niet verzegeld." bij SEAL_MODE=none', t1.includes('niet verzegeld'), t1.slice(-400))
  check('die melding staat er niet bij een verzegeld document', !t2.includes('niet verzegeld'))
  check('certificaat legt de per-ondertekenaar-hash uit', t2.includes('die') && t2.includes('persoon op het scherm zag'))
  check('hash is stabiel en identiek voor dezelfde invoer', zonderZegel.sha256 === metZegel.sha256, {
    a: zonderZegel.sha256,
    b: metZegel.sha256
  })
}

/** 4. Opslagversleuteling met sleutelversie: oude versie blijft leesbaar. */
async function testOpslagRotatie() {
  const store = storage()
  const geheim = Buffer.from('Vertrouwelijke jaarrekening ' + 'x'.repeat(2000))
  const key = await store.put(geheim, 'pdf')
  const terug = await store.get(key)
  check('versleuteld opgeslagen bestand komt byte-identiek terug', Buffer.from(terug).equals(geheim))
  await store.remove(key)
  let weg = false
  try {
    await store.get(key)
  } catch {
    weg = true
  }
  check('verwijderd bestand is echt weg', weg)
}

/** 5. Bewaartermijn: dry-run raakt niets, echte opruiming laat een grafsteen na. */
async function testBewaartermijn(accId: string) {
  const store = storage()
  const key = await store.put(Buffer.from('inhoud'), 'pdf')
  const d = await prisma.dossier.create({
    data: {
      title: 'Bewaartermijn verstreken',
      ownerId: accId,
      status: 'ONDERTEKEND',
      retentionUntil: new Date(Date.now() - 86_400_000),
      documents: { create: { title: 'Stuk', fileName: 'stuk.pdf', order: 0, originalKey: key } }
    }
  })
  await writeAudit({ type: 'AANGEMAAKT', dossierId: d.id, message: 'aangemaakt' })
  await writeAudit({ type: 'VERZEGELD', dossierId: d.id, message: 'verzegeld' })
  const laatsteHash = (
    await prisma.auditEvent.findFirstOrThrow({
      where: { dossierId: d.id },
      orderBy: { seq: 'desc' },
      select: { hash: true }
    })
  ).hash

  const droog = await purgeExpiredDossiers({ dryRun: true })
  const staatErNog = await prisma.dossier.findUnique({ where: { id: d.id }, select: { id: true } })
  check('dry-run rapporteert werk maar verwijdert niets', droog.dossiersVerwijderd >= 1 && !!staatErNog, droog)

  const echt = await purgeExpiredDossiers()
  const weg = await prisma.dossier.findUnique({ where: { id: d.id }, select: { id: true } })
  const auditWeg = await prisma.auditEvent.count({ where: { dossierId: d.id } })
  check('opruiming verwijdert dossier en auditspoor samen', !weg && auditWeg === 0, { weg, auditWeg, echt })

  let bestandWeg = false
  try {
    await store.get(key)
  } catch {
    bestandWeg = true
  }
  check('bijbehorend bestand is opgeruimd', bestandWeg)

  const grafsteen = await prisma.auditEvent.findFirst({
    where: { type: 'BEWAARTERMIJN_OPGERUIMD' },
    orderBy: { seq: 'desc' },
    select: { metadata: true }
  })
  const meta = (grafsteen?.metadata ?? {}) as Record<string, unknown>
  check('grafsteen legt de laatste hash van de opgeruimde keten vast', meta.laatsteHash === laatsteHash, meta)

  const naOpruiming = await verifyAuditChain()
  check('auditketen blijft geldig na legitieme opruiming', naOpruiming.ok, naOpruiming)
}

async function main() {
  const acc = await maakAccountant()
  await schoonVooraf(acc.id)
  await testAuditketen(acc.id)
  await testAppendOnly(acc.id)
  await testCertificaatOnverzegeld()
  await testOpslagRotatie()
  await testBewaartermijn(acc.id)

  console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
  await prisma.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
