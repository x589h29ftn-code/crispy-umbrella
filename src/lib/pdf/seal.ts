import { createHash } from 'node:crypto'

// Verzegelt de definitieve PDF: berekent de SHA-256-hash en voegt een
// Nederlands auditcertificaat als extra pagina toe. Zo is elke latere
// byte-wijziging aantoonbaar en staat het bewijs in het document zelf.
//
// Het certificaat moet op zichzelf te lezen zijn. Iemand die over vijf jaar
// alleen dit PDF-bestand in handen krijgt — zonder toegang tot het portaal —
// moet kunnen zien wie er tekende, wanneer, vanaf welk apparaat, en of het
// bestand sindsdien is gewijzigd. Alles wat daarvoor nodig is staat dus op het
// blad zelf en niet alleen in de database.

/** Alle tijden op het certificaat staan in Nederlandse tijd. */
const TIJDZONE = 'Europe/Amsterdam'

export interface SealSigner {
  name: string
  email: string
  /** IP en apparaat op het moment van ondertekenen (uit het auditspoor). */
  ip?: string | null
  userAgent?: string | null
  /** Wanneer de uitnodiging naar deze persoon is verstuurd. */
  sentAt?: Date | null
  /** Wanneer deze persoon het document voor het eerst opende. */
  openedAt?: Date | null
  otpVerifiedAt?: Date | null
  /** Kantoorondertekenaar: moment van herverificatie met een verse TOTP-code. */
  reauthVerifiedAt?: Date | null
  signedAt?: Date | null
  /** Hoe de identiteit is gecontroleerd; bepaalt de tekst op het certificaat. */
  verification?: 'EMAIL' | 'SMS' | 'KANTOOR' | null
  /** Hash per document van de bytes die déze ondertekenaar te zien kreeg. */
  presentedHashes?: Record<string, string> | null
  /** Letterlijke instemmingstekst zoals die op het scherm stond. */
  consentTextSnapshot?: string | null
  consentShownAt?: Date | null
}

export interface SealInput {
  pdfBytes: Uint8Array
  dossierTitle: string
  dossierId: string
  /** Staat de cryptografische verzegeling aan? Zo niet, dan zegt het certificaat dat. */
  sealed?: boolean
  /** Nodig om per ondertekenaar de juiste getoonde hash te kunnen tonen. */
  documentId?: string
  /** Aantal velden in dít document, zodat het certificaat het stuk beschrijft
   *  waar het aan vastzit. Een certificaat dat "3 pagina's, 2 handtekeningvelden"
   *  zegt terwijl er iets anders onder ligt, valt op. */
  fieldCounts?: { signature: number; initials: number; date: number }
  signers: SealSigner[]
}

export interface SealResult {
  sealedBytes: Uint8Array
  sha256: string
}

const NL = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: TIJDZONE
})

function fmt(d?: Date | null): string {
  // nl-NL zet er een komma tussen datum en tijd; als tijdstempel leest het
  // prettiger zonder.
  return d ? NL.format(d).replace(', ', ' ') : '-'
}

/**
 * Korte, leesbare samenvatting van het apparaat. De volledige user-agent staat
 * er daarnaast voluit bij: die is het forensische gegeven, dit is de regel waar
 * een mens iets aan heeft.
 */
function deviceSummary(ua?: string | null): string {
  if (!ua) return 'onbekend'
  const mobiel = /Mobile|Android|iPhone|iPad|iPod/i.test(ua)
  const os = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'onbekend besturingssysteem'
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\//i.test(ua)
      ? 'Opera'
      : /Chrome\//i.test(ua)
        ? 'Chrome'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : 'onbekende browser'
  return `${mobiel ? 'mobiel apparaat' : 'computer'}, ${os}, ${browser}`
}

/**
 * De UTC-afwijking die op dát moment gold, bijv. "UTC+02:00". Nederland kent
 * zomer- en wintertijd, dus de afwijking hoort bij een tijdstip en niet bij het
 * document. Zonder deze regel is "12:24:59" onbruikbaar zodra iemand het naast
 * een logregel uit een ander systeem legt.
 */
