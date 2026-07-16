import type { Collection, GenerationParams, SignatureStyle, WizardAnswers } from '../types'
import { COLLECTIONS, STYLES } from '../data/collections'
import { DEFAULT_PARAMS } from './compose'
import { mulberry32, hashString } from './random'

/** Vertaalt de wizard-antwoorden naar de generatieparameters van de gebruiker. */
export function deriveParams(answers: Partial<WizardAnswers>): GenerationParams {
  const p = { ...DEFAULT_PARAMS }
  const rng = mulberry32(hashString(answers.fullName ?? ''))

  if (answers.hand === 'links') p.slantDeg = -4 + rng() * 6
  else p.slantDeg = 6 + rng() * 8

  if (answers.thickness) p.strokeScale = [0.7, 1, 1.4][answers.thickness - 1]
  if (answers.size) p.sizeScale = [0.8, 1, 1.2][answers.size - 1]
  if (answers.speed) p.jitter = answers.speed === 'netjes' ? 0.15 : 0.7
  if (answers.flourish) p.flourishIntensity = [0.2, 0.6, 1][answers.flourish - 1]
  // Wie dagelijks tekent, wil een snelle handtekening: minder zwier.
  if (answers.frequency === 'dagelijks') p.flourishIntensity = Math.min(p.flourishIntensity, 0.6)
  if (answers.underline === 'ja') p.underlineBias = 1.6
  else if (answers.underline === 'nee') p.underlineBias = 0
  if (answers.legibility) p.legibility = answers.legibility

  return p
}

/** Score van een stijl t.o.v. de antwoorden; hoger = beter passend. */
export function scoreStyle(style: SignatureStyle, answers: Partial<WizardAnswers>): number {
  let score = 0
  if (answers.formality) score -= Math.abs(style.formalityTag - answers.formality)
  if (answers.legibility) {
    if (style.legibilityTag === answers.legibility) score += 2
    else if (style.legibilityTag === 'gemengd' || answers.legibility === 'gemengd') score += 0.5
  }
  if (answers.age === '60+' && style.formalityTag >= 4) score += 0.5
  if (answers.age === '<25' && style.collectionId === 'modern') score += 0.5
  if (answers.gender === 'vrouw' && (style.collectionId === 'elegant' || style.collectionId === 'artistiek')) score += 0.25
  if (answers.gender === 'man' && (style.collectionId === 'zakelijk' || style.collectionId === 'abstract')) score += 0.25
  return score
}

/** Collecties gesorteerd op hun best passende stijl (beste eerst). */
export function sortedCollections(answers: Partial<WizardAnswers>): Collection[] {
  const best = (c: Collection) =>
    Math.max(...STYLES.filter((s) => s.collectionId === c.id).map((s) => scoreStyle(s, answers)))
  return [...COLLECTIONS].sort((a, b) => best(b) - best(a))
}

/** Best passende naamvariant voor een stijl: abstracte stijlen krijgen een
 *  korte variant, leesbare stijlen een voluit geschreven naam. */
export function pickVariant(style: SignatureStyle, answers: Partial<WizardAnswers>): string {
  const variants = answers.nameVariants?.length
    ? answers.nameVariants
    : [answers.fullName ?? 'Voorbeeld']
  const byLength = [...variants].sort((a, b) => a.length - b.length)
  if (style.caseTransform === 'initialsOnly') {
    // Initialen komen uit de variant met de meeste woorden ("Mark de Visser" → MdV);
    // een reeds korte variant als "MV" blijft dan vanzelf buiten beeld.
    const byWords = [...variants].sort(
      (a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length
    )
    return byWords[0]
  }
  if (style.legibilityTag === 'abstract') return byLength[Math.min(1, byLength.length - 1)]
  return byLength[byLength.length - 1]
}
