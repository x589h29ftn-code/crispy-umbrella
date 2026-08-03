import 'server-only'
import { env } from '@/env'

// Gekwalificeerd ondertekenen op persoonlijke titel (beroepscertificaat).
//
// Er is precies één mechanisme: de CSC-route in src/lib/csc/. De sleutel staat
// bij de provider in een HSM en de accountant autoriseert zelf (pincode in de
// app van de provider). Het waarmerken gebeurt ná het auditcertificaat, in
// sealAndComplete — niet tijdens het zetten van het zichtbare stempel.
//
// Er was ooit een tweede pad: een driver die tijdens het ondertekenen namens de
// accountant tekende. Dat is verwijderd. Het tekende best-effort — viel de
// provider weg, dan bleef het zichtbare stempel staan en liep het dossier door
// naar ONDERTEKEND zonder gekwalificeerde handtekening. Precies op het punt
// waar je op vertrouwt was dat een stille afwaardering.
//
// Het geheim/token van de provider staat NOOIT in de database: per accountant
// bewaren we alleen de verwijzing (credential-id). De OAuth-clientgegevens
// staan in de omgeving (env), niet per gebruiker.

/**
 * Is er een provider ingesteld? Bepaalt of het beroepscertificaat per
 * gebruiker instelbaar is (Instellingen > Gebruikers).
 */
export function professionalSigningConfigured(): boolean {
  return env.PROFESSIONAL_SIGNING_DRIVER !== 'none'
}