function utcOffset(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIJDZONE,
    timeZoneName: 'longOffset'
  }).formatToParts(d)
  const zone = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  return zone.replace('GMT', 'UTC')
}

/** Beschrijft in gewone taal welke identiteitscontrole is uitgevoerd. */
function verificationText(v: SealSigner['verification']): string {
  switch (v) {
    case 'SMS':
      return 'e-mailadres bevestigd door het kantoor; verificatiecode per sms naar het opgegeven nummer'
    case 'KANTOOR':
      return (
        'medewerker van het kantoor, ingelogd met wachtwoord en tweefactorauthenticatie, ' +
        'plus een verse verificatiecode op het moment van ondertekenen'
      )
    case 'EMAIL':
    default:
      return 'e-mailadres bevestigd door het kantoor; verificatiecode per e-mail naar dat adres'
  }
}

export async function sealDocument(input: SealInput): Promise<SealResult> {
  const { PDFDocument, StandardFonts, rgb, PDFName } = await import('@cantoo/pdf-lib')
  // Hash over de volledig ondertekende inhoud, vóór het certificaat wordt
  // toegevoegd. Zo is de vingerafdruk reproduceerbaar te verifiëren.
  const sha256 = createHash('sha256').update(Buffer.from(input.pdfBytes)).digest('hex')
  const doc = await PDFDocument.load(Uint8Array.from(input.pdfBytes), { ignoreEncryption: true })
  // Tellen vóórdat het certificaat erbij komt: dit is de omvang van het stuk
  // zelf, niet van het stuk plus zijn eigen bijlage.
  const inhoudPaginas = doc.getPageCount()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const A4: [number, number] = [595.28, 841.89]
  let page = doc.addPage(A4)
  const { width, height } = page.getSize()
  const margin = 48
  const accent = rgb(0.11, 0.3, 0.85)
  const grey = rgb(0.35, 0.35, 0.4)
  let y = height - margin

  /** Begint een nieuwe pagina zodra er te weinig ruimte over is. */
  const ensure = (needed: number) => {
    if (y - needed >= margin) return
    page = doc.addPage(A4)
    y = height - margin
  }

  /**
   * Breekt tekst op woordgrenzen binnen de beschikbare breedte, zonder te
   * tekenen. Apart van `paragraph` zodat de hoogte van een blok vooraf te meten
   * is; zie de reservering bij "Integriteit".
   *
   * Woorden die zelf al te breed zijn (een lang e-mailadres, een user-agent
   * zonder spaties) worden hard doorgeknipt. Anders zou zo'n woord alsnog van de
   * pagina aflopen, en `drawText` kapt niets af: het verdwijnt gewoon buiten het
   * blad zonder dat er iets van te zien is.
   */
  const wrapLines = (text: string, size: number, indent = 0, f: typeof font = font): string[] => {
    const maxWidth = width - 2 * margin - indent
    const out: string[] = []
    const woorden: string[] = []
    for (const woord of text.split(/\s+/).filter(Boolean)) {
      if (f.widthOfTextAtSize(woord, size) <= maxWidth) {
        woorden.push(woord)
        continue
      }
      let rest = woord
      while (rest && f.widthOfTextAtSize(rest, size) > maxWidth) {
        let n = rest.length
        while (n > 1 && f.widthOfTextAtSize(rest.slice(0, n), size) > maxWidth) n--
        woorden.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      if (rest) woorden.push(rest)
    }
    let current = ''
    for (const word of woorden) {
      const candidate = current ? `${current} ${word}` : word
      if (f.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        out.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) out.push(current)
    return out
  }

  /**
   * Eén regel, of meer als hij niet past. Ook hier moet worden afgebroken: een
   * lange dossiertitel of een lange naam-met-e-mailadres liep anders van de
   * pagina af, en dan mist er tekst op het bewijsstuk zonder dat dat opvalt.
   */
  const line = (text: string, opts?: { size?: number; f?: typeof font; color?: typeof grey; gap?: number }) => {
    const size = opts?.size ?? 10
    const gap = opts?.gap ?? size + 6
    const f = opts?.f ?? font
    for (const regel of wrapLines(text, size, 0, f)) {
      ensure(gap)
      page.drawText(regel, { x: margin, y, size, font: f, color: opts?.color ?? rgb(0.1, 0.1, 0.12) })
      y -= gap
    }
  }

  /** Breekt lange tekst af op woordgrenzen binnen de beschikbare breedte. */
  const paragraph = (text: string, opts?: { size?: number; indent?: number }) => {
    const size = opts?.size ?? 9
    const indent = opts?.indent ?? 0
    for (const regel of wrapLines(text, size, indent)) {
      ensure(size + 3)
      page.drawText(regel, { x: margin + indent, y, size, font, color: grey })
      y -= size + 3
    }
  }

  /** Hoogte van een paragraaf, om vooraf ruimte te kunnen reserveren. */
  const paragraphHeight = (text: string, size = 9, indent = 0) =>
    wrapLines(text, size, indent).length * (size + 3)

  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: accent })
  line('Ondertekencertificaat', { size: 20, f: bold, gap: 30 })
  line('Otto Visser & Partners - Ondertekenportaal', { size: 10, color: grey, gap: 24 })

  line('Document', { size: 12, f: bold, gap: 18 })
  line(`Titel: ${input.dossierTitle}`)
  line(`Dossierkenmerk: ${input.dossierId}`)
  // Beschrijft het stuk waar dit certificaat aan vastzit.
  const fc = input.fieldCounts
  const velden: string[] = []
  if (fc?.signature) velden.push(`${fc.signature} handtekeningveld${fc.signature === 1 ? '' : 'en'}`)
  if (fc?.initials) velden.push(`${fc.initials} paraafveld${fc.initials === 1 ? '' : 'en'}`)
  if (fc?.date) velden.push(`${fc.date} datumveld${fc.date === 1 ? '' : 'en'}`)
  line(
    `Omvang: ${inhoudPaginas} pagina${inhoudPaginas === 1 ? '' : "'s"}` +
      (velden.length ? `, ${velden.join(', ')}` : '') +
      ` (exclusief dit certificaat)`
  )
  line(`Ondertekenaars: ${input.signers.length}`, { gap: 14 })
  paragraph(
    `Alle tijdstippen staan in Nederlandse tijd (${TIJDZONE}), met de zomer- of wintertijd ` +
      `zoals die op dat moment gold.`
  )
  y -= 12

  line('Ondertekenaars', { size: 12, f: bold, gap: 18 })
  input.signers.forEach((s, i) => {
    ensure(120)
    line(`${i + 1}. ${s.name}  <${s.email}>`, { f: bold, size: 11 })
    // De volgorde van de gebeurtenissen, zodat de doorlooptijd tussen ontvangen
    // en tekenen op het blad zelf te zien is. Dat is precies wat je nodig hebt
    // als iemand later zegt dat hij het nooit heeft gekregen.
    line(`    Uitnodiging verstuurd: ${fmt(s.sentAt)}`, { size: 9, color: grey })
    line(`    Voor het eerst geopend: ${fmt(s.openedAt)}`, { size: 9, color: grey })
    if (s.verification === 'KANTOOR') {
      line(`    Herverificatie bij ondertekenen: ${fmt(s.reauthVerifiedAt)}`, { size: 9, color: grey })
    } else {
      line(`    Verificatiecode ingevoerd: ${fmt(s.otpVerifiedAt)}`, { size: 9, color: grey })
    }
    line(`    Ondertekend: ${fmt(s.signedAt)}`, { size: 9, color: grey })
    // Afgebroken op woordgrenzen: de omschrijving voor een kantoorondertekening
    // is langer dan één regel en werd anders bij de paginarand afgekapt
    // ("... op het moment van"), precies midden in wat er is gecontroleerd.
    line('    Identiteitscontrole:', { size: 8, color: grey, gap: 11 })
    paragraph(verificationText(s.verification), { size: 8, indent: 16 })
    line(`    IP-adres bij ondertekenen: ${s.ip ?? '-'}`, { size: 9, color: grey })
    line(`    Apparaat: ${deviceSummary(s.userAgent)}`, { size: 9, color: grey })
    // Voluit en afgebroken op woordgrenzen. Een harde afkap op tekenlengte sneed
    // juist het informatieve deel eraf ("... Chrome/139.0 S").
    if (s.userAgent) {
      line('    Browserkenmerk:', { size: 8, color: grey, gap: 11 })
      paragraph(s.userAgent, { size: 8, indent: 16 })
    }
    // Welke bytes deze ondertekenaar te zien kreeg (kan per persoon verschillen
    // wanneer er één voor één wordt ondertekend).
    const shown = input.documentId ? s.presentedHashes?.[input.documentId] : undefined
    if (shown) {
      line(`    Versie die deze persoon zag (SHA-256): ${shown.slice(0, 32)}`, { size: 8, color: grey })
      line(`    ${shown.slice(32)}`, { size: 8, color: grey })
    }
    if (s.consentTextSnapshot) {
      line(`    Gelezen verklaring op ${fmt(s.consentShownAt)}:`, { size: 8, color: grey, gap: 11 })
      paragraph(`"${s.consentTextSnapshot}"`, { size: 8, indent: 16 })
    }
    y -= 8
  })

  y -= 8

  const integriteitUitleg =
    'Onderstaande SHA-256-vingerafdruk is berekend over de ondertekende documentinhoud ' +
    '(vóór dit certificaat). Elke wijziging maakt deze ongeldig. Staat er een digitaal ' +
    'zegel in dit document, dan controleert uw PDF-lezer de integriteit automatisch en ' +
    'geldt het tijdstip uit de tijdstempeldienst als het moment van verzegeling.'
  const hashUitleg =
    'Let op: de vingerafdruk die per ondertekenaar is vermeld, hoort bij de versie die ' +
    'díe persoon op het scherm zag. Bij ondertekenen op volgorde verschilt die per ' +
    'persoon en wijkt hij dus af van de vingerafdruk van dit eindbestand. Dat is geen ' +
    'aanwijzing dat er iets is gewijzigd.'
  const geenZegelUitleg =
    'Er staat geen digitaal zegel in dit bestand. De echtheid is daarom niet automatisch ' +
    'door uw PDF-lezer te controleren; alleen bovenstaande vingerafdruk en dit certificaat ' +
    'leggen de inhoud vast.'

  // Het hele integriteitsblok hoort bij elkaar: de kop, de uitleg, de
  // vingerafdruk, het moment van opmaak en de eventuele waarschuwing. Eerder
  // stond hier alleen een reservering vóór de vingerafdruk; dan bleven kop en
  // uitleg op de vorige pagina achter en begon de nieuwe pagina met een kale
  // hash. Daarom wordt de hoogte van het complete blok vooraf gemeten. Het blok
  // is ruim kleiner dan een lege pagina, dus het past er altijd op.
  const integriteitHoogte =
    18 +
    paragraphHeight(integriteitUitleg) +
    4 +
    paragraphHeight(hashUitleg) +
    6 +
    14 +
    26 +
    13 +
    (input.sealed === false ? 7 + 13 + paragraphHeight(geenZegelUitleg) : 0)
  ensure(integriteitHoogte)

  line('Integriteit', { size: 12, f: bold, gap: 18 })
  paragraph(integriteitUitleg)
  y -= 4
  paragraph(hashUitleg)
  y -= 6

  const hashLine1 = sha256.slice(0, 32)
  const hashLine2 = sha256.slice(32)
  page.drawText(hashLine1, { x: margin, y, size: 10, font: bold, color: accent })
  y -= 14
  page.drawText(hashLine2, { x: margin, y, size: 10, font: bold, color: accent })
  y -= 26
  const opgemaakt = new Date()
  page.drawText(`Certificaat opgemaakt op ${fmt(opgemaakt)} (${utcOffset(opgemaakt)}, serverklok)`, {
    x: margin,
    y,
    size: 9,
    font,
    color: grey
  })
  y -= 13
  // Niet onderdrukbaar: staat de verzegeling uit, dan hoort dat op het certificaat.
  if (input.sealed === false) {
    y -= 7
    page.drawText('Dit document is niet verzegeld.', {
      x: margin,
      y,
      size: 10,
      font: bold,
      color: rgb(0.72, 0.25, 0.05)
    })
    y -= 13
    paragraph(geenZegelUitleg)
  }

  plattenEnControleren(doc, PDFName)

  const sealedBytes = await doc.save()
  return { sealedBytes, sha256 }
}

