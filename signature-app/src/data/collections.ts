import type { Collection, SignatureStyle } from '../types'

export const STYLES: SignatureStyle[] = [
  // ─── Collectie 1: Elegant ───
  {
    id: 'elegant-1', collectionId: 'elegant', fontId: 'greatVibes', label: 'Vloeiend klassiek',
    baseSlantDeg: 4, firstLetterScale: 1.45, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.012, baselineDriftEm: 0.01,
    flourishes: [{ kind: 'leadIn', probability: 0.7, intensity: 0.6 }, { kind: 'tail', probability: 0.8, intensity: 0.7 }],
    legibilityTag: 'leesbaar', formalityTag: 4
  },
  {
    id: 'elegant-2', collectionId: 'elegant', fontId: 'pinyonScript', label: 'Koninklijke krul',
    baseSlantDeg: 6, firstLetterScale: 1.3, letterSpacingEm: -0.01, caseTransform: 'none',
    strokeWidthEm: 0.008, baselineDriftEm: 0.008,
    flourishes: [{ kind: 'underline', probability: 0.85, intensity: 0.7 }],
    legibilityTag: 'gemengd', formalityTag: 5
  },
  {
    id: 'elegant-3', collectionId: 'elegant', fontId: 'mrsSaintDelafield', label: 'Zwierige pen',
    baseSlantDeg: 8, firstLetterScale: 1.5, letterSpacingEm: 0.01, caseTransform: 'none',
    strokeWidthEm: 0.006, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'tail', probability: 0.9, intensity: 0.9 }],
    legibilityTag: 'gemengd', formalityTag: 4
  },
  {
    id: 'elegant-4', collectionId: 'elegant', fontId: 'tangerine', label: 'Fijn en compact',
    baseSlantDeg: 3, firstLetterScale: 1.35, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.01, baselineDriftEm: 0.006,
    flourishes: [],
    legibilityTag: 'leesbaar', formalityTag: 4
  },

  // ─── Collectie 2: Zakelijk ───
  {
    id: 'zakelijk-1', collectionId: 'zakelijk', fontId: 'dancingScript', label: 'Heldere hand',
    baseSlantDeg: 8, firstLetterScale: 1.25, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.02, baselineDriftEm: 0.008,
    flourishes: [{ kind: 'underline', probability: 0.9, intensity: 0.6 }],
    legibilityTag: 'leesbaar', formalityTag: 4
  },
  {
    id: 'zakelijk-2', collectionId: 'zakelijk', fontId: 'allura', label: 'Directiekamer',
    baseSlantDeg: 5, firstLetterScale: 1.4, letterSpacingEm: -0.005, caseTransform: 'none',
    strokeWidthEm: 0.012, baselineDriftEm: 0.01,
    flourishes: [{ kind: 'tail', probability: 0.6, intensity: 0.5 }, { kind: 'underline', probability: 0.4, intensity: 0.5 }],
    legibilityTag: 'leesbaar', formalityTag: 5
  },
  {
    id: 'zakelijk-3', collectionId: 'zakelijk', fontId: 'rougeScript', label: 'Vlotte paraaf',
    baseSlantDeg: 10, firstLetterScale: 1.35, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.014, baselineDriftEm: 0.015,
    flourishes: [{ kind: 'strike', probability: 0.45, intensity: 0.6 }, { kind: 'tail', probability: 0.5, intensity: 0.5 }],
    legibilityTag: 'gemengd', formalityTag: 3
  },
  {
    id: 'zakelijk-4', collectionId: 'zakelijk', fontId: 'petitFormalScript', label: 'Notarieel strak',
    baseSlantDeg: 2, firstLetterScale: 1.2, letterSpacingEm: 0.005, caseTransform: 'none',
    strokeWidthEm: 0.01, baselineDriftEm: 0,
    flourishes: [{ kind: 'underline', probability: 0.5, intensity: 0.4 }],
    legibilityTag: 'leesbaar', formalityTag: 5
  },

  // ─── Collectie 3: Klassiek ───
  {
    id: 'klassiek-1', collectionId: 'klassiek', fontId: 'monsieurLaDoulaise', label: 'Omcirkelde meester',
    baseSlantDeg: 7, firstLetterScale: 1.4, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.006, baselineDriftEm: 0.012,
    flourishes: [{ kind: 'ellipse', probability: 0.6, intensity: 0.8 }, { kind: 'tail', probability: 0.4, intensity: 0.6 }],
    legibilityTag: 'gemengd', formalityTag: 4
  },
  {
    id: 'klassiek-2', collectionId: 'klassiek', fontId: 'herrVonMuellerhoff', label: 'Grote entree',
    baseSlantDeg: 6, firstLetterScale: 1.6, letterSpacingEm: 0.005, caseTransform: 'none',
    strokeWidthEm: 0.006, baselineDriftEm: 0.015,
    flourishes: [{ kind: 'leadIn', probability: 0.7, intensity: 0.8 }, { kind: 'tail', probability: 0.6, intensity: 0.7 }],
    legibilityTag: 'abstract', formalityTag: 4
  },
  {
    id: 'klassiek-3', collectionId: 'klassiek', fontId: 'arizonia', label: 'Dubbel onderstreept',
    baseSlantDeg: 5, firstLetterScale: 1.3, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.012, baselineDriftEm: 0.008,
    flourishes: [{ kind: 'underline', probability: 1, intensity: 0.95 }],
    legibilityTag: 'leesbaar', formalityTag: 3
  },

  // ─── Collectie 4: Modern ───
  {
    id: 'modern-1', collectionId: 'modern', fontId: 'yellowtail', label: 'Dikke inkt',
    baseSlantDeg: 6, firstLetterScale: 1.2, letterSpacingEm: 0, caseTransform: 'lower',
    strokeWidthEm: 0.03, baselineDriftEm: 0.01,
    flourishes: [{ kind: 'tail', probability: 0.5, intensity: 0.4 }],
    legibilityTag: 'leesbaar', formalityTag: 2
  },
  {
    id: 'modern-2', collectionId: 'modern', fontId: 'sacramento', label: 'Dunne lijn',
    baseSlantDeg: 4, firstLetterScale: 1.25, letterSpacingEm: 0.02, caseTransform: 'none',
    strokeWidthEm: 0.005, baselineDriftEm: 0.008,
    flourishes: [{ kind: 'underline', probability: 0.4, intensity: 0.3 }],
    legibilityTag: 'leesbaar', formalityTag: 3
  },
  {
    id: 'modern-3', collectionId: 'modern', fontId: 'norican', label: 'Snelle streek',
    baseSlantDeg: 9, firstLetterScale: 1.2, letterSpacingEm: -0.005, caseTransform: 'none',
    strokeWidthEm: 0.02, baselineDriftEm: 0.025,
    flourishes: [{ kind: 'tail', probability: 0.7, intensity: 0.6 }],
    legibilityTag: 'gemengd', formalityTag: 2
  },
  {
    id: 'modern-4', collectionId: 'modern', fontId: 'kaushanScript', label: 'Doorgestreept modern',
    baseSlantDeg: 7, firstLetterScale: 1.15, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.018, baselineDriftEm: 0.015,
    flourishes: [{ kind: 'strike', probability: 0.55, intensity: 0.7 }],
    legibilityTag: 'gemengd', formalityTag: 2
  },

  // ─── Collectie 5: Abstract ───
  {
    id: 'abstract-1', collectionId: 'abstract', fontId: 'qwigley', label: 'Omcirkelde initialen',
    baseSlantDeg: 8, firstLetterScale: 1.5, letterSpacingEm: 0.01, caseTransform: 'initialsOnly',
    strokeWidthEm: 0.008, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'ellipse', probability: 0.75, intensity: 0.85 }],
    legibilityTag: 'abstract', formalityTag: 3
  },
  {
    id: 'abstract-2', collectionId: 'abstract', fontId: 'drSugiyama', label: 'Doorgehaalde paraaf',
    baseSlantDeg: 12, firstLetterScale: 1.4, letterSpacingEm: 0, caseTransform: 'initialsOnly',
    strokeWidthEm: 0.01, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'strike', probability: 0.85, intensity: 0.9 }, { kind: 'tail', probability: 0.5, intensity: 0.7 }],
    legibilityTag: 'abstract', formalityTag: 3
  },
  {
    id: 'abstract-3', collectionId: 'abstract', fontId: 'zeyada', label: 'Losse hand',
    baseSlantDeg: 6, firstLetterScale: 1.3, letterSpacingEm: 0.005, caseTransform: 'none',
    strokeWidthEm: 0.008, baselineDriftEm: 0.035,
    flourishes: [{ kind: 'tail', probability: 0.9, intensity: 1 }],
    legibilityTag: 'abstract', formalityTag: 2
  },

  // ─── Collectie 7: Signatuur (echte penlijn-handtekeningen, stroke-engine) ───
  {
    id: 'signatuur-1', collectionId: 'signatuur', fontId: 'mrsSaintDelafield', label: 'Voorletter + naam',
    engine: 'stroke', strokeFontId: 'scripts', penWidthEm: 0.035, taper: 0.8, scribble: 0.25,
    baseSlantDeg: 14, firstLetterScale: 1.5, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'initialSurname',
    strokeWidthEm: 0.014, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'strike', probability: 0.9, intensity: 0.95 }, { kind: 'tail', probability: 0.5, intensity: 0.7 }],
    legibilityTag: 'gemengd', formalityTag: 4
  },
  {
    id: 'signatuur-2', collectionId: 'signatuur', fontId: 'monsieurLaDoulaise', label: 'Naam + voorletter',
    engine: 'stroke', strokeFontId: 'scriptc', penWidthEm: 0.03, taper: 0.85, scribble: 0.5,
    baseSlantDeg: 8, firstLetterScale: 1.45, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'surnameInitial',
    strokeWidthEm: 0.012, baselineDriftEm: 0.015,
    flourishes: [{ kind: 'strike', probability: 0.95, intensity: 1 }],
    legibilityTag: 'gemengd', formalityTag: 4
  },
  {
    id: 'signatuur-3', collectionId: 'signatuur', fontId: 'herrVonMuellerhoff', label: 'Grote beginkrul',
    engine: 'stroke', strokeFontId: 'cursive', penWidthEm: 0.032, taper: 0.8, scribble: 0.6,
    baseSlantDeg: 6, firstLetterScale: 1.8, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'surnameInitial',
    strokeWidthEm: 0.01, baselineDriftEm: 0.018,
    flourishes: [{ kind: 'leadIn', probability: 0.85, intensity: 0.9 }, { kind: 'tail', probability: 0.7, intensity: 0.8 }],
    legibilityTag: 'abstract', formalityTag: 3
  },
  {
    id: 'signatuur-4', collectionId: 'signatuur', fontId: 'drSugiyama', label: 'Alleen achternaam',
    engine: 'stroke', strokeFontId: 'scripts', penWidthEm: 0.04, taper: 0.75, scribble: 0.75,
    baseSlantDeg: 14, firstLetterScale: 1.55, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'surnameOnly',
    strokeWidthEm: 0.016, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'strike', probability: 0.9, intensity: 0.95 }, { kind: 'tail', probability: 0.6, intensity: 0.9 }],
    legibilityTag: 'abstract', formalityTag: 3
  },

  // ─── Extra penlijn-stijlen (stroke-engine) verspreid over de collecties ───
  {
    id: 'elegant-5', collectionId: 'elegant', fontId: 'greatVibes', label: 'Koninklijke omcirkeling',
    engine: 'stroke', strokeFontId: 'scriptc', penWidthEm: 0.028, taper: 0.7, scribble: 0.15,
    baseSlantDeg: 7, firstLetterScale: 1.5, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.012, baselineDriftEm: 0.01,
    flourishes: [{ kind: 'ellipse', probability: 0.85, intensity: 0.85 }],
    legibilityTag: 'leesbaar', formalityTag: 4
  },
  {
    id: 'zakelijk-5', collectionId: 'zakelijk', fontId: 'dancingScript', label: 'Nette pen',
    engine: 'stroke', strokeFontId: 'scripts', penWidthEm: 0.03, taper: 0.65, scribble: 0.2,
    baseSlantDeg: 8, firstLetterScale: 1.4, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'initialSurname',
    strokeWidthEm: 0.012, baselineDriftEm: 0.008,
    flourishes: [{ kind: 'underline', probability: 0.85, intensity: 0.6 }],
    legibilityTag: 'leesbaar', formalityTag: 5
  },
  {
    id: 'klassiek-4', collectionId: 'klassiek', fontId: 'monsieurLaDoulaise', label: 'Omcirkelde achternaam',
    engine: 'stroke', strokeFontId: 'cursive', penWidthEm: 0.03, taper: 0.8, scribble: 0.4,
    baseSlantDeg: 6, firstLetterScale: 1.55, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'surnameOnly',
    strokeWidthEm: 0.01, baselineDriftEm: 0.012,
    flourishes: [{ kind: 'ellipse', probability: 0.9, intensity: 0.9 }],
    legibilityTag: 'gemengd', formalityTag: 4
  },
  {
    id: 'modern-5', collectionId: 'modern', fontId: 'yellowtail', label: 'Dikke penstreek',
    engine: 'stroke', strokeFontId: 'scripts', penWidthEm: 0.055, taper: 0.7, scribble: 0.35,
    baseSlantDeg: 10, firstLetterScale: 1.35, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'surnameOnly',
    strokeWidthEm: 0.02, baselineDriftEm: 0.012,
    flourishes: [{ kind: 'tail', probability: 0.6, intensity: 0.6 }],
    legibilityTag: 'gemengd', formalityTag: 2
  },
  {
    id: 'abstract-4', collectionId: 'abstract', fontId: 'qwigley', label: 'Volledig gekrabbeld',
    engine: 'stroke', strokeFontId: 'scripts', penWidthEm: 0.035, taper: 0.7, scribble: 0.9,
    baseSlantDeg: 16, firstLetterScale: 1.5, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'initialSurname',
    strokeWidthEm: 0.01, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'strike', probability: 0.9, intensity: 1 }],
    legibilityTag: 'abstract', formalityTag: 2
  },
  {
    id: 'abstract-5', collectionId: 'abstract', fontId: 'zeyada', label: 'Lange uithaal',
    engine: 'stroke', strokeFontId: 'scriptc', penWidthEm: 0.03, taper: 0.75, scribble: 0.7,
    baseSlantDeg: 12, firstLetterScale: 1.45, letterSpacingEm: 0, caseTransform: 'none',
    nameForm: 'surnameOnly',
    strokeWidthEm: 0.01, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'tail', probability: 1, intensity: 1 }],
    legibilityTag: 'abstract', formalityTag: 2
  },
  {
    id: 'artistiek-5', collectionId: 'artistiek', fontId: 'homemadeApple', label: 'Losse pols',
    engine: 'stroke', strokeFontId: 'cursive', penWidthEm: 0.033, taper: 0.85, scribble: 0.3,
    baseSlantDeg: 4, firstLetterScale: 1.3, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.012, baselineDriftEm: 0.02,
    flourishes: [{ kind: 'leadIn', probability: 0.7, intensity: 0.7 }, { kind: 'tail', probability: 0.7, intensity: 0.7 }],
    legibilityTag: 'gemengd', formalityTag: 2
  },

  // ─── Collectie 6: Artistiek ───
  {
    id: 'artistiek-1', collectionId: 'artistiek', fontId: 'homemadeApple', label: 'Echt handschrift',
    baseSlantDeg: 3, firstLetterScale: 1.15, letterSpacingEm: 0, caseTransform: 'none',
    strokeWidthEm: 0.012, baselineDriftEm: 0.03,
    flourishes: [{ kind: 'underline', probability: 0.4, intensity: 0.4 }],
    legibilityTag: 'leesbaar', formalityTag: 2
  },
  {
    id: 'artistiek-2', collectionId: 'artistiek', fontId: 'laBelleAurore', label: 'Lichte veer',
    baseSlantDeg: 5, firstLetterScale: 1.2, letterSpacingEm: 0.01, caseTransform: 'none',
    strokeWidthEm: 0.006, baselineDriftEm: 0.025,
    flourishes: [{ kind: 'tail', probability: 0.6, intensity: 0.5 }],
    legibilityTag: 'gemengd', formalityTag: 1
  },
  {
    id: 'artistiek-3', collectionId: 'artistiek', fontId: 'meddon', label: 'Bedachtzame pen',
    baseSlantDeg: 2, firstLetterScale: 1.25, letterSpacingEm: 0.005, caseTransform: 'none',
    strokeWidthEm: 0.008, baselineDriftEm: 0.012,
    flourishes: [{ kind: 'underline', probability: 0.5, intensity: 0.5 }],
    legibilityTag: 'leesbaar', formalityTag: 2
  },
  {
    id: 'artistiek-4', collectionId: 'artistiek', fontId: 'alexBrush', label: 'Penseelstreek',
    baseSlantDeg: 6, firstLetterScale: 1.35, letterSpacingEm: -0.005, caseTransform: 'none',
    strokeWidthEm: 0.014, baselineDriftEm: 0.012,
    flourishes: [{ kind: 'leadIn', probability: 0.6, intensity: 0.6 }, { kind: 'underline', probability: 0.6, intensity: 0.6 }],
    legibilityTag: 'gemengd', formalityTag: 3
  }
]

