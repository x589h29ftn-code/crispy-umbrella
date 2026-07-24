import 'server-only'
import { env } from '@/env'

// Gekwalificeerd ondertekenen op persoonlijke titel (beroepscertificaat).
//
// Zelfde patroon als de archief-driver: een pluggable laag met 'none' als
// veilige standaard. Zolang PROFESSIONAL_SIGNING_DRIVER='none' verandert er
// niets aan de bestaande flow (de kantoorhandtekening blijft een zichtbaar
// stempel). Zet je de driver op 'digidentity' én schakel je bij een accountant
// een beroepscertificaat in, dan wordt zijn document daarnaast gekwalificeerd
// (PAdES) ondertekend via de CSC-API van Digidentity.
//
// Het geheim/token van de provider staat NOOIT in de database: per accountant
// bewaren we alleen de verwijzing (credential-id). De OAuth-clientgegevens
// staan in de omgeving (env), niet per gebruiker.

export interface ProfessionalSignInput {
  pdfBytes: Uint8Array
  signer: {
    name: string
    professionalTitle: string | null // 'AA' | 'RA'
    credentialId: string | null // credential-/certificaat-id bij de provider
  }
  reason?: string
  location?: string
}

export interface ProfessionalSigner {
  readonly id: string
  /** Zet een gekwalificeerde PAdES-handtekening op de PDF en geeft nieuwe bytes. */
  signPdf(input: ProfessionalSignInput): Promise<Uint8Array>
}

/** Is er überhaupt een provider ingesteld (driver ≠ none)? */
export function professionalSigningConfigured(): boolean {
  return env.PROFESSIONAL_SIGNING_DRIVER !== 'none'
}

/**
 * Bepaalt of voor deze accountant een gekwalificeerde handtekening moet worden
 * gezet: de driver moet actief zijn én de accountant moet een ingeschakeld
 * beroepscertificaat met credential-id hebben. Zo niet: gewoon het zichtbare
 * stempel (huidig gedrag).
 */
export function accountantCanQualifiedSign(a: {
  signingCertEnabled: boolean
  signingCredentialId: string | null
}): boolean {
  return professionalSigningConfigured() && a.signingCertEnabled && !!a.signingCredentialId
}

/** Geeft de actieve provider, of null als er geen is ingesteld ('none'). */
export async function getProfessionalSigner(): Promise<ProfessionalSigner | null> {
  switch (env.PROFESSIONAL_SIGNING_DRIVER) {
    case 'digidentity': {
      const { createDigidentitySigner } = await import('./digidentity')
      return createDigidentitySigner()
    }
    case 'none':
    default:
      return null
  }
}
