/**
 * Punt 8 uit changeset v1.3: herinneringen, verlopen, opnieuw verzenden en de
 * nudge voor een dossier dat op het waarmerk wacht.
 *
 *   npm run test:levensloop
 */
import { prisma } from '@/lib/db'
import { writeAudit, verifyAuditChain } from '@/lib/audit'
import {
  volgendeHerinnering,
  sendDueReminders,
  expireDueDossiers,
  resendExpiredDossier,
  nudgeWaitingSignatures,
  HERINNER_DAGEN
} from '@/lib/lifecycle'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

const DAG = 86_400_000

async function accountant() {
  return prisma.accountant.upsert({
    where: { email: 'levensloop@ottovisseraccountants.nl' },
    update: {},
    create: { email: 'levensloop@ottovisseraccountants.nl', name: 'Levensloop Tester', passwordHash: 'x', role: 'BEHEERDER' }
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

/** 1. De rekenregel voor herinneringen, zonder database. */
function testTermijnen() {
  const nu = new Date('2026-07-25T10:00:00Z')
  const verstuurd = new Date(nu.getTime() - 6 * DAG)

  check(
    'na zes dagen is de eerste herinnering aan de beurt',
    volgendeHerinnering({ sentAt: verstuurd, expiresAt: new Date(nu.getTime() + 10 * DAG), remindersSent: 0, now: nu })
      ?.nummer === 1
  )
  check(
    'na twee dagen nog niet',
    volgendeHerinnering({
      sentAt: new Date(nu.getTime() - 2 * DAG),
      expiresAt: new Date(nu.getTime() + 10 * DAG),
      remindersSent: 0,
      now: nu
    }) === null
  )
  // Dit is de correctie uit 8.2: een herinnering naar een link die morgen dood is,
  // is erger dan geen herinnering.
  check(
    'herinnering valt weg als de link binnen een etmaal verloopt',
    volgendeHerinnering({
      sentAt: verstuurd,
      expiresAt: new Date(nu.getTime() + 0.5 * DAG),
      remindersSent: 0,
      now: nu
    }) === null
  )
  check(
    'bij een korte geldigheidsduur valt de tweede herinnering weg',
    volgendeHerinnering({
      sentAt: new Date(nu.getTime() - 13 * DAG),
      // TTL van 7 dagen: dag 12 ligt ver na het verlopen.
      expiresAt: new Date(new Date(nu.getTime() - 13 * DAG).getTime() + 7 * DAG),
      remindersSent: 1,
      now: nu
    }) === null
  )
  check(
    'na de laatste termijn komt er niets meer',
    volgendeHerinnering({
      sentAt: new Date(nu.getTime() - 60 * DAG),
      expiresAt: new Date(nu.getTime() + 60 * DAG),
      remindersSent: HERINNER_DAGEN.length,
      now: nu
    }) === null
  )
}

/** 2. Herinnering wordt echt verstuurd en de teller loopt maar één keer op. */
async function testHerinneringen(accId: string) {
  const sentAt = new Date(Date.now() - 6 * DAG)
  const dossier = await prisma.dossier.create({
    data: {
      title: 'Wacht op de cliënt',
      ownerId: accId,
      status: 'VERZONDEN',
      sentAt,
      expiresAt: new Date(Date.now() + 10 * DAG),
      recipients: {
        create: [
          { name: 'Trage Klant', email: 'traag@example.com', role: 'EXTERN', order: 0, status: 'PENDING' },
          { name: 'Snelle Klant', email: 'snel@example.com', role: 'EXTERN', order: 1, status: 'SIGNED' },
          {
            name: 'Onbezorgbaar',
            email: 'bounce@example.com',
            role: 'EXTERN',
            order: 2,
            status: 'PENDING',
            mailStatus: 'BOUNCED'
          }
        ]
      }
    },
    include: { recipients: true }
  })

  // `sendDueReminders` veegt de hele database. Er wordt hier daarom niet op een
  // exact totaal gecontroleerd: elk ander dossier dat toevallig ook aan de beurt
  // is, telt mee. Zo'n controle gaat niet stuk omdat de code fout is maar omdat
  // er iets naast staat — en dan wordt hij genegeerd. Wat wél hard is: wat er met
  // dít dossier en déze drie ontvangers gebeurt.
  const res = await sendDueReminders()
  check('de veegronde heeft dit dossier meegenomen', res.dossiers >= 1, res)

  const regels = await prisma.auditEvent.findMany({
    where: { dossierId: dossier.id, type: 'HERINNERD' },
    select: { message: true, recipientId: true }
  })
  check('alleen wie nog moet tekenen én bereikbaar is krijgt een herinnering', regels.length === 1, regels)
  const traag = dossier.recipients.find((r) => r.email === 'traag@example.com')!
  check('bij de juiste ontvanger', regels[0]?.recipientId === traag.id)
  check('de herinnering staat in het auditspoor', !!regels[0])

  const na = await prisma.recipient.findUniqueOrThrow({ where: { id: traag.id }, select: { tokenHash: true } })
  check('de ontvanger heeft een nieuwe tekenlink gekregen', !!na.tokenHash)

  // Nog een ronde: dag 12 is nog niet bereikt, dus voor dit dossier niets. Ook
  // hier geen totaal, maar het aantal herinneringen van dít dossier.
  await sendDueReminders()
  const naTweede = await prisma.auditEvent.count({ where: { dossierId: dossier.id, type: 'HERINNERD' } })
  check('een tweede ronde op dezelfde dag stuurt niets', naTweede === 1, naTweede)

  const geteld = await prisma.dossier.findUniqueOrThrow({
    where: { id: dossier.id },
    select: { remindersSent: true, lastReminderAt: true }
  })
  check('de teller staat op één', geteld.remindersSent === 1, geteld)
  return dossier.id
}

/** 3. Verlopen: status, tokens weg, handtekeningen blijven. */
async function testVerlopen(accId: string) {
  const dossier = await prisma.dossier.create({
    data: {
      title: 'Verlopen verzoek',
      ownerId: accId,
      status: 'GEDEELTELIJK',
      sentAt: new Date(Date.now() - 20 * DAG),
      expiresAt: new Date(Date.now() - DAG),
      recipients: {
        create: [
          { name: 'Heeft getekend', email: 'klaar@example.com', role: 'EXTERN', order: 0, status: 'SIGNED', signedAt: new Date() },
          { name: 'Niet getekend', email: 'nooit@example.com', role: 'EXTERN', order: 1, status: 'PENDING', tokenHash: 'x'.repeat(64) }
        ]
      }
    },
    include: { recipients: true }
  })

  // Ook een veegronde over de hele database; zie de toelichting bij de
  // herinneringen. Wat er met dít dossier gebeurt, staat hieronder.
  const res = await expireDueDossiers()
  check('de veegronde heeft dit dossier meegenomen', res.dossiers >= 1, res)
  check('er is minstens één tekenlink ingetrokken', res.tokensIngetrokken >= 1, res)

  const na = await prisma.dossier.findUniqueOrThrow({
    where: { id: dossier.id },
    include: { recipients: true }
  })
  check('status staat op VERLOPEN', na.status === 'VERLOPEN', na.status)
  const open = na.recipients.find((r) => r.email === 'nooit@example.com')!
  check('de ongebruikte tekenlink is weg', open.tokenHash === null)
  const klaar = na.recipients.find((r) => r.email === 'klaar@example.com')!
  check('de al gezette handtekening blijft staan', klaar.status === 'SIGNED' && !!klaar.signedAt)

  const regel = await prisma.auditEvent.findFirst({ where: { dossierId: dossier.id, type: 'VERLOPEN' } })
  check('het verlopen staat in het auditspoor', !!regel, regel?.message)

  return dossier.id
}

/** 4. Opnieuw verzenden mag bij VERLOPEN en niet bij GEWEIGERD. */
async function testHerverzenden(accId: string, verlopenDossierId: string) {
  const res = await resendExpiredDossier({ dossierId: verlopenDossierId, accountantId: accId, reason: 'cliënt was op vakantie' })
  check('een verlopen verzoek is opnieuw te versturen', res.ok, res)

  const na = await prisma.dossier.findUniqueOrThrow({
    where: { id: verlopenDossierId },
    include: { recipients: true }
  })
  check('status is weer open', na.status === 'GEDEELTELIJK', na.status)
  check('de teller voor herinneringen staat weer op nul', na.remindersSent === 0, na.remindersSent)
  check('het aantal herverzendingen is bijgehouden', na.resendCount === 1, na.resendCount)
  check('er is een nieuwe vervaldatum', !!na.expiresAt && na.expiresAt > new Date())
  const open = na.recipients.find((r) => r.email === 'nooit@example.com')!
  check('wie nog moest tekenen heeft een nieuwe link', !!open.tokenHash)
  const klaar = na.recipients.find((r) => r.email === 'klaar@example.com')!
  check('wie al had getekend krijgt géén nieuwe link', klaar.status === 'SIGNED')

  const regel = await prisma.auditEvent.findFirst({
    where: { dossierId: verlopenDossierId, type: 'HERVERZONDEN' },
    select: { message: true }
  })
  check('het herverzenden staat in het auditspoor met de reden', !!regel?.message?.includes('vakantie'), regel)

  // Hetzelfde dossier is nu open, dus opnieuw verzenden mag niet meer.
  const nogmaals = await resendExpiredDossier({ dossierId: verlopenDossierId, accountantId: accId })
  check('een open verzoek is niet opnieuw te versturen', !nogmaals.ok, nogmaals)

  // GEWEIGERD blijft onherroepelijk.
  const geweigerd = await prisma.dossier.create({
    data: {
      title: 'Geweigerd verzoek',
      ownerId: accId,
      status: 'GEWEIGERD',
      recipients: { create: [{ name: 'Weigeraar', email: 'nee@example.com', role: 'EXTERN', order: 0, status: 'DECLINED' }] }
    }
  })
  const weigering = await resendExpiredDossier({ dossierId: geweigerd.id, accountantId: accId })
  check('een geweigerd verzoek is onherroepelijk', !weigering.ok && /geweigerd/i.test(weigering.error ?? ''), weigering)
}

/** 5. Nudge voor een dossier dat op het waarmerk van de accountant wacht. */
async function testNudge(accId: string) {
  const oud = new Date(Date.now() - 5 * DAG)
  const dossier = await prisma.dossier.create({
    data: { title: 'Wacht op waarmerk', ownerId: accId, status: 'WACHT_OP_WAARMERK' }
  })
  // updatedAt is @updatedAt, dus die moet met raw SQL naar het verleden.
  await prisma.$executeRawUnsafe(`UPDATE "Dossier" SET "updatedAt" = $1 WHERE id = $2`, oud, dossier.id)

  const res = await nudgeWaitingSignatures()
  check('de eigenaar is gepord', res.dossiers === 1 && res.eigenaren === 1, res)

  const tweede = await nudgeWaitingSignatures()
  check('niet twee keer achter elkaar porren', tweede.dossiers === 0, tweede)

  const regel = await prisma.auditEvent.findFirst({
    where: { dossierId: dossier.id, type: 'HERINNERD' },
    select: { message: true }
  })
  check('de nudge staat in het auditspoor', !!regel?.message?.includes('waarmerk'), regel)
}

async function main() {
  const acc = await accountant()
  await schoon(acc.id)

  testTermijnen()
  await testHerinneringen(acc.id)
  const verlopenId = await testVerlopen(acc.id)
  await testHerverzenden(acc.id, verlopenId)
  await testNudge(acc.id)

  const keten = await verifyAuditChain()
  check('auditketen is intact na de hele levensloop', keten.ok, keten)

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
