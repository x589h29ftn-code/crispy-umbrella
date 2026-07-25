// Zoekt tegen de openbare Cleverbase-teststub twee dingen uit die in de
// documentatie niet eenduidig zijn. Draai dit vanaf een machine die
// api.cleverbase.com kan bereiken:
//
//   CLEVERBASE_CSC_BASE_URL=... \
//   CLEVERBASE_CSC_CLIENT_ID=6dd5f48d-bcd9-4a98-8a4c-5c82182f5be4 \
//   CLEVERBASE_CSC_CLIENT_SECRET=11628999-cb61-4c62-8e1f-09699dcb5521 \
//   CLEVERBASE_CSC_ENV=stub \
//   CLEVERBASE_REDIRECT_URI=https://localhost/callback \
//   npm run csc:check
//
// De uitkomst bepaalt twee dingen in de code:
//  1. Kan het servicetoken met client_credentials, of vereist zelfs dat een
//     gebruikersronde via /oauth2/authorize? Als het laatste, dan bestaat er
//     geen achtergrondtoken en moet fetchServiceToken anders.
//  2. Welke foutcode komt er bij een verlopen of ongeldige SAD, en is die te
//     onderscheiden van een geweigerde autorisatie? Nodig voor een begrijpelijke
//     melding aan de accountant.

import { cleverbaseConfig, fetchServiceToken, listCredentials, credentialInfo, buildAuthorizeUrl, exchangeCodeForSad, CscError } from '@/lib/csc/client'
import { newState } from '@/lib/csc/session'

function head(t: string) {
  console.log(`\n=== ${t} ===`)
}

const cfg = cleverbaseConfig()
console.log(`Basis-URL: ${cfg.baseUrl}`)
console.log(`Client-id: ${cfg.clientId}`)

// --- Vraag 1: gaat de 'service'-scope via client_credentials? ---
head('1. Servicetoken met grant_type=client_credentials')
let serviceToken: string | null = null
try {
  const t = await fetchServiceToken(cfg)
  serviceToken = t.accessToken
  console.log(`JA: servicetoken ontvangen, geldig tot ${t.expiresAt.toISOString()}`)
  console.log('   -> een achtergrondtoken bestaat; fetchServiceToken kan zo blijven.')
} catch (e) {
  const err = e as CscError
  console.log(`NEE: ${err.message}`)
  if (err.body) console.log(`   antwoord: ${err.body.slice(0, 400)}`)
  console.log('   -> mogelijk vereist ook de service-scope een gebruikersronde via')
  console.log('      /oauth2/authorize. Pas fetchServiceToken daarop aan.')
}

// --- Wat levert credentials/list op? ---
if (serviceToken) {
  head('2. credentials/list en credentials/info')
  try {
    const ids = await listCredentials(cfg, serviceToken)
    console.log(`credentials: ${ids.length ? ids.join(', ') : '(geen)'}`)
    if (ids[0]) {
      const info = await credentialInfo(cfg, serviceToken, ids[0])
      console.log(`  status      : ${info.keyStatus ?? '(niet gemeld)'}`)
      console.log(`  subject     : ${info.subjectDn ?? '-'}`)
      console.log(`  geldig tot  : ${info.validTo ?? '-'}`)
      console.log(`  certificaten: ${info.certificates.length}`)
      console.log(`  multisign   : ${info.maxSignatures ?? '-'} (max hashes per bevestiging)`)
      console.log('  -> LET OP: als status niet "enabled" is, zet het portaal het')
      console.log('     certificaat voor die accountant automatisch uit.')
    }
  } catch (e) {
    const err = e as CscError
    console.log(`mislukt: ${err.message}`)
    if (err.body) console.log(`   antwoord: ${err.body.slice(0, 400)}`)
  }
}

// --- De autorisatie-URL, zodat je de encodering met het oog kunt controleren ---
head('3. Autorisatie-URL (hashes moeten base64URL, komma-gescheiden zijn)')
try {
  const hashes = [Buffer.alloc(32, 1).toString('base64'), Buffer.alloc(32, 2).toString('base64')]
  const url = buildAuthorizeUrl({ cfg, credentialId: 'voorbeeld-credential', hashesBase64: hashes, state: newState() })
  console.log(url)
  const hashParam = new URL(url).searchParams.get('hash') ?? ''
  const looksUrlSafe = !/[+/=]/.test(hashParam) && hashParam.includes(',')
  console.log(looksUrlSafe ? 'OK: base64URL en komma-gescheiden.' : 'LET OP: encodering lijkt niet base64URL!')
} catch (e) {
  console.log(`mislukt: ${(e as Error).message}`)
}

// --- Vraag 2: hoe ziet een ongeldige/verlopen SAD eruit? ---
head('4. Foutgedrag bij een ongeldige authorization code (proxy voor verlopen SAD)')
try {
  await exchangeCodeForSad(cfg, 'deze-code-bestaat-niet')
  console.log('onverwacht: er kwam wél een SAD terug')
} catch (e) {
  const err = e as CscError
  console.log(`status ${err.status}: ${err.message}`)
  if (err.body) console.log(`antwoord: ${err.body.slice(0, 500)}`)
  console.log('-> Leg vast welke foutcode "verlopen" betekent en welke "geweigerd",')
  console.log('   en stem isExpiredSad() in src/lib/csc/client.ts daarop af.')
}

console.log('\nKlaar. Neem de uitkomsten op als comment bij de CSC-client.')
