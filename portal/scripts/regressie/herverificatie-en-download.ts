/**
 * C.2 en D uit changeset v1.7.
 *
 * C.2 — herverificatie op het ondertekenmoment. Een sessie leeft uren; met een
 * verse TOTP-code staat vast dat de accountant er op dát moment zelf bij was.
 * Het punt dat het vaakst wordt overgeslagen is de replaybescherming: een
 * TOTP-code blijft binnen zijn venster geldig en is dus herbruikbaar. Zonder
 * verbruiken bewijst een code alleen dat iemand hem ooit heeft gezien.
 *
 * D — het downloadtoken. Apart van het tekentoken, want dat is eenmalig en
 * verbruikt na ondertekening.
 *
 *   npm run test:herverificatie
 */
import * as OTPAuth from 'otpauth'
import { prisma } from '@/lib/db'
import { generateTotpSecret, encryptTotpSecret, verifyTotpStep, TOTP_PERIODE_SECONDEN } from '@/lib/auth/totp'
import { herverifieerVoorOndertekenen, claimTotpStap, MAX_HERVERIFICATIE_POGINGEN } from '@/lib/auth/reauth'
import { hashSigningToken, generateSigningToken } from '@/lib/auth/signingToken'
import { consentTextVoor, consentHash } from '@/lib/consent'
import { hashPassword } from '@/lib/auth/password'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

const EMAIL = 'reauth@ottovisseraccountants.nl'

/** Genereert de code die op dit moment geldig is. */
function huidigeCode(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: 'OVP Ondertekenportaal',
    label: 'test',
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIODE_SECONDEN,
    secret: OTPAuth.Secret.fromBase32(secret)
  }).generate()
}

