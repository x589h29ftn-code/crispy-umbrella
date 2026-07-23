import type { DocumentKind } from '@prisma/client'

// Berichtsjablonen per documenttype. De standaardteksten staan hier in de code;
// een beheerder kan ze in Instellingen overschrijven (opgeslagen in MessageTemplate).
// Invulvelden staan tussen accolades en worden bij het verzenden ingevuld.

export interface TemplateText {
  title: string
  body: string
}

/// Nette Nederlandse labels per type (voor de UI).
export const KIND_LABELS: Record<DocumentKind, string> = {
  JAARREKENING: 'Jaarrekening',
  NOTULEN_AVA: 'Notulen aandeelhoudersvergadering',
  BEVESTIGING_JAARREKENING: 'Bevestiging bij de jaarrekening',
  AKKOORD_IB: 'Akkoordverklaring inkomstenbelasting',
  AKKOORD_VPB: 'Akkoordverklaring vennootschapsbelasting',
  OPDRACHTBEVESTIGING: 'Opdrachtbevestiging',
  OVERIG: 'Overig'
}

/// Beschikbare invulvelden, voor de uitleg in het beheerscherm.
export const PLACEHOLDERS: { token: string; uitleg: string }[] = [
  { token: '{voornaam_klant}', uitleg: 'Voornaam van de cliënt (of naam als de voornaam ontbreekt)' },
  { token: '{bedrijfsnaam}', uitleg: 'Bedrijfsnaam van de cliënt' },
  { token: '{boekjaar}', uitleg: 'Herkend boekjaar uit het document' },
  { token: '{documenttitel}', uitleg: 'Titel van het document' },
  { token: '{voornaam_afzender}', uitleg: 'Uw eigen voornaam (afzender vanuit kantoor)' }
]

// Standaardsjablonen. Voor OVERIG bewust geen automatische suggestie.
export const DEFAULT_TEMPLATES: Record<DocumentKind, TemplateText> = {
  JAARREKENING: {
    title: 'Jaarrekening {boekjaar}',
    body:
      'Beste {voornaam_klant}, in de bijlage ontvang je de definitieve jaarrekening over {boekjaar}. ' +
      'Zou je deze willen voorzien van een handtekening? Met vriendelijke groet, {voornaam_afzender}'
  },
  NOTULEN_AVA: {
    title: 'Notulen aandeelhoudersvergadering {boekjaar}',
    body:
      'Beste {voornaam_klant}, in de bijlage vind je de notulen van de algemene vergadering van aandeelhouders ' +
      'over {boekjaar}. Zou je deze willen ondertekenen? Met vriendelijke groet, {voornaam_afzender}'
  },
  BEVESTIGING_JAARREKENING: {
    title: 'Bevestiging bij de jaarrekening {boekjaar}',
    body:
      'Beste {voornaam_klant}, ter afronding van de jaarrekening over {boekjaar} ontvang je in de bijlage de ' +
      'bevestiging bij de jaarrekening. Zou je deze willen ondertekenen? Met vriendelijke groet, {voornaam_afzender}'
  },
  AKKOORD_IB: {
    title: 'Akkoordverklaring aangifte inkomstenbelasting {boekjaar}',
    body:
      'Beste {voornaam_klant}, in de bijlage ontvang je de akkoordverklaring voor de aangifte inkomstenbelasting ' +
      'over {boekjaar}. Zou je deze willen ondertekenen zodat wij de aangifte kunnen indienen? ' +
      'Met vriendelijke groet, {voornaam_afzender}'
  },
  AKKOORD_VPB: {
    title: 'Akkoordverklaring aangifte vennootschapsbelasting {boekjaar}',
    body:
      'Beste {voornaam_klant}, in de bijlage ontvang je de akkoordverklaring voor de aangifte ' +
      'vennootschapsbelasting over {boekjaar}. Zou je deze willen ondertekenen zodat wij de aangifte kunnen ' +
      'indienen? Met vriendelijke groet, {voornaam_afzender}'
  },
  OPDRACHTBEVESTIGING: {
    title: 'Opdrachtbevestiging',
    body:
      'Beste {voornaam_klant}, wat fijn dat we voor je aan de slag mogen. In de bijlage ontvang je de ' +
      'opdrachtbevestiging. Zou je deze willen ondertekenen? Met vriendelijke groet, {voornaam_afzender}'
  },
  OVERIG: { title: '', body: '' }
}

/// Vult invulvelden in. Onbekende waarden worden weggelaten (of vervangen door
/// een terugval). Niet-herkende accolades blijven ongemoeid staan.
export function renderTemplate(
  template: string,
  vars: {
    voornaamKlant?: string | null
    bedrijfsnaam?: string | null
    boekjaar?: number | string | null
    documenttitel?: string | null
    voornaamAfzender?: string | null
  }
): string {
  const map: Record<string, string> = {
    voornaam_klant: (vars.voornaamKlant ?? '').trim(),
    bedrijfsnaam: (vars.bedrijfsnaam ?? '').trim(),
    boekjaar: vars.boekjaar != null ? String(vars.boekjaar) : '',
    documenttitel: (vars.documenttitel ?? '').trim(),
    voornaam_afzender: (vars.voornaamAfzender ?? '').trim()
  }
  let out = template.replace(/\{(voornaam_klant|bedrijfsnaam|boekjaar|documenttitel|voornaam_afzender)\}/g, (m, key) =>
    map[key] !== '' ? map[key] : m === '{voornaam_klant}' ? 'heer/mevrouw' : ''
  )
  // Nette opschoning: dubbele spaties en spatie voor leestekens die door een
  // leeg veld kunnen ontstaan.
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim()
  return out
}

/// Haalt de eerste voornaam uit een naamveld (bijv. "Jan Jansen" -> "Jan").
/// Initialen zoals "J." worden niet als voornaam gebruikt.
export function firstNameFrom(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const v = (c ?? '').trim()
    if (!v) continue
    const first = v.split(/\s+/)[0]
    if (first && !/^[A-Za-z]\.?$/.test(first) && !/\./.test(first)) return first
  }
  return null
}
