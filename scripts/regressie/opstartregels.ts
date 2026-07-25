/**
 * De harde weigeringen bij opstarten. Deze regels bestaan om te voorkomen dat het
 * portaal in productie draait met een teststub of zonder verzegeling, en horen
 * daarom zelf gecontroleerd te zijn.
 *
 *   npm run test:opstart
 */
import { assertSealingChoiceIsDeliberate, assertNoStubInProduction, CLEVERBASE_STUB_CLIENT_ID } from '@/env'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

function throws(fn: () => void): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

check(
  'ontwikkelomgeving met verzegeling uit mag starten',
  !throws(() => assertSealingChoiceIsDeliberate({ NODE_ENV: 'development', SEAL_MODE: 'none', ALLOW_UNSEALED: false }))
)
check(
  'productie met verzegeling uit weigert te starten zonder tweede vlag',
  throws(() => assertSealingChoiceIsDeliberate({ NODE_ENV: 'production', SEAL_MODE: 'none', ALLOW_UNSEALED: false }))
)
check(
  'productie met verzegeling uit mag starten als het bewust is bevestigd',
  !throws(() => assertSealingChoiceIsDeliberate({ NODE_ENV: 'production', SEAL_MODE: 'none', ALLOW_UNSEALED: true }))
)
check(
  'productie met verzegeling aan mag starten',
  !throws(() => assertSealingChoiceIsDeliberate({ NODE_ENV: 'production', SEAL_MODE: 'sealer', ALLOW_UNSEALED: false }))
)
check(
  'de teststub-omgeving weigert in productie',
  throws(() => assertNoStubInProduction({ NODE_ENV: 'production', CLEVERBASE_CSC_ENV: 'stub' }))
)
check(
  'het openbare stub-clientid weigert in productie, ook met witruimte eromheen',
  throws(() =>
    assertNoStubInProduction({
      NODE_ENV: 'production',
      CLEVERBASE_CSC_ENV: 'production',
      CLEVERBASE_CSC_CLIENT_ID: `  ${CLEVERBASE_STUB_CLIENT_ID}\n`
    })
  )
)
check(
  'eigen clientgegevens mogen in productie',
  !throws(() =>
    assertNoStubInProduction({
      NODE_ENV: 'production',
      CLEVERBASE_CSC_ENV: 'production',
      CLEVERBASE_CSC_CLIENT_ID: 'eigen-client-id'
    })
  )
)

console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
process.exit(fails === 0 ? 0 : 1)
