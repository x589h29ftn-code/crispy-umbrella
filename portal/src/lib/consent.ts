import { createHash } from 'node:crypto'

// De verklaring die de ondertekenaar boven de knop leest. Eén plek, zodat we
// exact deze tekst kunnen vastleggen bij de ondertekenaar (momentopname) en op
// het auditcertificaat kunnen afdrukken.
//
// Bewust feitelijk formuleren: "digitaal ondertekend" en "vastgelegd", geen
// juridische kwalificaties als "gekwalificeerd" of "eIDAS-niveau".

export const CONSENT_TEXT =
  'Door te ondertekenen bevestigt u akkoord met de inhoud van dit document. ' +
  'Uw naam, e-mailadres, IP-adres en het tijdstip van ondertekenen worden vastgelegd ' +
  'in het auditspoor en op het ondertekencertificaat bij dit document.'

export function consentHash(text: string = CONSENT_TEXT): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
