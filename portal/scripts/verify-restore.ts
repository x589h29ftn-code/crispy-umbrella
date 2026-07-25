// Controleert of een terugzetting écht bruikbaar is. Wordt aangeroepen door
// scripts/restore-test.sh, maar is ook los te draaien tegen een testomgeving.
//
// Een restore die "gelukt" lijkt omdat pg_restore geen fout gaf, zegt weinig. De
// vraag is of er nog een ondertekend dossier uit komt waarvan het document te
// ontsleutelen is, de hash klopt en het auditspoor intact is.

import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { sha256Hex, sealEnabled, validatePdf } from '@/lib/seal/sealer'
import { verifyAuditChain } from '@/lib/audit'

let fails = 0
const ok = (l: string) => console.log(`  ok   ${l}`)
const bad = (l: string) => {
  fails += 1
  console.error(`  FOUT ${l}`)
}

console.log('Controle van de teruggezette gegevens')

// --- 1. Staat er iets in de database? ---
const [dossiers, documents, recipients, audits] = await Promise.all([
  prisma.dossier.count(),
  prisma.document.count(),
  prisma.recipient.count(),
  prisma.auditEvent.count()
])
console.log(`\nInhoud: ${dossiers} dossiers, ${documents} documenten, ${recipients} ontvangers, ${audits} auditregels`)
dossiers > 0 ? ok('er staan dossiers in de back-up') : bad('geen enkel dossier teruggezet')
audits > 0 ? ok('er staat een auditspoor in de back-up') : bad('geen auditspoor teruggezet')

// --- 2. Is het auditspoor intact? ---
console.log('\nAuditspoor')
const chain = await verifyAuditChain()
chain.ok
  ? ok(`hashketen intact (${chain.checked} regels in ${chain.chains} ketens)`)
  : bad(`hashketen gebroken bij ${chain.brokenAt?.id} (${chain.brokenAt?.reason})`)

// --- 3. Zijn de documenten te ontsleutelen en klopt de hash? ---
console.log('\nAfgeronde documenten')
const sealed = await prisma.document.findMany({
  where: { sealedKey: { not: null }, sealedSha256: { not: null } },
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { id: true, title: true, fileName: true, sealedKey: true, sealedSha256: true }
})

if (sealed.length === 0) {
  console.log('  (geen verzegelde documenten in deze back-up; sla de inhoudelijke controle over)')
} else {
  const store = storage()
  for (const doc of sealed) {
    let bytes: Buffer
    try {
      bytes = Buffer.from(await store.get(doc.sealedKey!))
    } catch (e) {
      bad(`${doc.fileName}: niet te ontsleutelen — ${(e as Error).message}`)
      continue
    }
    // Hash uit de database opnieuw berekenen: bewijst dat het bestand ongewijzigd
    // uit de back-up komt en dat de opslagsleutel de juiste is.
    const actual = sha256Hex(bytes)
    if (actual !== doc.sealedSha256) {
      bad(`${doc.fileName}: hash wijkt af van wat er is vastgelegd`)
      continue
    }
    // Is het nog een leesbare PDF?
    const isPdf = bytes.subarray(0, 5).toString() === '%PDF-'
    if (!isPdf) {
      bad(`${doc.fileName}: geen leesbare PDF na ontsleutelen`)
      continue
    }
    ok(`${doc.fileName}: ontsleuteld, hash klopt, geldige PDF (${Math.round(bytes.length / 1024)} kB)`)

    // Staat er een digitaal zegel in, dan controleren of dat nog valideert.
    if (sealEnabled()) {
      try {
        const res = await validatePdf(bytes)
        if (!res.signed) {
          console.log(`       (geen digitaal zegel in dit document)`)
        } else if (res.signatures.every((s) => s.intact && s.valid)) {
          ok(`${doc.fileName}: digitaal zegel is nog geldig na terugzetten`)
        } else {
          bad(`${doc.fileName}: digitaal zegel valideert NIET meer`)
        }
      } catch (e) {
        console.log(`       (zegel niet te controleren: ${(e as Error).message})`)
      }
    }
  }
}

// --- Uitkomst ---
console.log()
if (fails === 0) {
  console.log('UITKOMST: de terugzetting is bruikbaar.')
} else {
  console.error(`UITKOMST: ${fails} probleem(en). Deze back-up is NIET betrouwbaar.`)
}
console.log('Leg datum, uitvoerder en uitkomst vast in het kwaliteitshandboek.')

await prisma.$disconnect()
process.exit(fails === 0 ? 0 : 1)
