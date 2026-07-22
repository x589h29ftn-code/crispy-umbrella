// Ondertekendashboard — datamodel, opslag en PDF-hulpfuncties.
//
// Offline/gratis opzet: dossiers en de bijbehorende PDF's worden bewaard in de
// gedeelde sjablonenbibliotheekmap (via de signing:*-IPC), met een
// localStorage-fallback voor de web-/testomgeving. Zelf tekenen zet een
// zichtbare handtekening in de PDF en (optioneel) een cryptografische
// PAdES-handtekening; de tweede partij tekent via een e-mailronde en het
// getekende bestand wordt teruggeïmporteerd.
import { nanoid } from 'nanoid'

export type SignMethod = 'image' | 'pades' | 'both'
export type PartyRole = 'self' | 'other'
export type PartyStatus = 'pending' | 'signed' | 'declined'
export type DossierStatus = 'concept' | 'verzonden' | 'gedeeltelijk' | 'ondertekend'
export type SignEventType =
  | 'aangemaakt'
  | 'zelf-getekend'
  | 'verzonden'
  | 'herinnering'
  | 'geimporteerd'
  | 'afgerond'

/** Tekenvak in PDF-punten met pivot linksonder (pdf-lib-conventie). */
export interface SignPlacement {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface SignParty {
  id: string
  name: string
  email?: string
  role: PartyRole
  placement: SignPlacement
  status: PartyStatus
  signedAt?: number
}

export interface SigningEvent {
  when: number
  type: SignEventType
  note?: string
}

export interface SigningDossier {
  id: string
  title: string
  fileName: string
  createdAt: number
  createdBy?: string
  status: DossierStatus
  parties: SignParty[]
  events: SigningEvent[]
  method: SignMethod
  lastSentAt?: number
  lastReminderAt?: number
  /** Gereserveerd voor een toekomstig online tekenportaal. */
  portalRef?: string
}

const LS_INDEX = 'pdf-studio-signing-dossiers'
const LS_DOC_PREFIX = 'pdf-studio-signing-doc-'

function hasDesktopStore(): boolean {
  return typeof window.api?.signingList === 'function'
}

// ---- Dossier-index ----

export async function listDossiers(): Promise<SigningDossier[]> {
  if (hasDesktopStore()) {
    try {
      return ((await window.api.signingList!()) as SigningDossier[]) ?? []
    } catch {
      return []
    }
  }
  try {
    return JSON.parse(window.localStorage.getItem(LS_INDEX) ?? '[]')
  } catch {
    return []
  }
}

export async function saveDossier(dossier: SigningDossier): Promise<void> {
  if (hasDesktopStore()) {
    await window.api.signingSaveDossier!(JSON.stringify(dossier))
    return
  }
  const list = await listDossiers()
  const idx = list.findIndex((d) => d.id === dossier.id)
  if (idx >= 0) list[idx] = dossier
  else list.unshift(dossier)
  window.localStorage.setItem(LS_INDEX, JSON.stringify(list))
}

export async function deleteDossier(id: string): Promise<void> {
  if (hasDesktopStore()) {
    await window.api.signingDeleteDossier!(id)
    return
  }
  const list = (await listDossiers()).filter((d) => d.id !== id)
  window.localStorage.setItem(LS_INDEX, JSON.stringify(list))
  window.localStorage.removeItem(LS_DOC_PREFIX + id + '-orig')
  window.localStorage.removeItem(LS_DOC_PREFIX + id + '-signed')
}

// ---- PDF-blobs (origineel + laatst getekend) ----

function bytesToB64(data: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < data.length; i += 1) bin += String.fromCharCode(data[i])
  return btoa(bin)
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

export async function saveDoc(id: string, kind: 'orig' | 'signed', data: Uint8Array): Promise<void> {
  if (hasDesktopStore()) {
    await window.api.signingSaveDoc!(id, kind, data)
    return
  }
  window.localStorage.setItem(LS_DOC_PREFIX + id + '-' + kind, bytesToB64(data))
}

export async function loadDoc(id: string, kind: 'orig' | 'signed'): Promise<Uint8Array | null> {
  if (hasDesktopStore()) {
    const data = await window.api.signingLoadDoc!(id, kind)
    return data ? new Uint8Array(data) : null
  }
  const b64 = window.localStorage.getItem(LS_DOC_PREFIX + id + '-' + kind)
  return b64 ? b64ToBytes(b64) : null
}

// ---- Status + gebeurtenissen ----

export function recomputeStatus(dossier: SigningDossier): DossierStatus {
  const total = dossier.parties.length
  const signed = dossier.parties.filter((p) => p.status === 'signed').length
  if (total > 0 && signed === total) return 'ondertekend'
  if (signed > 0) return 'gedeeltelijk'
  if (dossier.lastSentAt) return 'verzonden'
  return 'concept'
}

export function logEvent(dossier: SigningDossier, type: SignEventType, note?: string): void {
  dossier.events.unshift({ when: Date.now(), type, note })
}

export const STATUS_LABEL: Record<DossierStatus, string> = {
  concept: 'Concept',
  verzonden: 'Verzonden',
  gedeeltelijk: 'Gedeeltelijk',
  ondertekend: 'Ondertekend'
}

// ---- Nieuw dossier ----

export function newDossier(input: {
  title: string
  fileName: string
  method: SignMethod
  parties: SignParty[]
  createdBy?: string
}): SigningDossier {
  const dossier: SigningDossier = {
    id: nanoid(),
    title: input.title,
    fileName: input.fileName,
    createdAt: Date.now(),
    createdBy: input.createdBy,
    status: 'concept',
    parties: input.parties,
    events: [],
    method: input.method
  }
  logEvent(dossier, 'aangemaakt')
  return dossier
}

export function makeParty(input: {
  name: string
  email?: string
  role: PartyRole
  placement: SignPlacement
}): SignParty {
  return { id: nanoid(), name: input.name, email: input.email, role: input.role, placement: input.placement, status: 'pending' }
}

// ---- Zichtbare handtekening in de PDF stempelen ----

/**
 * Tekent een handtekening-afbeelding (data-URL) in de PDF op het opgegeven
 * tekenvak (PDF-punten, pivot linksonder). Geeft nieuwe PDF-bytes terug.
 */
export async function stampSignatureImage(
  pdfBytes: Uint8Array,
  placement: SignPlacement,
  imageDataUrl: string
): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true })
  const pages = doc.getPages()
  const page = pages[placement.page] ?? pages[0]
  const isJpg = /^data:image\/jpe?g/i.test(imageDataUrl)
  const bytes = b64ToBytes(imageDataUrl.split(',')[1] ?? '')
  const img = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
  page.drawImage(img, {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height
  })
  return doc.save()
}

