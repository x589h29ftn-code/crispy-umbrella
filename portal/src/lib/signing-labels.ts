import { env } from '@/env'
import type { DocumentKind } from '@prisma/client'

// Wat er in de handtekening staat, per documentsoort.
//
// De gekwalificeerde handtekening van de accountant vervangt de natte handtekening.
// Op een jaarrekening hoort daarom "Ondertekend door <naam>, RA" te staan: de
// accountant zet daar zijn naam onder.
//
// Maar niet op alles hetzelfde. In een akkoordbrief of een bevestigingsbrief
// verklaart de CLIËNT iets. Zou daar "Ondertekend door <accountant>" staan, dan
// wekt dat de indruk dat de accountant die verklaring mede onderschrijft. Daar is de
// handtekening alleen het slot op het document, en hoort er "Verzegeld door Otto
// Visser & Partners Accountants" te staan.
//
// Dit is een INSTELLING en geen code: `SIGN_AS_AUTHOR_KINDS` is een komma-gescheiden
// lijst documentsoorten waarop de accountant als auteur ondertekent. Zo kan het
// antwoord op de openstaande vraag (teken je op de aangifte zelf, of alleen op de
// akkoordbrief?) later komen zonder een nieuwe versie van de app.

/** Soorten waarop de accountant standaard als auteur ondertekent. */
export const STANDAARD_AUTEUR_SOORTEN: DocumentKind[] = ['JAARREKENING']

export type LabelSoort = 'ondertekend' | 'verzegeld'

/** Leest de instelling; onbekende namen worden genegeerd, niet fataal. */
export function auteurSoorten(): Set<string> {
  const ruw = env.SIGN_AS_AUTHOR_KINDS.trim()
  if (!ruw) return new Set(STANDAARD_AUTEUR_SOORTEN)
  return new Set(
    ruw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  )
}

/** Ondertekent de accountant dit soort document als auteur, of zegelt hij het? */
export function labelSoortVoor(kind: DocumentKind | null | undefined): LabelSoort {
  if (!kind) return 'verzegeld'
  return auteurSoorten().has(kind) ? 'ondertekend' : 'verzegeld'
}

export interface SignerLabelInput {
  kind: DocumentKind | null | undefined
  accountantName: string
  /** AA of RA; ontbreekt die, dan blijft de titel weg. */
  professionalTitle?: string | null
}

/**
 * De tekst die in de handtekening komt (het PAdES-veld `reason`, wat een PDF-lezer
 * als "Reden" toont).
 */
export function signatureReason(input: SignerLabelInput): string {
  if (labelSoortVoor(input.kind) === 'ondertekend') {
    const titel = input.professionalTitle?.trim()
    return titel
      ? `Ondertekend door ${input.accountantName}, ${titel}`
      : `Ondertekend door ${input.accountantName}`
  }
  return 'Verzegeld door Otto Visser & Partners Accountants'
}