export const COLLECTIONS: Collection[] = [
  {
    id: 'signatuur', name: 'Collectie 7 · Signatuur',
    description: 'Zoals een échte handtekening: je achternaam met voorletter, of alleen je achternaam, met één krachtige streek.',
    cardBackground: 'linear-gradient(150deg, #ffffff 0%, #f8f7f3 60%, #eeece5 100%)',
    cardInk: '#141420',
    styleIds: ['signatuur-1', 'signatuur-2', 'signatuur-3', 'signatuur-4']
  },
  {
    id: 'elegant', name: 'Collectie 1 · Elegant',
    description: 'Sierlijke, vloeiende lijnen met een chique uitstraling.',
    cardBackground: 'linear-gradient(135deg, #f7f2e7 0%, #efe3c8 55%, #e2cf9f 100%)',
    cardInk: '#3a2f1b',
    styleIds: ['elegant-1', 'elegant-2', 'elegant-3', 'elegant-4', 'elegant-5']
  },
  {
    id: 'zakelijk', name: 'Collectie 2 · Zakelijk',
    description: 'Helder en zelfverzekerd, perfect voor contracten en documenten.',
    cardBackground: 'linear-gradient(135deg, #dfe7ef 0%, #b9c9da 55%, #8fa7be 100%)',
    cardInk: '#16283b',
    styleIds: ['zakelijk-1', 'zakelijk-2', 'zakelijk-3', 'zakelijk-4', 'zakelijk-5']
  },
  {
    id: 'klassiek', name: 'Collectie 3 · Klassiek',
    description: 'Tijdloze kalligrafie met grootse krullen en omcirkelingen.',
    cardBackground: 'linear-gradient(135deg, #f6e8d6 0%, #ecd4b4 50%, #ddba8e 100%)',
    cardInk: '#4a2e18',
    styleIds: ['klassiek-1', 'klassiek-2', 'klassiek-3', 'klassiek-4']
  },
  {
    id: 'modern', name: 'Collectie 4 · Modern',
    description: 'Strak, vlot en eigentijds — zonder franje.',
    cardBackground: 'linear-gradient(135deg, #ffffff 0%, #f2f4f6 60%, #e4e8ec 100%)',
    cardInk: '#1d232b',
    styleIds: ['modern-1', 'modern-2', 'modern-3', 'modern-4', 'modern-5']
  },
  {
    id: 'abstract', name: 'Collectie 5 · Abstract',
    description: 'Snelle parafen en initialen — niemand hoeft hem te kunnen lezen.',
    cardBackground: 'linear-gradient(135deg, #2b2f36 0%, #383e47 55%, #23272e 100%)',
    cardInk: '#f2f0ea',
    styleIds: ['abstract-1', 'abstract-2', 'abstract-3', 'abstract-4', 'abstract-5']
  },
  {
    id: 'artistiek', name: 'Collectie 6 · Artistiek',
    description: 'Persoonlijk en expressief, alsof het écht met de hand is geschreven.',
    cardBackground: 'linear-gradient(135deg, #e8d9c3 0%, #dcc6a5 55%, #cbaf87 100%)',
    cardInk: '#40301d',
    styleIds: ['artistiek-1', 'artistiek-2', 'artistiek-3', 'artistiek-4', 'artistiek-5']
  }
]

export function getStyle(id: string): SignatureStyle | undefined {
  return STYLES.find((s) => s.id === id)
}

export function getCollection(id: string): Collection | undefined {
  return COLLECTIONS.find((c) => c.id === id)
}
