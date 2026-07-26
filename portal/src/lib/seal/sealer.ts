import 'server-only'
import { createHash } from 'node:crypto'
import { env } from '@/env'

// Client naar de sealer-sidecar (pyHanko). Het onderscheid tussen wél en niet
// opnieuw te proberen is hier belangrijk: een onbereikbare signing-API of TSA is
// tijdelijk (502 -> job opnieuw inplannen), een kapotte of al ondertekende PDF
// niet (400 -> niet opnieuw proberen).

export class SealRetryableError extends Error {
  readonly retryable = true as const
}
export class SealPermanentError extends Error {
  readonly retryable = false as const
}

export interface SealAppearanceBox {
  page: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * Certificeringsniveau van de handtekening (DocMDP).
 *
 * - `none`       gewone approval signature, geen DocMDP
 * - `no_changes` P=1 — route A. Het organisatiezegel is de eerste en enige
 *                handtekening en zet het document helemaal dicht.
 * - `fill_forms` P=2 — route B. Laat alleen het invullen van een bestaand leeg
 *                handtekeningveld toe, voor het beroepscertificaat.
 */
export type CertifyLevel = 'none' | 'no_changes' | 'fill_forms'

export interface SealRequest {
  pdfBytes: Uint8Array
  reason?: string
  location?: string
  fieldName?: string
  appearanceText?: string
  appearanceBox?: SealAppearanceBox | null
  certify?: CertifyLevel
}

export interface SealResult {
  sealedBytes: Buffer
  sealedSha256: string
  /** Tijd uit de TSA: dit is de bewijstijd (niet de serverklok). */
  timestampedAt: Date | null
  certSerial: string | null
  tsaUrl: string | null
  driver: string | null
}

/**
 * De sealer meldde dat dit veld al is ondertekend. Geen fout: het document was
 * al verzegeld, alleen de database wist dat nog niet (bijvoorbeeld doordat het
 * proces omviel tussen het wegschrijven van de bytes en het committen van de rij).
 * De aanroeper haalt de administratie in en verzegelt niet opnieuw.
 */
export class AlreadySealedError extends Error {
  readonly alreadySealed = true as const
  constructor(
    readonly certSerial: string | null,
    readonly signingTime: Date | null
  ) {
    super('document is al verzegeld in dit veld')
  }
}

/**
 * Staat de cryptografische verzegeling aan?
 *
 * Sinds v1.7 is `organisation` de normale route: het organisatiezegel is de enige
 * cryptografische handtekening in een gewoon dossier. Een jaarrekening krijgt bij
 * samenstellen geen beroepscertificaat, want dat is niet voorgeschreven.
 *
 * `qualified` is de uitzonderingsroute (route B) voor documentsoorten waar een
 * beroepscertificaat wél vereist is, zoals een SBR-accountantsverklaring.
 */
export function sealEnabled(): boolean {
  return env.SEAL_MODE === 'organisation' || env.SEAL_MODE === 'qualified'
}

/** Route A (organisatiezegel) of route B (beroepscertificaat)? */
export function sealRoute(): 'geen' | 'organisatie' | 'beroeps' {
  if (env.SEAL_MODE === 'organisation') return 'organisatie'
  if (env.SEAL_MODE === 'qualified') return 'beroeps'
  return 'geen'
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

function secret(): string {
  const s = env.SEALER_SHARED_SECRET
  if (!s) throw new SealPermanentError('SEALER_SHARED_SECRET ontbreekt in de omgeving.')
  return s
}

async function postToSealer(
  path: string,
  form: FormData,
  timeoutMs: number,
  /** Basis-URL; standaard de ondertekenende sidecar. */
  baseUrl: string = env.SEALER_URL
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'X-Sealer-Secret': secret() },
      body: form,
      signal: controller.signal
    })
  } catch (e) {
    // Netwerkfout of timeout: de sidecar is (even) niet bereikbaar.
    throw new SealRetryableError(`sealer niet bereikbaar: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

/** Verzegelt een afgeronde PDF. Gooit SealRetryableError of SealPermanentError. */
export async function sealPdf(req: SealRequest): Promise<SealResult> {
  const form = new FormData()
  form.append('pdf', new Blob([Buffer.from(req.pdfBytes)], { type: 'application/pdf' }), 'document.pdf')
  form.append('reason', req.reason ?? 'Verzegeld door Otto Visser & Partners Accountants')
  form.append('location', req.location ?? 'Sneek')
  form.append('field_name', req.fieldName ?? 'OfficeSeal')
  form.append('appearance_text', req.appearanceText ?? '')
  form.append('appearance_box', JSON.stringify(req.appearanceBox ?? null))
  const gevraagd: CertifyLevel = req.certify ?? 'none'
  form.append('certify_level', gevraagd)

  const res = await postToSealer('/seal', form, env.SEALER_TIMEOUT_MS)
  if (res.status === 409) {
    // Al verzegeld in dit veld: administratie inhalen, niet opnieuw tekenen.
    const body = (await res.json().catch(() => ({}))) as { certSerial?: string; signingTime?: string }
    const t = body.signingTime ? new Date(body.signingTime) : null
    throw new AlreadySealedError(body.certSerial ?? null, t && !Number.isNaN(t.getTime()) ? t : null)
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const msg = `sealer gaf ${res.status}: ${detail.slice(0, 500)}`
    // 502 = signing-API/TSA onbereikbaar (opnieuw proberen), 5xx idem.
    if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
      throw new SealRetryableError(msg)
    }
    throw new SealPermanentError(msg)
  }

  // Kregen we wat we vroegen? Een oudere sealer kent certify_level niet en zou
  // een gewone approval signature terugsturen: het document lijkt dan verzegeld
  // maar staat niet dicht. Dat is dezelfde soort stille afwaardering als het
  // best-effort ondertekenen dat er in v1.7 uit is gegaan, dus fail-closed.
  const gekregen = res.headers.get('X-Seal-Certify')
  if (gevraagd !== 'none' && gekregen !== gevraagd) {
    throw new SealPermanentError(
      `sealer certificeerde niet zoals gevraagd (gevraagd: ${gevraagd}, gekregen: ${gekregen ?? 'geen antwoord'}). ` +
        'Draait er een oudere sealer-image? Het document zou dan niet vergrendeld zijn.'
    )
  }

  const sealedBytes = Buffer.from(await res.arrayBuffer())
  const tsHeader = res.headers.get('X-Seal-Signing-Time')
  const parsedTs = tsHeader ? new Date(tsHeader) : null
  return {
    sealedBytes,
    sealedSha256: sha256Hex(sealedBytes),
    timestampedAt: parsedTs && !Number.isNaN(parsedTs.getTime()) ? parsedTs : null,
    certSerial: res.headers.get('X-Seal-Cert-Serial'),
    tsaUrl: res.headers.get('X-Seal-Tsa-Url'),
    driver: res.headers.get('X-Seal-Driver')
  }
}

// --- Tweefasig ondertekenen (provider waarbij de gebruiker autoriseert) ---

export interface PreparedSignature {
  /** SHA-256 over de signedAttrs — dit is wat de provider ondertekent. */
  hashToSign: string
  documentDigest: string
  signedAttrs: string
  /** Waar de handtekening in het bestand komt; nodig bij het injecteren. */
  reservedRegionStart: number
  reservedRegionEnd: number
  /** De PDF met placeholder, base64. Moet de redirect overleven. */
  preparedPdf: string
}

/**
 * Fase 1: zet een handtekening-placeholder in de PDF en geeft de te ondertekenen
 * hash terug. Voor ALLE documenten in een batch te doen vóór de autorisatie: de
 * SAD leeft maar 300 seconden en dekt de hele batch in één keer.
 */
export async function preparePdfForExternalSigning(input: {
  pdfBytes: Uint8Array
  certChainBase64: string[]
  reason?: string
  location?: string
  fieldName?: string
}): Promise<PreparedSignature> {
  const form = new FormData()
  form.append('pdf', new Blob([Buffer.from(input.pdfBytes)], { type: 'application/pdf' }), 'document.pdf')
  form.append('cert_chain', JSON.stringify(input.certChainBase64))
  form.append('reason', input.reason ?? 'Ondertekend door de accountant')
  form.append('location', input.location ?? 'Sneek')
  form.append('field_name', input.fieldName ?? 'ProfessionalSignature')

  const res = await postToSealer('/prepare', form, env.SEALER_TIMEOUT_MS)
  // Dezelfde afspraak als bij /seal: staat er al een handtekening in dit veld, dan
  // is er niets voor te bereiden en hoeft de accountant niet opnieuw te bevestigen.
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { certSerial?: string; signingTime?: string }
    throw new AlreadySealedError(body.certSerial ?? null, body.signingTime ? new Date(body.signingTime) : null)
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const msg = `voorbereiden mislukt (${res.status}): ${detail.slice(0, 300)}`
    if (res.status >= 500) throw new SealRetryableError(msg)
    throw new SealPermanentError(msg)
  }
  return (await res.json()) as PreparedSignature
}

/**
 * Uitkomst van het injecteren. Sinds v1.4 is dit DE verzegeling, dus de aanroeper
 * heeft dezelfde gegevens nodig die /seal teruggaf.
 */
export interface InjectResult {
  bytes: Buffer
  sha256: string
  /** Tijd uit de handtekening (met TSA: de bewijstijd). */
  timestampedAt: Date | null
  certSerial: string | null
  tsaUrl: string | null
}

/** Fase 2: zet de handtekening van de provider in de voorbereide PDF. */
export async function injectExternalSignature(input: {
  preparedPdfBase64: string
  prepared: Pick<PreparedSignature, 'signedAttrs' | 'documentDigest' | 'reservedRegionStart' | 'reservedRegionEnd'>
  signatureValueBase64: string
  certChainBase64: string[]
  fieldName?: string
}): Promise<InjectResult> {
  const form = new FormData()
  const pdf = Buffer.from(input.preparedPdfBase64, 'base64')
  form.append('prepared_pdf', new Blob([pdf], { type: 'application/pdf' }), 'prepared.pdf')
  form.append('signed_attrs', input.prepared.signedAttrs)
  form.append('document_digest', input.prepared.documentDigest)
  form.append('reserved_region_start', String(input.prepared.reservedRegionStart))
  form.append('reserved_region_end', String(input.prepared.reservedRegionEnd))
  form.append('signature_value', input.signatureValueBase64)
  form.append('cert_chain', JSON.stringify(input.certChainBase64))
  form.append('field_name', input.fieldName ?? 'ProfessionalSignature')

  const res = await postToSealer('/inject', form, env.SEALER_TIMEOUT_MS)
  // De PDF bepaalt of er al ondertekend is, nooit de database. Dit is het enige pad
  // waarlangs een handtekening in een document komt, dus de 409 hoort hier net zo
  // hard als bij /seal.
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { certSerial?: string; signingTime?: string }
    const t = body.signingTime ? new Date(body.signingTime) : null
    throw new AlreadySealedError(body.certSerial ?? null, t && !Number.isNaN(t.getTime()) ? t : null)
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const msg = `injecteren mislukt (${res.status}): ${detail.slice(0, 300)}`
    if (res.status >= 500) throw new SealRetryableError(msg)
    throw new SealPermanentError(msg)
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  const tsHeader = res.headers.get('X-Seal-Signing-Time')
  const parsedTs = tsHeader ? new Date(tsHeader) : null
  return {
    bytes,
    sha256: sha256Hex(bytes),
    timestampedAt: parsedTs && !Number.isNaN(parsedTs.getTime()) ? parsedTs : null,
    certSerial: res.headers.get('X-Seal-Cert-Serial'),
    tsaUrl: res.headers.get('X-Seal-Tsa-Url')
  }
}

export interface ValidationSignature {
  fieldName?: string
  intact?: boolean
  valid?: boolean
  trusted?: boolean
  coversWholeDocument?: boolean
  signerName?: string | null
  /** Uitgever van het certificaat; nodig om zelfondertekend te herkennen. */
  issuerName?: string | null
  /** Subject gelijk aan issuer: dan is het certificaat zelfondertekend. */
  selfIssued?: boolean | null
  certSerial?: string | null
  timestamp?: string | null
  summary?: string | null
  /** De handtekening zelf is niet te lezen; er staat dan niets anders vast. */
  error?: string
  /**
   * De integriteit staat vast, maar de uitgever is niet te controleren
   * (bijvoorbeeld: geen ingebedde revocatiegegevens, of een onbekende CA).
   */
  trustError?: string
}

/** Valideert een PDF via de sidecar. Slaat niets op. */
export async function validatePdf(pdfBytes: Uint8Array): Promise<{ signed: boolean; signatures: ValidationSignature[] }> {
  const form = new FormData()
  form.append('pdf', new Blob([Buffer.from(pdfBytes)], { type: 'application/pdf' }), 'document.pdf')
  // Naar de validator-service als die er is. Die container heeft geen
  // ondertekengegevens in zijn omgeving, en dat is het hele punt: /validate is het
  // enige eindpunt dat bestanden van buiten verwerkt.
  const res = await postToSealer('/validate', form, env.SEALER_TIMEOUT_MS, env.SEALER_VALIDATE_URL || env.SEALER_URL)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new SealPermanentError(`validatie mislukt (${res.status}): ${detail.slice(0, 300)}`)
  }
  return (await res.json()) as { signed: boolean; signatures: ValidationSignature[] }
}
