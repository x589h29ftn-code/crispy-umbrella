import 'server-only'
import { env } from '@/env'
import { AUTH_MODE, HASH_ALGO_SHA256, SIGN_ALGO_RSA, authorizeHashParam } from './encoding'

// Gedeelde client voor de Cloud Signature Consortium API v1. Zowel het
// organisatiezegel als het beroepscertificaat lopen hierlangs, en zowel
// Digidentity als Cleverbase spreken v1. (Er is een v2.2-bèta; die gebruiken we
// bewust niet — pyHanko en Digidentity zitten op v1.)
//
// Twee scopes, strikt gescheiden en nooit door elkaar te gebruiken:
//
//   service     -> Bearer-token, 3600 s. Voor credentials/list, credentials/info
//                  en de Authorization-header op signHash.
//   credential  -> SAD-token,    300 s. Voor het feitelijke ondertekenen.
//
// De 'credential'-scope vereist bij Cleverbase een gebruikersronde: de accountant
// bevestigt in de app met een pincode. Daarom levert deze client een
// autorisatie-URL op in plaats van zelf te tekenen.

export class CscError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Tijdelijke problemen mogen opnieuw; een geweigerde autorisatie niet. */
    readonly retryable: boolean,
    readonly body?: string
  ) {
    super(message)
  }
}

export interface CscConfig {
  baseUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
}

/** Leest de Cleverbase-configuratie en klaagt duidelijk als er iets mist. */
export function cleverbaseConfig(): CscConfig {
  const baseUrl = env.CLEVERBASE_CSC_BASE_URL
  const clientId = env.CLEVERBASE_CSC_CLIENT_ID
  const clientSecret = env.CLEVERBASE_CSC_CLIENT_SECRET
  const redirectUri = env.CLEVERBASE_REDIRECT_URI
  const missing = [
    !baseUrl && 'CLEVERBASE_CSC_BASE_URL',
    !clientId && 'CLEVERBASE_CSC_CLIENT_ID',
    !clientSecret && 'CLEVERBASE_CSC_CLIENT_SECRET',
    !redirectUri && 'CLEVERBASE_REDIRECT_URI'
  ].filter(Boolean)
  if (missing.length) throw new CscError(`Cleverbase-configuratie mist: ${missing.join(', ')}`, 0, false)
  if (!env.CLEVERBASE_CSC_ENV) {
    throw new CscError('CLEVERBASE_CSC_ENV is leeg: kies "stub" (alleen buiten productie) of "production".', 0, false)
  }
  return {
    baseUrl: baseUrl!.replace(/\/+$/, ''),
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!
  }
}