/** Er stond nog een formulierveld of annotatie in het document na het plat slaan. */
export class NietPlatError extends Error {
  readonly platgeslagen = false as const
}

// pdf-lib komt via een dynamische import binnen, dus de typen zijn hier
// structureel opgeschreven in plaats van geïmporteerd.
type PDFNameLike = { of(name: string): unknown }
type PageLike = { node: { set(k: unknown, v: unknown): void; get(k: unknown): unknown } }
type PDFDocumentLike = {
  getPages(): PageLike[]
  getForm(): { flatten(): void; getFields(): unknown[] }
  context: { obj(v: unknown): unknown }
}

/**
 * Stap 3 uit de pipeline: plat slaan, en dan controleren dat het gelukt is.
 *
 * Waarom dit moet: het organisatiezegel certificeert met DocMDP P=1, en de
 * stempels van de ondertekenaars moeten dan pagina-inhoud zijn en geen
 * annotaties. Blijven ze annotaties, dan kan een viewer ze als verwijderbaar
 * presenteren. Onder P=1 breekt dat de handtekening, dus je merkt het — maar dan
 * hangt het visuele verslag af van een foutmelding, en dat is te fragiel voor
 * iets wat het bewijsstuk zelf is.
 *
 * Hetzelfde geldt voor formuliervelden die al in het aangeleverde bestand zaten
 * (een Word-conversie of een aangeleverd formulier): die zijn na het zegel nog
 * invulbaar of ze breken het zegel.
 *
 * De controle is bewust hard. Faalt hij, dan stopt de pipeline en gaat het stuk
 * niet de deur uit.
 */
