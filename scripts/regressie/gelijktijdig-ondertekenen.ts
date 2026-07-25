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
import { applySignature } from '@/lib/signflow'
import { verifyAuditChain } from '@/lib/audit'

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

  // Allebei tegelijk, zonder onderling wachten.
  const resultaten = await Promise.allSettled(
    ontvangers.map((r) => applySignature(r.id, pngDataUrl(), { ip: '127.0.0.1', userAgent: 'regressie' }))
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

  console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
  await prisma.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
