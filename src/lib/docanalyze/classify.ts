import type { DocumentKind } from '@prisma/client'

// Regelgebaseerde herkenning van het documenttype op basis van kernwoorden in
// de uitgelezen tekst. Transparant en zonder externe afhankelijkheid. Elk type
// heeft signalen met een gewicht; het type met de hoogste score boven de
// drempel wint. Specifieke typen wegen zwaarder dan het algemene "jaarrekening".

export interface Classification {
  kind: DocumentKind
  year: number | null
  confidence: number // 0..1, ruwe indicatie
}

interface Rule {
  kind: DocumentKind
  signals: { re: RegExp; weight: number }[]
}

const RULES: Rule[] = [
  {
    kind: 'AKKOORD_IB',
    signals: [
      { re: /akkoordverklaring/, weight: 2 },
      { re: /\bakkoord\b/, weight: 1 },
      { re: /inkomstenbelasting/, weight: 3 },
      { re: /aangifte\s+ib\b/, weight: 3 }
    ]
  },
  {
    kind: 'AKKOORD_VPB',
    signals: [
      { re: /akkoordverklaring/, weight: 2 },
      { re: /\bakkoord\b/, weight: 1 },
      { re: /vennootschapsbelasting/, weight: 3 },
      { re: /aangifte\s+vpb\b/, weight: 3 }
    ]
  },
  {
    kind: 'BEVESTIGING_JAARREKENING',
    signals: [
      { re: /bevestiging\s+bij\s+de\s+jaarrekening/, weight: 5 },
      { re: /bevestigingsbrief/, weight: 4 },
      { re: /volledigheidsverklaring/, weight: 4 },
      { re: /\bbevestiging\b/, weight: 1 }
    ]
  },
  {
    kind: 'NOTULEN_AVA',
    signals: [
      { re: /notulen/, weight: 3 },
      { re: /aandeelhouders?vergadering/, weight: 3 },
      { re: /algemene\s+vergadering(\s+van\s+aandeelhouders)?/, weight: 3 },
      { re: /\bava\b/, weight: 2 }
    ]
  },
  {
    kind: 'OPDRACHTBEVESTIGING',
    signals: [
      { re: /opdrachtbevestiging/, weight: 5 },
      { re: /opdracht\s+tot\s+het\s+samenstellen/, weight: 4 },
      { re: /opdrachtvoorwaarden/, weight: 2 }
    ]
  },
  {
    kind: 'JAARREKENING',
    signals: [
      { re: /jaarrekening/, weight: 3 },
      { re: /winst-?\s*en\s*verliesrekening/, weight: 2 },
      { re: /\bbalans\b/, weight: 1 },
      { re: /samenstellingsverklaring/, weight: 1 },
      { re: /toelichting\s+op\s+de\s+balans/, weight: 1 }
    ]
  }
]

// Voor NOTULEN_AVA en BEVESTIGING is minstens één sterk signaal nodig,
// anders zou een losse verwijzing al voldoende zijn.
const MIN_SCORE = 3

/// Haalt het meest waarschijnlijke boekjaar uit de tekst. Kiest het hoogste
/// plausibele jaartal (niet in de verre toekomst).
export function extractYear(text: string, now = new Date().getFullYear()): number | null {
  const years = new Set<number>()
  // Eerst jaartallen dicht bij relevante woorden (hoger vertrouwen).
  const near = text.match(/(?:boekjaar|jaarrekening|over het jaar|belastingjaar)[^0-9]{0,20}(19|20)\d{2}/g) ?? []
  for (const m of near) {
    const y = Number(m.match(/(19|20)\d{2}/)![0])
    years.add(y)
  }
  if (years.size === 0) {
    for (const m of text.match(/\b(19|20)\d{2}\b/g) ?? []) years.add(Number(m))
  }
  const plausible = [...years].filter((y) => y >= 1990 && y <= now + 1)
  if (plausible.length === 0) return null
  return Math.max(...plausible)
}

/// Bepaalt het documenttype uit de tekst.
export function classifyText(rawText: string): Classification {
  const text = rawText.toLowerCase().replace(/\s+/g, ' ')
  if (text.trim().length < 20) return { kind: 'OVERIG', year: null, confidence: 0 }

  let best: { kind: DocumentKind; score: number } = { kind: 'OVERIG', score: 0 }
  for (const rule of RULES) {
    let score = 0
    for (const s of rule.signals) if (s.re.test(text)) score += s.weight
    if (score > best.score) best = { kind: rule.kind, score }
  }

  if (best.score < MIN_SCORE) return { kind: 'OVERIG', year: extractYear(text), confidence: 0.2 }
  // Ruwe vertrouwensindicatie: schaal de score naar 0..1.
  const confidence = Math.min(1, best.score / 6)
  return { kind: best.kind, year: extractYear(text), confidence }
}
