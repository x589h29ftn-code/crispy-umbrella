import { createHash } from 'node:crypto'

// De verklaring die de ondertekenaar boven de knop leest. Eén plek, zodat we
// exact deze tekst kunnen vastleggen bij de ondertekenaar (momentopname) en op
// het auditcertificaat kunnen afdrukken.
//
// Bewust feitelijk formuleren: "digitaal ondertekend" en "vastgelegd", geen
// juridische kwalificaties als "gekwalificeerd" of "eIDAS-niveau".
//
// De tekst hangt af van de rol. Een cliënt verklaart akkoord te gaan met de
// inhoud; een accountant verklaart iets anders — hij tekent vanuit zijn
// beroepsuitoefening. Dezelfde zin onder allebei zetten zou van één van de twee
// een onjuiste weergave maken.

export const CONSENT_TEXT =
  'Door te ondertekenen bevestigt u akkoord met de inhoud van dit document. ' +
  'Uw naam, e-mailadres, IP-adres en het tijdstip van ondertekenen worden vastgelegd ' +
  'in het auditspoor en op het ondertekencertificaat bij dit document.'

/** Kantoorondertekenaar, algemeen. */
const CONSENT_KANTOOR =
  'Door te ondertekenen plaatst u uw handtekening namens Otto Visser & Partners accountants. ' +
  'Uw naam, IP-adres, apparaat en het tijdstip van ondertekenen worden vastgelegd in het ' +
  'auditspoor en op het ondertekencertificaat bij dit document. Voor deze handeling is een ' +
  'verse verificatiecode uit uw authenticatie-app vereist.'

/** Kantoorondertekenaar bij een jaarrekening: daar tekent hij in het stuk zelf. */
const CONSENT_KANTOOR_JAARREKENING =
  'Door te ondertekenen plaatst u uw handtekening in deze jaarrekening namens ' +
  'Otto Visser & Partners accountants. Uw naam, IP-adres, apparaat en het tijdstip van ' +
  'ondertekenen worden vastgelegd in het auditspoor en op het ondertekencertificaat. ' +
  'Voor deze handeling is een verse verificatiecode uit uw authenticatie-app vereist.'

export type ConsentRol = 'ZELF' | 'EXTERN'

/**
 * De verklaring voor deze rol en documentsoort. `kind` is de herkende soort van
 * het eerste document in het dossier; is die onbekend, dan geldt de algemene tekst.
 */
export function consentTextVoor(rol: ConsentRol, kind?: string | null): string {
  if (rol !== 'ZELF') return CONSENT_TEXT
  return kind === 'JAARREKENING' ? CONSENT_KANTOOR_JAARREKENING : CONSENT_KANTOOR
}

export function consentHash(text: string = CONSENT_TEXT): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
