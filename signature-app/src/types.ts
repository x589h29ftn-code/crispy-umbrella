export type Hand = 'links' | 'rechts'
export type Legibility = 'leesbaar' | 'gemengd' | 'abstract'
export type Phase = 'landing' | 'wizard' | 'collections' | 'results'

export interface WizardAnswers {
  fullName: string
  nameVariants: string[]
  hand: Hand
  age: '<25' | '25-40' | '41-60' | '60+'
  gender: 'man' | 'vrouw' | 'anders' | 'geen'
  frequency: 'dagelijks' | 'wekelijks' | 'zelden'
  legibility: Legibility
  formality: 1 | 2 | 3 | 4 | 5
  thickness: 1 | 2 | 3
  size: 1 | 2 | 3
  flourish: 1 | 2 | 3
  underline: 'ja' | 'nee' | 'verras'
  speed: 'netjes' | 'vlot'
  purpose: 'documenten' | 'creatief' | 'beide'
}

/** Afgeleid uit de wizard-antwoorden: de "basislijn" van de gebruiker die met
 *  elke stijl wordt gemengd. */
export interface GenerationParams {
  slantDeg: number
  strokeScale: number
  sizeScale: number
  jitter: number
  flourishIntensity: number
  underlineBias: number
  legibility: Legibility
}

export type FlourishKind = 'underline' | 'strike' | 'ellipse' | 'leadIn' | 'tail'

export interface FlourishSpec {
  kind: FlourishKind
  probability: number
  intensity: number
}

export interface SignatureStyle {
  id: string
  collectionId: string
  fontId: string
  label: string
  baseSlantDeg: number
  firstLetterScale: number
  letterSpacingEm: number
  caseTransform: 'none' | 'lower' | 'initialsOnly'
  /** Vaste naamvorm op basis van de achternaam (zoals "T. Baily", "Bankey F." of
   *  alleen "Tamsyn"); overschrijft de variant-keuze uit de wizard. */
  nameForm?: 'initialSurname' | 'surnameInitial' | 'surnameOnly'
  /** 'stroke' rendert als één doorlopende penlijn (Hershey-script) met
   *  pendynamiek i.p.v. gevulde font-glyphs. Default: 'font'. */
  engine?: 'font' | 'stroke'
  strokeFontId?: 'scripts' | 'cursive' | 'scriptc'
  /** Basis-pendikte t.o.v. fontSize (alleen stroke-engine). */
  penWidthEm?: number
  /** 0..1: letters krimpen richting het einde, zoals een echte handtekening. */
  taper?: number
  /** 0..1: mate waarin tussenletters degenereren tot golfjes (onleesbaar midden). */
  scribble?: number
  strokeWidthEm: number
  baselineDriftEm: number
  flourishes: FlourishSpec[]
  legibilityTag: Legibility
  formalityTag: 1 | 2 | 3 | 4 | 5
}

export interface Collection {
  id: string
  name: string
  description: string
  cardBackground: string
  cardInk: string
  styleIds: string[]
}

/** Fijnafstemming per gekozen handtekening (neutraal = 0 / 1). */
export interface SignatureTweaks {
  slant: number
  thickness: number
  flourish: number
  size: number
}

export interface GeneratedSignature {
  id: string
  styleId: string
  text: string
  seed: number
  tweaks?: SignatureTweaks
  ink?: string
}

export interface RenderPath {
  d: string
  fill?: string
  stroke?: string
  strokeWidth?: number
}

/** Eén logische tekenstap (voor het oefenblad): wat je in deze beweging
 *  tekent, met het punt waar de pen neerkomt en de beginrichting. */
export interface SignatureStep {
  label: string
  paths: RenderPath[]
  start?: [number, number]
  dir?: [number, number]
  /** Centerline die de pen aflegt (voor de teken-animatie): paddata, totale
   *  lengte en de maskerbreedte waarmee de inkt onthuld wordt. */
  guide?: { d: string; len: number; width: number }
}

/** Puur-data-resultaat van de engine; gedeeld door preview én export. */
export interface SignatureRender {
  paths: RenderPath[]
  viewBox: { x: number; y: number; w: number; h: number }
  /** Tekenstappen in schrijfvolgorde; cumulatief = het volledige beeld. */
  steps?: SignatureStep[]
}
