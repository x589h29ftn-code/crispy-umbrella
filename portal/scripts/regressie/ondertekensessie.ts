/**
 * Punt 4 uit changeset v1.2: de uitkomst van signHash wordt versleuteld bewaard
 * en direct na injectie gewist, en de hashes die naar de autorisatie gingen zijn
 * later nog te controleren.
 */
import { prisma } from '@/lib/db'
import { resolveSession, storeSignatureValues, clearSignatureValues } from '@/lib/csc/session'
import { stringKeyVersion } from '@/lib/storage/crypto'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

async function main() {
  const acc = await prisma.accountant.upsert({
    where: { email: 'csc@ottovisseraccountants.nl' },
    update: {},
    create: { email: 'csc@ottovisseraccountants.nl', name: 'CSC Tester', passwordHash: 'x', role: 'BEHEERDER' }
  })

  await prisma.cscSigningSession.deleteMany({ where: { accountantId: acc.id } })

  const hashes = ['aGFzaC1lZW4=', 'aGFzaC10d2Vl']
  const sessie = await prisma.cscSigningSession.create({
    data: {
      accountantId: acc.id,
      state: 'teststate-regressie-' + acc.id,
      credentialId: 'cred-test',
      documentIds: ['doc-1', 'doc-2'],
      hashes: { 'doc-1': hashes[0], 'doc-2': hashes[1] },
      sentHashes: hashes,
      preparedKeys: {},
      expiresAt: new Date(Date.now() + 900_000),
      status: 'PREPARED'
    }
  })

  const signatures = ['c2lnLWVlbg==', 'c2lnLXR3ZWU=']
  await storeSignatureValues(sessie.id, signatures)

  // Ruwe kolom: hier mag de handtekening NIET leesbaar staan.
  const ruw = await prisma.cscSigningSession.findUniqueOrThrow({
    where: { id: sessie.id },
    select: { signatureValues: true }
  })
  const ruwText = JSON.stringify(ruw.signatureValues)
  check('handtekeningwaarde staat versleuteld in de database', !ruwText.includes(signatures[0]), ruwText.slice(0, 160))
  const versies = (ruw.signatureValues as string[]).map((v) => stringKeyVersion(v))
  check('de sleutelversie is uit de waarde zelf te lezen', versies.every((v) => v >= 1), versies)

  const res = await resolveSession(sessie.state, acc.id)
  const geladen = res.ok ? res.session : null
  check('sessie is met de juiste eigenaar op te halen', res.ok, res)
  check(
    'na laden zijn de handtekeningen weer bruikbaar',
    JSON.stringify(geladen?.signatureValues) === JSON.stringify(signatures),
    geladen?.signatureValues
  )
  check(
    'de verstuurde hashes zijn later nog te controleren',
    JSON.stringify(geladen?.sentHashes) === JSON.stringify(hashes),
    geladen?.sentHashes
  )
  // IDOR: de sessie van een ander mag niet op te halen zijn.
  const vreemd = await resolveSession(sessie.state, 'iemand-anders')
  check(
    'sessie van een andere accountant wordt geweigerd',
    !vreemd.ok && vreemd.reason === 'geen-eigenaar',
    vreemd
  )

  await clearSignatureValues(sessie.id)
  const na = await prisma.cscSigningSession.findUniqueOrThrow({
    where: { id: sessie.id },
    select: { signatureValues: true }
  })
  check('wissen laat niets achter', na.signatureValues === null, na.signatureValues)

  const naRes = await resolveSession(sessie.state, acc.id)
  check(
    'een gewiste sessie levert geen handtekeningen meer',
    naRes.ok && naRes.session.signatureValues === null,
    naRes
  )

  await prisma.cscSigningSession.delete({ where: { id: sessie.id } })
  console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
  await prisma.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
