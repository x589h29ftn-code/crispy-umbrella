// Herversleutelt bestaande data met de huidige sleutelversie.
//
// Rotatie in drie stappen, zonder downtime:
//   1. Voeg de nieuwe sleutel toe als ..._V2 en zet ..._CURRENT=2. Herstart.
//      Nieuwe data gaat vanaf nu met versie 2; oude data blijft leesbaar met V1.
//   2. Draai dit script. Het leest alles met de versie die erin staat en schrijft
//      het terug met de huidige versie.
//   3. Als het script meldt dat er niets meer op de oude versie staat, mag de
//      oude sleutel uit de omgeving. Bewaar hem nog wel in je sleutelkluis tot je
//      back-ups van vóór de rotatie zijn verlopen — die zijn nog met V1 versleuteld.
//
// Draai met:  npm run keys:rotate            (kijk wat er zou gebeuren)
//             npm run keys:rotate -- --apply (voer het uit)

import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { blobKeyVersion, stringKeyVersion, encryptString, decryptString } from '@/lib/storage/crypto'
import { currentStorageKey, currentTotpKey, storageKeys, totpKeys, storageKeyResolver, totpKeyResolver } from '@/lib/storage/keys'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '@/env'

const apply = process.argv.includes('--apply')

function head(t: string) {
  console.log(`\n=== ${t} ===`)
}

const sRing = storageKeys()
const tRing = totpKeys()
console.log(`Documentopslag : versies ${[...sRing.keys.keys()].sort().join(', ')} — huidig ${sRing.current}`)
console.log(`TOTP-secrets   : versies ${[...tRing.keys.keys()].sort().join(', ')} — huidig ${tRing.current}`)
console.log(apply ? '\nMODUS: uitvoeren' : '\nMODUS: alleen tonen (voeg --apply toe om echt te herschrijven)')

// --- Documenten in de opslag ---
head('Documenten')
const documents = await prisma.document.findMany({
  select: { id: true, originalKey: true, workingKey: true, preSealKey: true, sealedKey: true }
})
const store = storage()
const perVersion = new Map<number, number>()
let rewritten = 0
let failed = 0

for (const doc of documents) {
  const fields: (keyof typeof doc)[] = ['originalKey', 'workingKey', 'preSealKey', 'sealedKey']
  for (const field of fields) {
    const key = doc[field]
    if (typeof key !== 'string' || !key) continue
    // De blob zelf vertelt met welke versie hij is versleuteld.
    let version: number
    try {
      const raw = await readFile(join(env.STORAGE_DIR, key))
      version = blobKeyVersion(raw)
    } catch {
      continue // bestand bestaat niet (meer)
    }
    perVersion.set(version, (perVersion.get(version) ?? 0) + 1)
    if (version === sRing.current) continue
    if (!apply) continue
    try {
      // Lezen gebeurt met de versie uit de blob, schrijven met de huidige.
      const bytes = await store.get(key)
      const newKey = await store.put(bytes, key.includes('.') ? key.split('.').pop()! : 'bin')
      await prisma.document.update({ where: { id: doc.id }, data: { [field]: newKey } })
      await store.remove(key).catch(() => {})
      rewritten += 1
    } catch (e) {
      failed += 1
      console.error(`  document ${doc.id}.${String(field)}: ${(e as Error).message}`)
    }
  }
}
for (const [v, n] of [...perVersion.entries()].sort()) {
  console.log(`  versie ${v}: ${n} bestand(en)${v === sRing.current ? ' (huidig)' : ''}`)
}
if (apply) console.log(`  herschreven: ${rewritten}${failed ? `, mislukt: ${failed}` : ''}`)

// --- TOTP-secrets in de database ---
head('TOTP-secrets')
const accountants = await prisma.accountant.findMany({
  where: { totpSecret: { not: null } },
  select: { id: true, email: true, totpSecret: true }
})
const totpPerVersion = new Map<number, number>()
let totpRewritten = 0
for (const a of accountants) {
  if (!a.totpSecret) continue
  const version = stringKeyVersion(a.totpSecret)
  totpPerVersion.set(version, (totpPerVersion.get(version) ?? 0) + 1)
  if (version === tRing.current || !apply) continue
  try {
    const plain = decryptString(totpKeyResolver(), a.totpSecret)
    const { secret, version: cur } = currentTotpKey()
    await prisma.accountant.update({
      where: { id: a.id },
      data: { totpSecret: encryptString(secret, plain, cur) }
    })
    totpRewritten += 1
  } catch (e) {
    console.error(`  ${a.email}: ${(e as Error).message}`)
  }
}
for (const [v, n] of [...totpPerVersion.entries()].sort()) {
  console.log(`  versie ${v}: ${n} secret(s)${v === tRing.current ? ' (huidig)' : ''}`)
}
if (apply) console.log(`  herschreven: ${totpRewritten}`)

// --- Servicetokens in lopende ondertekensessies ---
head('Ondertekensessies')
const sessions = await prisma.cscSigningSession.findMany({
  where: { serviceToken: { not: null }, status: { in: ['PREPARED', 'AUTHORIZING'] } },
  select: { id: true, serviceToken: true }
})
let sessionRewritten = 0
for (const s of sessions) {
  if (!s.serviceToken) continue
  if (stringKeyVersion(s.serviceToken) === sRing.current || !apply) continue
  try {
    const plain = decryptString(storageKeyResolver(), s.serviceToken)
    const { secret, version } = currentStorageKey()
    await prisma.cscSigningSession.update({
      where: { id: s.id },
      data: { serviceToken: encryptString(secret, plain, version) }
    })
    sessionRewritten += 1
  } catch (e) {
    console.error(`  sessie ${s.id}: ${(e as Error).message}`)
  }
}
console.log(`  ${sessions.length} lopende sessie(s)${apply ? `, herschreven: ${sessionRewritten}` : ''}`)

// --- Conclusie ---
head('Conclusie')
const oldDocs = [...perVersion.entries()].filter(([v]) => v !== sRing.current).reduce((n, [, c]) => n + c, 0)
const oldTotp = [...totpPerVersion.entries()].filter(([v]) => v !== tRing.current).reduce((n, [, c]) => n + c, 0)
if (!apply) {
  console.log(`Zou herschrijven: ${oldDocs} bestand(en) en ${oldTotp} TOTP-secret(s).`)
  console.log('Draai opnieuw met --apply om het uit te voeren.')
} else if (oldDocs - rewritten <= 0 && oldTotp - totpRewritten <= 0 && failed === 0) {
  console.log('Alles staat nu op de huidige sleutelversie.')
  console.log('De oude sleutel mag uit de omgeving — bewaar hem nog wel zolang er')
  console.log('back-ups van vóór de rotatie bestaan, die zijn er nog mee versleuteld.')
} else {
  console.log('Er staat nog data op een oude versie. Laat de oude sleutel staan en kijk')
  console.log('naar de foutmeldingen hierboven.')
}

await prisma.$disconnect()