/**
 * Bouwt de PDF die naar een tweede partij wordt gestuurd: op elk tekenvak van
 * een externe partij komt een zichtbaar kader met de (vooraf ingevulde)
 * klantnaam én een écht interactief handtekeningveld (AcroForm /Sig-widget).
 * De ontvanger opent het in Adobe Reader, klikt op het veld en ondertekent.
 */
export async function buildSignatureRequestPdf(
  pdfBytes: Uint8Array,
  parties: SignParty[]
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, PDFName, PDFNumber, PDFString } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages = doc.getPages()
  const form = doc.getForm()
  const ctx = doc.context
  const accent = rgb(0.11, 0.35, 0.82)
  const targets = parties.filter((p) => p.role === 'other' && p.status !== 'signed')

  targets.forEach((party, idx) => {
    const page = pages[party.placement.page] ?? pages[0]
    const { x, y, width, height } = party.placement
    // Zichtbaar kader + labels (ook leesbaar in viewers zonder formulieren).
    page.drawRectangle({
      x,
      y,
      width,
      height,
      borderColor: accent,
      borderWidth: 1.2,
      color: rgb(0.95, 0.97, 1)
    })
    const label = party.name ? `Handtekening — ${party.name}` : 'Handtekening'
    page.drawText(label.slice(0, 48), {
      x: x + 6,
      y: y + height - 13,
      size: 8,
      font: fontBold,
      color: accent
    })
    page.drawText('Klik hier om te ondertekenen (Adobe Reader)', {
      x: x + 6,
      y: y + 6,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.4)
    })

    // Interactief, nog niet ondertekend handtekeningveld.
    const fieldName = `Handtekening_${idx + 1}_${(party.name || 'partij').replace(/[^\w]/g, '_').slice(0, 20)}`
    const sigDict = ctx.obj({
      FT: PDFName.of('Sig'),
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      T: PDFString.of(fieldName),
      F: PDFNumber.of(4),
      Rect: ctx.obj([x, y, x + width, y + height]),
      P: page.ref
    })
    const sigRef = ctx.register(sigDict)
    page.node.addAnnot(sigRef)
    form.acroForm.addField(sigRef)
  })

  if (targets.length) {
    // SigFlags 3 = document bevat handtekeningvelden en mag alleen als
    // toevoeging (incremental) worden opgeslagen — zo herkent Adobe ze.
    form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3))
  }
  return doc.save()
}

