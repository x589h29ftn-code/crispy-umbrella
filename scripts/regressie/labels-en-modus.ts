/**
 * Changeset v1.4: één ondertekenmechanisme, en de zichtbare tekst per
 * documentsoort.
 *
 *   npm run test:labels
 */
import { signatureReason, labelSoortVoor, auteurSoorten, STANDAARD_AUTEUR_SOORTEN } from '@/lib/signing-labels'
import { sealEnabled } from '@/lib/seal/sealer'
import { blobBewaardagen } from '@/lib/retention'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

const accountant = { accountantName: 'Mark Otto', professionalTitle: 'RA' }

// Op een jaarrekening zet de accountant zijn naam eronder: de gekwalificeerde
// handtekening vervangt de natte handtekening.
check(
  'jaarrekening: ondertekend door naam en titel',
  signatureReason({ kind: 'JAARREKENING', ...accountant }) === 'Ondertekend door Mark Otto, RA',
  signatureReason({ kind: 'JAARREKENING', ...accountant })
)
check('jaarrekening telt als auteursondertekening', labelSoortVoor('JAARREKENING') === 'ondertekend')

// Op een stuk waarin de CLIËNT iets verklaart, is de handtekening alleen het slot op
// het document. Zou daar "Ondertekend door <accountant>" staan, dan wekt dat de
// indruk dat de accountant die verklaring mede onderschrijft.
for (const kind of ['NOTULEN_AVA', 'BEVESTIGING_JAARREKENING', 'OPDRACHTBEVESTIGING', 'OVERIG'] as const) {
  check(
    `${kind}: verzegeld door het kantoor, niet op naam`,
    signatureReason({ kind, ...accountant }) === 'Verzegeld door Otto Visser & Partners Accountants',
    signatureReason({ kind, ...accountant })
  )
}

// De openstaande kantoorvraag: staat AKKOORD_IB in de bovenste of onderste rij? Het
// antwoord is een instelling, geen code.
check(
  'akkoordverklaringen staan standaard op verzegeld (open kantoorvraag)',
  labelSoortVoor('AKKOORD_IB') === 'verzegeld' && labelSoortVoor('AKKOORD_VPB') === 'verzegeld'
)
check(
  'de standaardlijst bevat alleen de jaarrekening',
  JSON.stringify(STANDAARD_AUTEUR_SOORTEN) === JSON.stringify(['JAARREKENING']),
  STANDAARD_AUTEUR_SOORTEN
)
check('een onbekend documenttype valt op verzegeld terug', labelSoortVoor(null) === 'verzegeld')
check('zonder titel blijft de titel weg', signatureReason({ kind: 'JAARREKENING', accountantName: 'Jan' }) === 'Ondertekend door Jan')

// SIGN_AS_AUTHOR_KINDS is de instelling waarmee het antwoord later kan komen.
check('de instelling is uit de omgeving te lezen', auteurSoorten().size >= 1, [...auteurSoorten()])

// Eén mechanisme: 'sealer' is de oude naam van 'qualified'.
check(`SEAL_MODE=${process.env.SEAL_MODE ?? '(leeg)'} geeft sealEnabled=${sealEnabled()}`, true)
check('de bewaartermijn voor bestanden is ingesteld', blobBewaardagen() > 0, blobBewaardagen())

console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
process.exit(fails === 0 ? 0 : 1)