/**
 * Restanten van een vorige run weg. Het auditspoor is append-only, dus dat gaat
 * via de ontsnappingsklep `app.audit_purge` binnen een transactie — precies
 * zoals de bewaartermijn dat doet.
 */
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

  const secret = generateTotpSecret()
  const acc = await prisma.accountant.create({
    data: {
      email: EMAIL,
      name: 'R. Everificatie',
      passwordHash: await hashPassword('Wachtwoord-Voor-Test-1'),
      totpSecret: encryptTotpSecret(secret),
      totpEnabled: true
    }
  })
  const dossier = await prisma.dossier.create({
    data: { title: 'Herverificatietest', ownerId: acc.id, status: 'VERZONDEN' }
  })
  const ontvanger = await prisma.recipient.create({
    data: {
      dossierId: dossier.id,
      accountantId: acc.id,
      role: 'ZELF',
      name: acc.name,
      email: acc.email,
      order: 0
    }
  })

  const ctx = { ip: '127.0.0.1', userAgent: 'regressie' }
  const basis = { accountantId: acc.id, recipientId: ontvanger.id, dossierId: dossier.id, ctx }

  // --- De verse code werkt ---
  const code = huidigeCode(secret)
  const eerste = await herverifieerVoorOndertekenen({ ...basis, code })
  check('een verse code wordt geaccepteerd', eerste.ok, eerste)

  const naEerste = await prisma.accountant.findUniqueOrThrow({
    where: { id: acc.id },
    select: { lastTotpStep: true }
  })
  check('de gebruikte tijdstap is vastgelegd', naEerste.lastTotpStep !== null, naEerste)

  // --- En dezelfde code werkt daarna NIET meer ---
  // Dit is de kern. Zonder deze controle bewijst een code alleen dat iemand hem
  // ooit heeft gezien, niet dat hij nú het apparaat in handen heeft.
  const tweede = await herverifieerVoorOndertekenen({ ...basis, code })
  check('dezelfde code wordt niet nogmaals geaccepteerd', !tweede.ok, tweede)
  check(
    'en de reden is hergebruik, niet "onjuiste code"',
    !tweede.ok && tweede.reden === 'hergebruik',
    !tweede.ok ? tweede.reden : tweede
  )
  check(
    'de melding vertelt wat de gebruiker moet doen',
    !tweede.ok && tweede.melding.toLowerCase().includes('volgende code'),
    !tweede.ok ? tweede.melding : ''
  )

  // --- Een code uit het verleden wordt ook geweigerd ---
  const oudeStap = (naEerste.lastTotpStep ?? 0) - 5
  check('een oudere tijdstap kan de teller niet terugzetten', !(await claimTotpStap(acc.id, oudeStap)))
  const naPoging = await prisma.accountant.findUniqueOrThrow({
    where: { id: acc.id },
    select: { lastTotpStep: true }
  })
  check('en de teller staat nog op de hoogste waarde', naPoging.lastTotpStep === naEerste.lastTotpStep, naPoging)

  // --- Onjuiste codes tellen op tot een blokkade van déze ondertekening ---
  await prisma.recipient.update({ where: { id: ontvanger.id }, data: { reauthAttempts: 0 } })
  for (let i = 0; i < MAX_HERVERIFICATIE_POGINGEN; i++) {
    await herverifieerVoorOndertekenen({ ...basis, code: '000000' })
  }
  const geblokkeerd = await herverifieerVoorOndertekenen({ ...basis, code: huidigeCode(secret) })
  check(
    `na ${MAX_HERVERIFICATIE_POGINGEN} misslagen is de ondertekening geblokkeerd`,
    !geblokkeerd.ok && geblokkeerd.reden === 'geblokkeerd',
    geblokkeerd
  )
  const accountNog = await prisma.accountant.findUniqueOrThrow({
    where: { id: acc.id },
    select: { active: true }
  })
  check('maar het account zelf blijft gewoon actief', accountNog.active === true)

  // --- Zonder 2FA kan er niet worden ondertekend ---
  await prisma.recipient.update({ where: { id: ontvanger.id }, data: { reauthAttempts: 0 } })
  await prisma.accountant.update({ where: { id: acc.id }, data: { totpEnabled: false } })
  const zonder = await herverifieerVoorOndertekenen({ ...basis, code: huidigeCode(secret) })
  check('zonder tweefactorauthenticatie wordt ondertekenen geweigerd', !zonder.ok && zonder.reden === 'geen-2fa', zonder)
  await prisma.accountant.update({ where: { id: acc.id }, data: { totpEnabled: true } })

  // --- Het auditspoor legt beide uitkomsten vast ---
  const geslaagd = await prisma.auditEvent.count({
    where: { dossierId: dossier.id, type: 'HERVERIFICATIE_GESLAAGD' }
  })
  const mislukt = await prisma.auditEvent.count({
    where: { dossierId: dossier.id, type: 'HERVERIFICATIE_MISLUKT' }
  })
  check('geslaagde herverificatie staat in het auditspoor', geslaagd >= 1, geslaagd)
  check('mislukte pogingen staan er ook in', mislukt >= MAX_HERVERIFICATIE_POGINGEN, mislukt)

  // --- verifyTotpStep geeft een bruikbare tijdstap terug ---
  const uitkomst = verifyTotpStep(secret, huidigeCode(secret))
  const verwacht = Math.floor(Date.now() / 1000 / TOTP_PERIODE_SECONDEN)
  check('verifyTotpStep geeft de huidige tijdstap', uitkomst.ok && Math.abs((uitkomst.step ?? 0) - verwacht) <= 1, uitkomst)
  check('een onzinnige code geeft geen tijdstap', !verifyTotpStep(secret, '123456' === huidigeCode(secret) ? '654321' : '123456').ok)

  // --- C.5: de instemmingstekst verschilt per rol ---
  const clientTekst = consentTextVoor('EXTERN')
  const kantoorTekst = consentTextVoor('ZELF')
  const jaarrekeningTekst = consentTextVoor('ZELF', 'JAARREKENING')
  check('cliënt en kantoor lezen niet dezelfde verklaring', clientTekst !== kantoorTekst)
  check('de cliënt verklaart akkoord met de inhoud', clientTekst.includes('akkoord met de inhoud'))
  check('de accountant tekent namens het kantoor', kantoorTekst.includes('namens Otto Visser & Partners'))
  check('bij een jaarrekening staat dat hij in het stuk zelf tekent', jaarrekeningTekst.includes('in deze jaarrekening'))
  check('de verklaringen hebben verschillende hashes', consentHash(clientTekst) !== consentHash(kantoorTekst))

  // --- D: het downloadtoken is gescheiden van het tekentoken ---
  const tekenToken = generateSigningToken()
  const downloadToken = generateSigningToken()
  const extern = await prisma.recipient.create({
    data: {
      dossierId: dossier.id,
      role: 'EXTERN',
      name: 'K. Lient',
      email: 'client@example.nl',
      order: 1,
      tokenHash: tekenToken.hash,
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      downloadTokenHash: downloadToken.hash,
      downloadTokenExpiresAt: new Date(Date.now() + 90 * 24 * 3600_000)
    }
  })

  const viaDownload = await prisma.recipient.findUnique({
    where: { downloadTokenHash: hashSigningToken(downloadToken.raw) },
    select: { id: true }
  })
  check('het downloadtoken vindt de juiste ontvanger', viaDownload?.id === extern.id)

  // De kern van D.1: het downloadtoken mag niet als tekentoken werken.
  const alsTekentoken = await prisma.recipient.findUnique({
    where: { tokenHash: hashSigningToken(downloadToken.raw) },
    select: { id: true }
  })
  check('het downloadtoken werkt NIET als tekentoken', alsTekentoken === null)
  const alsDownloadtoken = await prisma.recipient.findUnique({
    where: { downloadTokenHash: hashSigningToken(tekenToken.raw) },
    select: { id: true }
  })
  check('en het tekentoken werkt NIET als downloadtoken', alsDownloadtoken === null)

  check('alleen de hash staat in de database, niet het token zelf', downloadToken.hash !== downloadToken.raw)

  // Verlopen downloadtoken.
  await prisma.recipient.update({
    where: { id: extern.id },
    data: { downloadTokenExpiresAt: new Date(Date.now() - 1000) }
  })
  const verlopen = await prisma.recipient.findUniqueOrThrow({
    where: { id: extern.id },
    select: { downloadTokenExpiresAt: true }
  })
  check('een verlopen downloadtoken is als verlopen herkenbaar', (verlopen.downloadTokenExpiresAt?.getTime() ?? 0) < Date.now())

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
