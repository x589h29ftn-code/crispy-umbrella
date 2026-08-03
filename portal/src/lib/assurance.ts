import 'server-only'
import type { AssuranceLevel } from '@prisma/client'
import { env } from '@/env'

// Betrouwbaarheidsniveau per dossier.
//
// De afzender kiest per stuk hoeveel bewijskracht hij wil. Dat is geen luxe: een
// akkoordbrief bij een IB-aangifte en een jaarrekening vragen niet hetzelfde, en
// een zegel per stuk kost tijd en (bij sommige aanbieders) geld.
//
// De verdeling is strikt:
//   SEAL_MODE  = wat de SERVER kan
//   assuranceLevel = wat dit DOSSIER gebruikt
//
// Een dossier kan dus nooit meer claimen dan de server kan leveren. Andersom mag
// wel: op een server met een zegel kan een stuk bewust zonder de deur uit.

/** Wat levert dit niveau op, in gewone taal? */
export const ASSURANCE_LABEL: Record<AssuranceLevel, string> = {
  AUDITSPOOR: 'Auditspoor',
  ZEGEL: 'Organisatiezegel',
  BEROEPS: 'Beroepscertificaat'
}

export const ASSURANCE_UITLEG: Record<AssuranceLevel, string> = {
  AUDITSPOOR:
    'Verificatiecode per e-mail of sms, IP-adres, apparaat en tijdstippen worden vastgelegd, ' +
    'plus de verklaring die de ondertekenaar las en een vingerafdruk van wat hij zag. ' +
    'Na afronding komt er een apart auditrapport met het volledige verloop. Geen digitaal ' +
    'zegel, dus de ontvanger kan de echtheid niet in zijn PDF-lezer controleren.',
  ZEGEL:
    'Alles van het auditspoor, plus een certificerend organisatiezegel met een gekwalificeerde ' +
    'tijdstempel. De PDF-lezer van de ontvanger controleert de echtheid zelf en meldt elke ' +
    'wijziging na ondertekening.',
  BEROEPS:
    'Alles van het auditspoor, plus de gekwalificeerde handtekening van de accountant op ' +
    'persoonlijke titel. Alleen nodig waar dat is voorgeschreven; de accountant moet zelf ' +
    'autoriseren.'
}

/**
 * Welke niveaus kan deze server aanbieden?
 *
 * AUDITSPOOR staat er altijd bij en dat is bewust: het vraagt geen certificaat,
 * geen provider en geen netwerk naar buiten. Er is dus altijd een niveau dat
 * werkt, ook als een aanbieder eruit ligt.
 */
export function beschikbareNiveaus(): AssuranceLevel[] {
  const uit: AssuranceLevel[] = ['AUDITSPOOR']
  if (env.SEAL_MODE === 'organisation') uit.push('ZEGEL')
  if (env.SEAL_MODE === 'qualified') uit.push('BEROEPS')
  return uit
}

/**
 * Het standaardniveau voor een nieuw dossier: het hoogste dat de server kan.
 *
 * Zo krijgt een kantoor met een certificaat niet per ongeluk onbeschermde stukken
 * omdat iemand het vinkje vergeet, en hoeft een kantoor zonder certificaat niets
 * in te stellen.
 */
export function standaardNiveau(): AssuranceLevel {
  const beschikbaar = beschikbareNiveaus()
  if (beschikbaar.includes('BEROEPS')) return 'BEROEPS'
  if (beschikbaar.includes('ZEGEL')) return 'ZEGEL'
  return 'AUDITSPOOR'
}

/** Kan dit niveau nu gebruikt worden? Zo niet: waarom niet, in bruikbare taal. */
export function niveauControle(niveau: AssuranceLevel): { ok: true } | { ok: false; melding: string } {
  if (beschikbareNiveaus().includes(niveau)) return { ok: true }
  if (niveau === 'ZEGEL') {
    return {
      ok: false,
      melding:
        'Een organisatiezegel is op deze server niet ingesteld (SEAL_MODE staat niet op "organisation"). ' +
        'Kies "Auditspoor", of laat de beheerder het organisatiecertificaat instellen.'
    }
  }
  if (niveau === 'BEROEPS') {
    return {
      ok: false,
      melding:
        'Ondertekenen met een beroepscertificaat is op deze server niet ingesteld (SEAL_MODE staat niet ' +
        'op "qualified"). Kies "Auditspoor" of "Organisatiezegel".'
    }
  }
  return { ok: false, melding: 'Onbekend betrouwbaarheidsniveau.' }
}

/**
 * Wordt er voor dit dossier cryptografisch verzegeld?
 *
 * Dit is de vervanger van het oude, globale `sealEnabled()` op alle plekken waar
 * het over één dossier gaat. Het globale antwoord zei of de server het kán; deze
 * zegt of het voor dít stuk gebeurt, en dat is bijna altijd de vraag die je
 * werkelijk stelt.
 */
export function dossierVerzegelt(niveau: AssuranceLevel): boolean {
  return niveau === 'ZEGEL' || niveau === 'BEROEPS'
}

/** Route A of route B voor dit dossier? */
export function dossierRoute(niveau: AssuranceLevel): 'geen' | 'organisatie' | 'beroeps' {
  if (niveau === 'ZEGEL') return 'organisatie'
  if (niveau === 'BEROEPS') return 'beroeps'
  return 'geen'
}