function plattenEnControleren(doc: PDFDocumentLike, PDFName: PDFNameLike): void {
  // pdf-lib gooit als er geen AcroForm is; dat is geen fout maar het normale
  // geval voor een gewoon tekstdocument.
  try {
    doc.getForm().flatten()
  } catch {
    /* geen formulier aanwezig */
  }

  // Wat het plat slaan niet meeneemt (losse annotaties zonder formulierveld)
  // gaat er hier uit. De sealer maakt straks zijn eigen handtekeningveld aan.
  for (const page of doc.getPages()) {
    page.node.set(PDFName.of('Annots'), doc.context.obj([]))
  }

  let annotaties = 0
  for (const page of doc.getPages()) {
    const annots = page.node.get(PDFName.of('Annots')) as { size?: () => number } | undefined
    annotaties += typeof annots?.size === 'function' ? annots.size() : 0
  }
  let velden = 0
  try {
    velden = doc.getForm().getFields().length
  } catch {
    velden = 0
  }
  if (annotaties !== 0 || velden !== 0) {
    throw new NietPlatError(
      `plat slaan mislukt: nog ${annotaties} annotatie(s) en ${velden} formulierveld(en) over. ` +
        'Onder DocMDP P=1 moeten stempels pagina-inhoud zijn; anders kan een viewer ze als ' +
        'verwijderbaar presenteren of breekt het zegel bij openen.'
    )
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}