// ---- Coördinaatomrekening tekenvak → PDF-punten ----

/**
 * Rekent een rechthoek die op de gerenderde voorbeeld-afbeelding (pixels,
 * pivot linksboven) is getekend om naar PDF-punten (pivot linksonder).
 */
export function pixelRectToPlacement(
  rectPx: { left: number; top: number; width: number; height: number },
  preview: { pdfWidth: number; pdfHeight: number; pxWidth: number; pxHeight: number },
  page: number
): SignPlacement {
  const sx = preview.pdfWidth / preview.pxWidth
  const sy = preview.pdfHeight / preview.pxHeight
  return {
    page,
    x: rectPx.left * sx,
    y: preview.pdfHeight - (rectPx.top + rectPx.height) * sy,
    width: rectPx.width * sx,
    height: rectPx.height * sy
  }
}

// ---- Certificaat-wrappers ----

export async function certStatus(): Promise<{
  exists: boolean
  subject?: string
  validTo?: number
  isSelfSigned?: boolean
}> {
  if (typeof window.api?.signingCertStatus === 'function') {
    try {
      return await window.api.signingCertStatus()
    } catch {
      return { exists: false }
    }
  }
  return { exists: false }
}

export async function createSelfCert(name: string, org?: string): ReturnType<NonNullable<typeof window.api.signingCreateSelfCert>> {
  if (typeof window.api?.signingCreateSelfCert === 'function') {
    return window.api.signingCreateSelfCert(name, org)
  }
  return { ok: false, error: 'Digitaal ondertekenen werkt alleen in de desktop-app.' }
}

export async function signPades(
  data: Uint8Array,
  opts: { reason?: string; name?: string; location?: string; contactInfo?: string }
): Promise<{ ok: boolean; data?: Uint8Array; error?: string }> {
  if (typeof window.api?.signingSignPades === 'function') {
    return window.api.signingSignPades(data, opts)
  }
  return { ok: false, error: 'Digitaal ondertekenen werkt alleen in de desktop-app.' }
}

// ---- E-mail (via Outlook) ----

export async function mailDocument(
  fileName: string,
  data: Uint8Array,
  opts: { to?: string; subject?: string; body?: string }
): Promise<{ ok: boolean; fallback?: boolean }> {
  if (typeof window.api?.mailPdf === 'function') {
    return window.api.mailPdf(fileName, data, opts)
  }
  return { ok: false }
}

/** Standaard-e-mailtekst voor een ondertekenverzoek. */
export function buildRequestEmail(dossier: SigningDossier, party: SignParty, senderName?: string): {
  subject: string
  body: string
} {
  const groet = party.name ? `Beste ${party.name},` : 'Beste,'
  return {
    subject: `Ondertekening gevraagd: ${dossier.title}`,
    body: [
      groet,
      '',
      `Bijgaand ontvangt u "${dossier.fileName}" ter ondertekening.`,
      'In het document staat een blauw gemarkeerd handtekeningveld op de plek waar uw handtekening hoort.',
      '',
      'Zo ondertekent u:',
      '1. Open de bijlage in Adobe Acrobat Reader (gratis).',
      '2. Klik op het blauwe handtekeningveld; Adobe helpt u zo nodig gratis een digitale ID aan te maken.',
      '3. Sla het ondertekende document op en stuur het per e-mail retour.',
      '',
      'Met vriendelijke groet,',
      senderName || ''
    ].join('\n')
  }
}

/** Standaard-e-mailtekst voor een herinnering. */
export function buildReminderEmail(dossier: SigningDossier, party: SignParty, senderName?: string): {
  subject: string
  body: string
} {
  const groet = party.name ? `Beste ${party.name},` : 'Beste,'
  return {
    subject: `Herinnering: ondertekening ${dossier.title}`,
    body: [
      groet,
      '',
      `Eerder stuurde ik u "${dossier.fileName}" ter ondertekening.`,
      'Mocht dit aan uw aandacht zijn ontsnapt, dan verzoek ik u vriendelijk het document alsnog te ondertekenen en te retourneren.',
      '',
      'Met vriendelijke groet,',
      senderName || ''
    ].join('\n')
  }
}

/** Aantal hele dagen sinds een tijdstip. */
export function daysSince(when: number): number {
  return Math.floor((Date.now() - when) / 86400000)
}
