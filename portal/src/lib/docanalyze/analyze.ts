import 'server-only'
import type { DocumentKind } from '@prisma/client'
import { prisma } from '@/lib/db'
import { extractText } from './extractText'
import { classifyText } from './classify'
import { DEFAULT_TEMPLATES, KIND_LABELS, renderTemplate, firstNameFrom, type TemplateText } from './templates'

/// Sjabloon voor een type: aangepaste versie uit de database, anders de standaard.
export async function getTemplate(kind: DocumentKind): Promise<TemplateText> {
  const row = await prisma.messageTemplate.findUnique({ where: { kind } })
  if (row) return { title: row.titleTemplate, body: row.bodyTemplate }
  return DEFAULT_TEMPLATES[kind]
}

export interface AnalyzeResult {
  kind: DocumentKind
  kindLabel: string
  year: number | null
  confidence: number
  recognized: boolean
  ocrUsed: boolean
  // Voorstel voor titel en bericht, met boekjaar/afzender al ingevuld en de
  // cliënt-invulvelden nog als token (die worden bij verzenden ingevuld).
  suggestedTitle: string
  suggestedBody: string
}

/// Herkent een geüpload document en stelt titel + begeleidend bericht voor.
export async function analyzeDocument(
  ext: string,
  bytes: Uint8Array,
  afzenderNaam: string
): Promise<AnalyzeResult> {
  const { text, ocrUsed } = await extractText(ext, bytes)
  const { kind, year, confidence } = classifyText(text)
  const recognized = kind !== 'OVERIG'
  const voornaamAfzender = firstNameFrom(afzenderNaam) ?? afzenderNaam.split(/\s+/)[0] ?? ''

  if (!recognized) {
    return {
      kind,
      kindLabel: KIND_LABELS[kind],
      year,
      confidence,
      recognized: false,
      ocrUsed,
      suggestedTitle: '',
      suggestedBody: ''
    }
  }

  const tpl = await getTemplate(kind)
  // Vul alvast boekjaar en afzender in; laat cliënt-velden als token staan.
  const partial = { boekjaar: year, voornaamAfzender }
  const suggestedTitle = renderKeepClientTokens(tpl.title, partial)
  const suggestedBody = renderKeepClientTokens(tpl.body, partial)

  return {
    kind,
    kindLabel: KIND_LABELS[kind],
    year,
    confidence,
    recognized: true,
    ocrUsed,
    suggestedTitle,
    suggestedBody
  }
}

// Vult alleen boekjaar en afzender in; {voornaam_klant}/{bedrijfsnaam} blijven
// staan zodat ze bij het verzenden per ontvanger worden ingevuld.
function renderKeepClientTokens(template: string, vars: { boekjaar: number | null; voornaamAfzender: string }): string {
  let out = template
    .replace(/\{boekjaar\}/g, vars.boekjaar != null ? String(vars.boekjaar) : '{boekjaar}')
    .replace(/\{voornaam_afzender\}/g, vars.voornaamAfzender || '{voornaam_afzender}')
  out = out.replace(/[ \t]{2,}/g, ' ').trim()
  return out
}

export { renderTemplate }
