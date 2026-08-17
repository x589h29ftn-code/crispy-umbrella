import type { FieldKind } from '../types'

/**
 * Formuliervelden bouwen: de soorten velden, hun naam in het Nederlands en het
 * formaat waarmee een veld geplaatst wordt als je alleen klikt in plaats van een
 * vak te slepen. Deze module is met opzet klein en zonder pdf-lib, zodat de
 * gereedschapsbalk hem kan gebruiken zonder de hele PDF-motor te laden.
 */
export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Tekst',
  multiline: 'Meerdere regels',
  date: 'Datum',
  amount: 'Bedrag',
  checkbox: 'Vinkje',
  radio: 'Keuzerondje',
  dropdown: 'Keuzelijst',
  signature: 'Handtekening'
}

/** Korte uitleg per veldsoort (tooltip in het gereedschapspaneel). */
export const FIELD_KIND_HINTS: Record<FieldKind, string> = {
  text: 'Eén regel om in te vullen, bijvoorbeeld een naam',
  multiline: 'Groter vak voor een toelichting van meerdere regels',
  date: 'Datumveld (dd-mm-jjjj), maximaal tien tekens',
  amount: 'Bedrag: de ingevulde waarde staat rechts uitgelijnd',
  checkbox: 'Aankruisvakje, bijvoorbeeld "Akkoord"',
  radio: 'Keuzerondjes met dezelfde groepsnaam sluiten elkaar uit',
  dropdown: 'Keuzelijst met vaste keuzes (eigen tekst mag ook)',
  signature: 'Kader met een lijn om op te ondertekenen'
}

export const FIELD_KINDS: FieldKind[] = [
  'text',
  'multiline',
  'date',
  'amount',
  'checkbox',
  'radio',
  'dropdown',
  'signature'
]

/**
 * Formaat (in PDF-punten) van een veld dat met één klik geplaatst wordt. Een
 * vinkje of keuzerondje is vierkant en klein; een tekstveld heeft de hoogte van
 * een invulregel.
 */
export function defaultFieldSize(kind: FieldKind): { width: number; height: number } {
  switch (kind) {
    case 'checkbox':
    case 'radio':
      return { width: 14, height: 14 }
    case 'multiline':
      return { width: 220, height: 64 }
    case 'signature':
      return { width: 200, height: 52 }
    case 'date':
      return { width: 110, height: 20 }
    case 'amount':
      return { width: 120, height: 20 }
    case 'dropdown':
      return { width: 160, height: 20 }
    default:
      return { width: 200, height: 20 }
  }
}
