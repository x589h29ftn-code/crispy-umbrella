'use server'

import { validatePdf, sealEnabled, type ValidationSignature } from '@/lib/seal/sealer'
import { consume } from '@/lib/ratelimit'
import { headers } from 'next/headers'
import { clientIp } from '@/lib/ip'
import { env } from '@/env'

export interface ValidateState {
  error?: string
  fileName?: string
  signed?: boolean
  signatures?: ValidationSignature[]
}

const MAX_BYTES = 30_000_000

/**
 * Controleert een aangeleverde PDF. Het bestand wordt niet opgeslagen: het gaat
 * in het geheugen naar de sealer-sidecar en wordt daarna weggegooid.
 */
export async function validateAction(_prev: ValidateState, formData: FormData): Promise<ValidateState> {
  const ip = clientIp(headers().get('x-forwarded-for'), headers().get('x-real-ip'), env.TRUSTED_PROXY_HOPS)
  if (!(await consume('token', ip ?? 'onbekend'))) {
    return { error: 'Te veel verzoeken. Probeer het over enkele minuten opnieuw.' }
  }
  if (!sealEnabled()) {
    return { error: 'De validatiedienst is op dit portaal (nog) niet ingeschakeld.' }
  }
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Kies een PDF-bestand.' }
  if (file.size > MAX_BYTES) return { error: 'Bestand te groot (max 30 MB).' }
  if (file.type && file.type !== 'application/pdf') return { error: 'Alleen PDF-bestanden.' }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await validatePdf(bytes)
    return { fileName: file.name, signed: result.signed, signatures: result.signatures }
  } catch (e) {
    return { error: `Controle mislukt: ${(e as Error).message}` }
  }
}
