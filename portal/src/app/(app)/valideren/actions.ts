'use server'

import { validatePdf, sealEnabled, type ValidationSignature } from '@/lib/seal/sealer'
import { consume } from '@/lib/ratelimit'
import { headers } from 'next/headers'
import { clientIp } from '@/lib/ip'
import { env } from '@/env'
import { requireAccountant } from '@/lib/auth/session'

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
  // Achter de login sinds v1.4. Daarmee is er geen onbeauthenticeerde ingang meer
  // naar de PDF-parser, en is een aparte validator-container niet nodig.
  await requireAccountant()
  const ip = clientIp(headers().get('x-forwarded-for'), headers().get('x-real-ip'), env.TRUSTED_PROXY_HOPS)
  // Eigen limiet, niet die van de tekenlinks: dit is de publieke controlepagina en
  // een PDF-bom is hier de goedkoopste aanval.
  if (!(await consume('validate', ip ?? 'onbekend'))) {
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
