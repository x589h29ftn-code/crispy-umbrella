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

export interface SealRequest {
  pdfBytes: Uint8Array
  reason?: string
  location?: string
  fieldName?: string
  appearanceText?: string
  appearanceBox?: SealAppearanceBox | null
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

/** Staat de cryptografische verzegeling aan? */
export function sealEnabled(): boolean {
  return env.SEAL_MODE === 'sealer'
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

function secret(): string {
  const s = env.SEALER_SHARED_SECRET
  if (!s) throw new SealPermanentError('SEALER_SHARED_SECRET ontbreekt in de omgeving.')
  return s
}

async function postToSealer(path: string, form: FormData, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${env.SEALER_URL.replace(/\/+$/, '')}${path}`, {
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

  const res = await postToSealer('/seal', form, env.SEALER_TIMEOUT_MS)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const msg = `sealer gaf ${res.status}: ${detail.slice(0, 500)}`
    // 502 = signing-API/TSA onbereikbaar (opnieuw proberen), 5xx idem.
    if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
      throw new SealRetryableError(msg)
    }
    throw new SealPermanentError(msg)
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

export interface ValidationSignature {
  fieldName?: string
  intact?: boolean
  valid?: boolean
  trusted?: boolean
  coversWholeDocument?: boolean
  signerName?: string | null
  certSerial?: string | null
  timestamp?: string | null
  summary?: string | null
  error?: string
}

/** Valideert een PDF via de sidecar. Slaat niets op. */
export async function validatePdf(pdfBytes: Uint8Array): Promise<{ signed: boolean; signatures: ValidationSignature[] }> {
  const form = new FormData()
  form.append('pdf', new Blob([Buffer.from(pdfBytes)], { type: 'application/pdf' }), 'document.pdf')
  const res = await postToSealer('/validate', form, env.SEALER_TIMEOUT_MS)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new SealPermanentError(`validatie mislukt (${res.status}): ${detail.slice(0, 300)}`)
  }
  return (await res.json()) as { signed: boolean; signatures: ValidationSignature[] }
}