function basicAuth(cfg: CscConfig): string {
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`
}

async function postForm(
  url: string,
  cfg: CscConfig,
  body: URLSearchParams,
  timeoutMs = 20000
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: basicAuth(cfg), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    })
  } catch (e) {
    throw new CscError(`Cleverbase niet bereikbaar: ${(e as Error).message}`, 0, true)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) {
    // 5xx en timeouts zijn tijdelijk; 4xx is een geweigerde of verlopen autorisatie.
    throw new CscError(`token-aanvraag mislukt (${res.status})`, res.status, res.status >= 500, text.slice(0, 500))
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new CscError('onverwacht antwoord van Cleverbase (geen JSON)', res.status, false, text.slice(0, 300))
  }
}

async function postJson(
  url: string,
  bearer: string,
  payload: unknown,
  timeoutMs = 30000
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
  } catch (e) {
    throw new CscError(`Cleverbase niet bereikbaar: ${(e as Error).message}`, 0, true)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) {
    throw new CscError(`CSC-aanroep mislukt (${res.status})`, res.status, res.status >= 500, text.slice(0, 500))
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new CscError('onverwacht antwoord van Cleverbase (geen JSON)', res.status, false, text.slice(0, 300))
  }
}

export interface ServiceToken {
  accessToken: string
  expiresAt: Date
}

/**
 * Haalt een servicetoken (scope 'service') op.
 *
 * LET OP — empirisch te bevestigen tegen de stub: de documentatie is er niet
 * eenduidig over of de 'service'-scope óók via /oauth2/authorize moet. De
 * parametertabel stelt dat grant_type altijd 'authorization_code' is; als dat
 * klopt, vereist zelfs het servicetoken een gebruikersronde en bestaat er geen
 * achtergrondtoken. Zie scripts/csc-stub-check.ts, dat dit uitzoekt en de
 * uitkomst rapporteert.
 */
export async function fetchServiceToken(cfg: CscConfig): Promise<ServiceToken> {
  const json = await postForm(`${cfg.baseUrl}/oauth2/token`, cfg, new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'service'
  }))
  const token = json.access_token
  if (typeof token !== 'string') {
    throw new CscError('servicetoken ontbreekt in het antwoord', 200, false, JSON.stringify(json).slice(0, 300))
  }
  const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return { accessToken: token, expiresAt: new Date(Date.now() + ttl * 1000) }
}

export interface CredentialInfo {
  credentialId: string
  /** Status van de sleutel bij de provider, bijv. 'enabled' of 'disabled'. */
  keyStatus: string | null
  certificates: string[] // base64-DER, de keten die pyHanko nodig heeft
  subjectDn: string | null
  validTo: string | null
  maxSignatures: number | null
}

/** Alle credentials van de ingelogde/gekoppelde gebruiker. */
export async function listCredentials(cfg: CscConfig, serviceToken: string): Promise<string[]> {
  const json = await postJson(`${cfg.baseUrl}/csc/v1/credentials/list`, serviceToken, {})
  const ids = json.credentialIDs
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
}

/** Certificaatketen en status van één credential. */
export async function credentialInfo(
  cfg: CscConfig,
  serviceToken: string,
  credentialId: string
): Promise<CredentialInfo> {
  const json = await postJson(`${cfg.baseUrl}/csc/v1/credentials/info`, serviceToken, {
    credentialID: credentialId,
    certificates: 'chain',
    certInfo: true,
    authInfo: true
  })
  const key = (json.key ?? {}) as Record<string, unknown>
  const cert = (json.cert ?? {}) as Record<string, unknown>
  const certs = Array.isArray(cert.certificates)
    ? (cert.certificates as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return {
    credentialId,
    keyStatus: typeof key.status === 'string' ? key.status : null,
    certificates: certs,
    subjectDn: typeof cert.subjectDN === 'string' ? cert.subjectDN : null,
    validTo: typeof cert.validTo === 'string' ? cert.validTo : null,
    maxSignatures: typeof json.multisign === 'number' ? json.multisign : null
  }
}

/**
 * Bouwt de URL waar de accountant naartoe wordt gestuurd om te bevestigen.
 * De hashes gaan hier als base64URL, komma-gescheiden — anders dan bij signHash.
 */
export function buildAuthorizeUrl(input: {
  cfg: CscConfig
  credentialId: string
  hashesBase64: string[]
  state: string
}): string {
  const { cfg, credentialId, hashesBase64, state } = input
  if (hashesBase64.length === 0) throw new CscError('geen hashes om te ondertekenen', 0, false)
  if (hashesBase64.length > env.CLEVERBASE_MAX_BATCH) {
    throw new CscError(
      `te veel documenten in één bevestiging (${hashesBase64.length}, maximum ${env.CLEVERBASE_MAX_BATCH})`,
      0,
      false
    )
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: 'credential',
    credentialID: credentialId,
    numSignatures: String(hashesBase64.length),
    hash: authorizeHashParam(hashesBase64),
    hashAlgo: HASH_ALGO_SHA256,
    authMode: AUTH_MODE,
    state
  })
  return `${cfg.baseUrl}/oauth2/authorize?${params.toString()}`
}

export interface SadToken {
  sad: string
  expiresAt: Date
}

/** Wisselt de authorization code in voor een SAD (leeft ~300 s). */
export async function exchangeCodeForSad(cfg: CscConfig, code: string): Promise<SadToken> {
  const json = await postForm(`${cfg.baseUrl}/oauth2/token`, cfg, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri
  }))
  // Cleverbase geeft token_type: SAD terug; het veld heet access_token.
  const sad = json.access_token ?? json.SAD
  if (typeof sad !== 'string') {
    throw new CscError('SAD ontbreekt in het antwoord', 200, false, JSON.stringify(json).slice(0, 300))
  }
  const ttl = typeof json.expires_in === 'number' ? json.expires_in : 300
  return { sad, expiresAt: new Date(Date.now() + ttl * 1000) }
}

/**
 * Laat de provider de hashes ondertekenen. De handtekeningen komen terug in
 * dezelfde volgorde als de ingestuurde hashes — die volgorde is dus bindend.
 * Hier gewone base64, niet base64url.
 */
export async function signHashes(input: {
  cfg: CscConfig
  serviceToken: string
  sad: string
  credentialId: string
  hashesBase64: string[]
}): Promise<string[]> {
  const { cfg, serviceToken, sad, credentialId, hashesBase64 } = input
  const json = await postJson(`${cfg.baseUrl}/csc/v1/signatures/signHash`, serviceToken, {
    credentialID: credentialId,
    SAD: sad,
    hash: hashesBase64,
    hashAlgo: HASH_ALGO_SHA256,
    signAlgo: SIGN_ALGO_RSA
  })
  const sigs = json.signatures
  if (!Array.isArray(sigs) || sigs.length !== hashesBase64.length) {
    throw new CscError(
      `verwachtte ${hashesBase64.length} handtekening(en), kreeg ${Array.isArray(sigs) ? sigs.length : 0}`,
      200,
      false
    )
  }
  return sigs.map(String)
}

/**
 * De hashes wijken af van wat er is geautoriseerd. Dat is een programmeerfout en
 * geen storing: opnieuw proberen maskeert hem alleen. Sessie op FAILED, melden.
 */
export class CscHashMismatchError extends Error {
  readonly permanent = true as const
}

/** Is dit een verlopen SAD (opnieuw beginnen) of een geweigerde autorisatie? */
export function isExpiredSad(e: unknown): boolean {
  if (!(e instanceof CscError)) return false
  const body = (e.body ?? '').toLowerCase()
  return body.includes('expired') || body.includes('sad')
}
