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

// --- 4. Zijn de sleutelversies in deze back-up allemaal beschikbaar? ---
//
// Dit is de controle die de rest waardeloos maakt als hij ontbreekt. Een restore
// van drie jaar oud is versleuteld met de sleutel van toen. Staat die niet meer in
// de omgeving, dan komt er wel een database uit de back-up maar geen leesbaar
// document — en dat merk je nu pas terwijl een cliënt wacht.
console.log('\nSleutelversies')
{
  const store = storage()
  const alle = await prisma.document.findMany({
    select: { fileName: true, originalKey: true, workingKey: true, preSealKey: true, postQualifiedKey: true, sealedKey: true }
  })
  const perVersie = new Map<number, { totaal: number; leesbaar: number; voorbeeld: string }>()
  let onbekend = 0
  for (const doc of alle) {
    const keys = [doc.originalKey, doc.workingKey, doc.preSealKey, doc.postQualifiedKey, doc.sealedKey].filter(
      (k): k is string => !!k
    )
    for (const key of keys) {
      if (!store.keyVersionOf) {
        console.log('  (deze opslagdriver kan de sleutelversie niet lezen; overgeslagen)')
        break
      }
      let versie: number
      try {
        versie = await store.keyVersionOf(key)
      } catch {
        onbekend += 1
        continue
      }
      const entry = perVersie.get(versie) ?? { totaal: 0, leesbaar: 0, voorbeeld: doc.fileName }
      entry.totaal += 1
      // Eén keer per versie echt proberen te ontsleutelen; meer is verspilling.
      if (entry.leesbaar === 0) {
        try {
          await store.get(key)
          entry.leesbaar = 1
        } catch {
          entry.leesbaar = 0
        }
      }
      perVersie.set(versie, entry)
    }
  }
  if (perVersie.size === 0) {
    console.log('  (geen bestanden in deze back-up)')
  }
  for (const [versie, e] of [...perVersie.entries()].sort((a, b) => a[0] - b[0])) {
    if (e.leesbaar === 1) {
      ok(`sleutelversie ${versie}: ${e.totaal} bestand(en), sleutel aanwezig en werkend`)
    } else {
      bad(
        `sleutelversie ${versie}: ${e.totaal} bestand(en), maar die sleutel ontbreekt of werkt niet ` +
          `(zet STORAGE_ENCRYPTION_KEY${versie === 1 ? '' : `_V${versie}`} terug uit de sleutelkluis)`
      )
    }
  }
  if (onbekend > 0) bad(`${onbekend} bestand(en) waarvan de sleutelversie niet te lezen is`)
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
