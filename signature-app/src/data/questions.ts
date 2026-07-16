import type { WizardAnswers } from '../types'

export interface ChoiceOption {
  value: string | number
  label: string
  hint?: string
}

export interface Question {
  key: keyof WizardAnswers
  title: string
  subtitle?: string
  type: 'text' | 'nameParts' | 'choice' | 'slider'
  options?: ChoiceOption[]
  sliderLabels?: [string, string]
  placeholder?: string
}

export const QUESTIONS: Question[] = [
  {
    key: 'fullName',
    title: 'Hoe heet je?',
    subtitle: 'Vul je voor- en achternaam in — dit wordt de basis van je handtekening.',
    type: 'text',
    placeholder: 'Bijv. Mark Visser'
  },
  {
    key: 'nameVariants',
    title: 'Welke delen van je naam wil je gebruiken?',
    subtitle: 'Kies één of meer varianten. Elke stijl kiest daaruit de best passende vorm.',
    type: 'nameParts'
  },
  {
    key: 'hand',
    title: 'Met welke hand schrijf je?',
    subtitle: 'Rechtshandigen hellen van nature naar rechts, linkshandigen schrijven rechter.',
    type: 'choice',
    options: [
      { value: 'links', label: 'Links' },
      { value: 'rechts', label: 'Rechts' }
    ]
  },
  {
    key: 'age',
    title: 'Hoe oud ben je?',
    type: 'choice',
    options: [
      { value: '<25', label: 'Jonger dan 25' },
      { value: '25-40', label: '25 – 40' },
      { value: '41-60', label: '41 – 60' },
      { value: '60+', label: 'Ouder dan 60' }
    ]
  },
  {
    key: 'gender',
    title: 'Wat is je gender?',
    subtitle: 'Alleen gebruikt om de volgorde van stijlsuggesties licht bij te sturen.',
    type: 'choice',
    options: [
      { value: 'man', label: 'Man' },
      { value: 'vrouw', label: 'Vrouw' },
      { value: 'anders', label: 'Anders' },
      { value: 'geen', label: 'Zeg ik liever niet' }
    ]
  },
  {
    key: 'frequency',
    title: 'Hoe vaak zet je een handtekening?',
    subtitle: 'Wie dagelijks tekent, is gebaat bij een snelle, eenvoudige handtekening.',
    type: 'choice',
    options: [
      { value: 'dagelijks', label: 'Dagelijks', hint: 'Snel te zetten' },
      { value: 'wekelijks', label: 'Wekelijks' },
      { value: 'zelden', label: 'Zelden', hint: 'Mag bewerkelijk zijn' }
    ]
  },
  {
    key: 'legibility',
    title: 'Moet je handtekening leesbaar zijn?',
    type: 'choice',
    options: [
      { value: 'leesbaar', label: 'Leesbaar', hint: 'Je naam is te herkennen' },
      { value: 'gemengd', label: 'Er tussenin' },
      { value: 'abstract', label: 'Abstract', hint: 'Vooral een mooi gebaar' }
    ]
  },
  {
    key: 'formality',
    title: 'Hoe formeel wil je overkomen?',
    type: 'slider',
    sliderLabels: ['Speels', 'Zakelijk']
  },
  {
    key: 'thickness',
    title: 'Dunne of dikke lijnen?',
    type: 'choice',
    options: [
      { value: 1, label: 'Dun', hint: 'Fijne pen' },
      { value: 2, label: 'Normaal' },
      { value: 3, label: 'Dik', hint: 'Volle inkt' }
    ]
  },
  {
    key: 'size',
    title: 'Compact of groots?',
    type: 'choice',
    options: [
      { value: 1, label: 'Compact' },
      { value: 2, label: 'Normaal' },
      { value: 3, label: 'Groot' }
    ]
  },
  {
    key: 'flourish',
    title: 'Hoeveel zwier mag het hebben?',
    type: 'choice',
    options: [
      { value: 1, label: 'Minimalistisch' },
      { value: 2, label: 'Subtiel' },
      { value: 3, label: 'Veel krullen' }
    ]
  },
  {
    key: 'underline',
    title: 'Wil je een streep onder je handtekening?',
    type: 'choice',
    options: [
      { value: 'ja', label: 'Ja' },
      { value: 'nee', label: 'Nee' },
      { value: 'verras', label: 'Verras me' }
    ]
  },
  {
    key: 'speed',
    title: 'Schrijf je langzaam en netjes, of snel en vlot?',
    type: 'choice',
    options: [
      { value: 'netjes', label: 'Netjes', hint: 'Gelijkmatige letters' },
      { value: 'vlot', label: 'Vlot', hint: 'Losse, snelle streken' }
    ]
  },
  {
    key: 'purpose',
    title: 'Waarvoor ga je hem gebruiken?',
    type: 'choice',
    options: [
      { value: 'documenten', label: 'Documenten', hint: 'Contracten, e-handtekening' },
      { value: 'creatief', label: 'Creatief', hint: 'Kunst, branding' },
      { value: 'beide', label: 'Beide' }
    ]
  }
]

/** Genereert naam-variant-suggesties uit een volledige naam,
 *  bijv. "Mark de Visser" → ["Mark de Visser", "Mark", "M. de Visser", "MdV", "MV"]. */
export function suggestNameVariants(fullName: string): string[] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return []
  const variants = new Set<string>()
  variants.add(parts.join(' '))
  variants.add(parts[0])
  if (parts.length > 1) {
    const last = parts.slice(1).join(' ')
    variants.add(`${parts[0][0]}. ${last}`)
    variants.add(parts[parts.length - 1])
    variants.add(parts.map((p) => p[0]).join(''))
    if (parts.length > 2) {
      variants.add(`${parts[0][0]}${parts[parts.length - 1][0]}`)
    }
  }
  return [...variants].filter((v) => v.length > 0)
}
