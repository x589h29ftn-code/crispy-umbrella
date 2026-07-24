import 'server-only'
import { createHash } from 'node:crypto'
import { env } from '@/env'
import type { ProfessionalSigner, ProfessionalSignInput } from './index'

// Digidentity-driver voor gekwalificeerd ondertekenen (PKIoverheid-beroeps-
// certificaat in de cloud) via de Cloud Signature Consortium (CSC) v1-API.
//
// Stroom (conform Digidentity's REST-documentatie):
//   1. OAuth2 client-credentials -> access token.
//   2. credentials/info -> certificaatketen voor de credential-id ophalen.
//   3. Lokaal de te ondertekenen hash van de PDF bepalen (document blijft hier).
//   4. signatures/signHash -> Digidentity zet de gekwalificeerde handtekening
//      over de hash (bij AutoSign zonder appbevestiging; anders bevestigt de
//      accountant in de Digidentity-app).
//   5. De ontvangen PKCS#7/CMS-handtekening in de PDF invoegen (PAdES).
//
// Alleen de HASH verlaat de server, nooit het document zelf.
//
// LET OP: stappen 1-4 zijn hier geïmplementeerd tegen de gedocumenteerde
// endpoints, maar zijn pas te valideren met echte (pre-productie) toegang.
// Stap 5 (PAdES-byte-embedding) wordt gefinaliseerd zodra er een testcertificaat
// is; tot die tijd werpt hij een duidelijke fout. Deze driver wordt alleen
// bereikt als PROFESSIONAL_SIGNING_DRIVER='digidentity' — standaard 'none'.

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

function baseUrl(): string {
  const u = env.DIGIDENTITY_BASE_URL
  if (!u) throw new Error('DIGIDENTITY_BASE_URL ontbreekt (zet de CSC-basis-URL in .env).')
  return u.replace(/\/+$/, '')
}

/** OAuth2 client-credentials -> access token. */
async function fetchAccessToken(): Promise<string> {
  const clientId = env.DIGIDENTITY_CLIENT_ID
  const clientSecret = env.DIGIDENTITY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('DIGIDENTITY_CLIENT_ID/CLIENT_SECRET ontbreken.')
  }
  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  if (env.DIGIDENTITY_SCOPE) body.set('scope', env.DIGIDENTITY_SCOPE)
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${baseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!res.ok) throw new Error(`OAuth-token mislukt (${res.status})`)
  const json = (await res.json()) as TokenResponse
  if (!json.access_token) throw new Error('OAuth-antwoord zonder access_token')
  return json.access_token
}

/** CSC signatures/signHash: laat de provider de gekwalificeerde handtekening
 * over de opgegeven hash zetten. Geeft de ruwe handtekening (base64) terug. */
async function signHashRemote(
  token: string,
  credentialId: string,
  hashBase64: string
): Promise<string> {
  const res = await fetch(`${baseUrl()}/csc/v1/signatures/signHash`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      credentialID: credentialId,
      hashAlgo: '2.16.840.1.101.3.4.2.1', // SHA-256
      signAlgo: '1.2.840.113549.1.1.11', // sha256WithRSAEncryption
      hash: [hashBase64]
    })
  })
  if (!res.ok) throw new Error(`signHash mislukt (${res.status})`)
  const json = (await res.json()) as { signatures?: string[] }
  const sig = json.signatures?.[0]
  if (!sig) throw new Error('signHash-antwoord zonder handtekening')
  return sig
}

/** SHA-256 (base64) van de te ondertekenen bytes. */
function sha256Base64(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64')
}

export function createDigidentitySigner(): ProfessionalSigner {
  return {
    id: 'digidentity',
    async signPdf(input: ProfessionalSignInput): Promise<Uint8Array> {
      if (!input.signer.credentialId) {
        throw new Error('Accountant heeft geen credential-id voor het beroepscertificaat.')
      }
      const token = await fetchAccessToken()
      // NB: in een volledige PAdES-implementatie bereken je de hash over de
      // /ByteRange van een voorbereide PDF met handtekening-placeholder en voeg
      // je de CMS-handtekening daarna incrementeel toe (zodat een eerdere
      // handtekening geldig blijft). Die byte-embedding finaliseren we met een
      // testcertificaat.
      const hash = sha256Base64(input.pdfBytes)
      await signHashRemote(token, input.signer.credentialId, hash)
      throw new Error(
        'Digidentity: PAdES-embedding nog te finaliseren met een (pre-productie) testcertificaat. ' +
          'OAuth en signHash zijn gereed; het invoegen van de handtekening in de PDF wordt na testtoegang afgerond.'
      )
    }
  }
}
