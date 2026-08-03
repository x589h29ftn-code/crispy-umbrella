import { createHash } from 'node:crypto'

// Het losse auditrapport.
//
// Zonder cryptografisch zegel is dit hét bewijsstuk. Het uitgangspunt is daarom
// het omgekeerde van dat van het ondertekencertificaat in het document: dat is
// een samenvatting die met het stuk meereist, dit is de volledige vastlegging.
// Alles wat we weten staat erin, ook als het rommelig is — een auditor heeft
// meer aan een lange lijst met een bounce erin dan aan een nette samenvatting
// waarin die bounce is weggelaten.
//
// Wat het NIET is: een onafhankelijk zegel. Dit rapport komt uit onze eigen
// database en wordt door ons opgemaakt. Dat staat er ook in, met zoveel woorden.
// Wie ons kantoor verdenkt, heeft hier niets aan; die heeft de hash uit de
// voltooiingsmail nodig (die staat in zíjn mailbox) of een echt zegel.

const TIJDZONE = 'Europe/Amsterdam'

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
  return d ? NL.format(d).replace(', ', ' ') : '-'
}

function utcOffset(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIJDZONE, timeZoneName: 'longOffset' }).formatToParts(d)
  return (parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00').replace('GMT', 'UTC')
}

export interface AuditReportSigner {
  name: string
  email: string
  phone?: string | null
  role: string
  order: number
  status: string
  verificationMethod: string
  clientName?: string | null
  sentAt?: Date | null
  openedAt?: Date | null
  otpVerifiedAt?: Date | null
  reauthVerifiedAt?: Date | null
  signedAt?: Date | null
  declinedReason?: string | null
  ip?: string | null
  userAgent?: string | null
  mailStatus?: string | null
  mailStatusAt?: Date | null
  mailBounceReason?: string | null
  remindersSentTo?: number
  consentTextSnapshot?: string | null
  consentTextHash?: string | null
  consentShownAt?: Date | null
  presentedHashes?: Record<string, string> | null
}

export interface AuditReportDocument {
  id: string
  title: string
  fileName: string
  pages?: number | null
  detectedKind?: string | null
  detectedYear?: number | null
  ocrUsed?: boolean
  documentSha256?: string | null
  preSealSha256?: string | null
  sealedSha256?: string | null
  sealStage: string
  sealedAt?: Date | null
  timestampedAt?: Date | null
  sealCertSerial?: string | null
  sealTsaUrl?: string | null
}

export interface AuditReportEvent {
  seq: string
  type: string
  createdAt: Date
  message?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: unknown
  hash?: string | null
  prevHash?: string | null
  actor?: string | null
}

export interface AuditReportInput {
  dossierTitle: string
  dossierId: string
  status: string
  assuranceLevel: string
  assuranceLabel: string
  assuranceUitleg: string
  ownerName: string
  ownerEmail: string
  createdAt: Date
  sentAt?: Date | null
  completedAt?: Date | null
  expiresAt?: Date | null
  signingMode: string
  signers: AuditReportSigner[]
  documents: AuditReportDocument[]
  events: AuditReportEvent[]
  /** Uitkomst van de ketencontrole op het moment van opmaken. */
  chainOk: boolean
  chainDetail?: string | null
}

export interface AuditReportResult {
  bytes: Uint8Array
  sha256: string
}

// Dit rapport gaat als bijlage naar de CLIËNT. Het auditspoor is intern en bevat
// dus dingen die daar niet horen: het credential-id van de accountant bij zijn
// certificaatprovider, het pad in SharePoint waar het stuk is opgeslagen, het
// message-id van de mailprovider, interne id's van medewerkers, en foutmeldingen
// die de servernaam of de configuratie prijsgeven.
//
// Daarom een ALLOWLIST en geen denylist: alles wat hieronder niet staat, blijft
// eruit. Wie later een veld toevoegt aan een auditregel lekt daarmee niet per
// ongeluk iets naar buiten — hij moet het hier bewust bij zetten.

/** Metadatavelden die op een cliëntgericht rapport thuishoren. */
const METADATA_TOONBAAR = new Set([
  // Verificatie en pogingen: zegt iets over het verloop bij deze ondertekenaar.
  'kanaal',
  'bestemming',
  'attempt',
  'attempts',
  'remaining',
  'poging',
  'pogingen',
  'resterend',
  'max',
  // Documentintegriteit.
  'sha256',
  'hashes',
  'expected',
  'actual',
  'sealed',
  'certSerial',
  'ketenIntact',
  'niveau',
  // Bezorging: de reden dat een mail niet aankwam gaat over de eigen mailbox van
  // de ontvanger en is juist relevant.
  'reason',
  'bounceType',
  // Bewaartermijn en opnieuw versturen.
  'blobBewaardagen',
  'archivedAt',
  'resendCount',
  'bewijsBlijft'
])

/**
 * Gebeurtenissen waarvan de melding interne details kan bevatten: een
 * configuratienaam, een interne URL, of de letterlijke fout van een sidecar.
 * Die worden vervangen door een feitelijke, neutrale regel — de gebeurtenis
 * blijft zichtbaar, de binnenkant niet.
 */
const MELDING_NEUTRAAL: Record<string, string> = {
  VERZEGELING_MISLUKT: 'het verzegelen is op dat moment niet gelukt; het portaal heeft het opnieuw geprobeerd',
  CSC_ONDERTEKENING_MISLUKT: 'het waarmerken met het beroepscertificaat is op dat moment niet gelukt',
  CERTIFICAAT_INGETROKKEN: 'het beroepscertificaat is bij de provider ingetrokken of geblokkeerd',
  AUDITRAPPORT_OPGEMAAKT: 'auditrapport opgemaakt'
}

/** Filtert de melding van een gebeurtenis voor een cliëntgericht rapport. */
function meldingVoorRapport(type: string, message?: string | null): string | null {
  const vast = MELDING_NEUTRAAL[type]
  if (vast) return vast
  if (!message) return null
  // Alles wat als "mislukt: <interne fout>" is vastgelegd, ongeacht de soort.
  if (/^mislukt:/i.test(message.trim())) return 'deze stap is op dat moment niet gelukt'
  return message
}

/** Zet de toonbare metadata om naar een compacte, leesbare regel. */
function metaTekst(meta: unknown): string {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return ''
  const toonbaar: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (METADATA_TOONBAAR.has(k)) toonbaar[k] = v
  }
  if (Object.keys(toonbaar).length === 0) return ''
  try {
    return JSON.stringify(toonbaar)
  } catch {
    return ''
  }
}

export async function buildAuditReport(input: AuditReportInput): Promise<AuditReportResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)

  const A4: [number, number] = [595.28, 841.89]
  const margin = 44
  const accent = rgb(0.11, 0.3, 0.85)
  const grijs = rgb(0.35, 0.35, 0.4)
  const zwart = rgb(0.1, 0.1, 0.12)

  let page = doc.addPage(A4)
  const { width, height } = page.getSize()
  let y = height - margin
  let paginaNr = 1

  const nieuwePagina = () => {
    page = doc.addPage(A4)
    paginaNr += 1
    y = height - margin
    // Kopregel op vervolgpagina's, zodat een losbladige afdruk bij elkaar te
    // houden is.
    page.drawText(`Auditrapport · ${input.dossierTitle}`, {
      x: margin,
      y,
      size: 7.5,
      font,
      color: grijs
    })
    page.drawText(`pagina ${paginaNr}`, { x: width - margin - 46, y, size: 7.5, font, color: grijs })
    y -= 16
  }

  const ensure = (nodig: number) => {
    if (y - nodig < margin) nieuwePagina()
  }

  /**
   * Breekt tekst af binnen de beschikbare breedte. Woorden die zelf al te breed
   * zijn (een lang e-mailadres, een user-agent zonder spaties) worden hard
   * doorgeknipt: `drawText` kapt niets af, dus zonder dat loopt zo'n woord van de
   * pagina af en mist er tekst op het rapport zonder dat het opvalt.
   */
  const breekAf = (tekst: string, size: number, f: typeof font, beschikbaar: number): string[] => {
    const stukken: string[] = []
    for (const woord of tekst.split(/\s+/).filter(Boolean)) {
      if (f.widthOfTextAtSize(woord, size) <= beschikbaar) {
        stukken.push(woord)
        continue
      }
      let rest = woord
      while (rest && f.widthOfTextAtSize(rest, size) > beschikbaar) {
        let n = rest.length
        while (n > 1 && f.widthOfTextAtSize(rest.slice(0, n), size) > beschikbaar) n--
        stukken.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      if (rest) stukken.push(rest)
    }
    const uit: string[] = []
    let huidig = ''
    for (const w of stukken) {
      const kandidaat = huidig ? `${huidig} ${w}` : w
      if (f.widthOfTextAtSize(kandidaat, size) > beschikbaar && huidig) {
        uit.push(huidig)
        huidig = w
      } else huidig = kandidaat
    }
    if (huidig) uit.push(huidig)
    return uit
  }

  const regel = (
    tekst: string,
    opts?: { size?: number; f?: typeof font; color?: typeof grijs; gap?: number; x?: number }
  ) => {
    const size = opts?.size ?? 9.5
    const gap = opts?.gap ?? size + 4
    const f = opts?.f ?? font
    const x = opts?.x ?? margin
    for (const r of breekAf(tekst, size, f, width - margin - x)) {
      ensure(gap)
      page.drawText(r, { x, y, size, font: f, color: opts?.color ?? zwart })
      y -= gap
    }
  }

  const alinea = (tekst: string, opts?: { size?: number; indent?: number; f?: typeof font }) => {
    const size = opts?.size ?? 8.5
    const indent = opts?.indent ?? 0
    const f = opts?.f ?? font
    for (const t of breekAf(tekst, size, f, width - 2 * margin - indent)) {
      ensure(size + 3)
      page.drawText(t, { x: margin + indent, y, size, font: f, color: grijs })
      y -= size + 3
    }
  }

  /** Lange hex-waarde over meerdere regels, in een vaste breedte. */
  const hexRegels = (label: string, waarde?: string | null, indent = 10) => {
    if (!waarde) return
    ensure(22)
    page.drawText(label, { x: margin + indent, y, size: 8, font, color: grijs })
    y -= 10
    for (let i = 0; i < waarde.length; i += 48) {
      ensure(10)
      page.drawText(waarde.slice(i, i + 48), { x: margin + indent + 6, y, size: 7.5, font: mono, color: accent })
      y -= 9
    }
  }

  const kop = (tekst: string) => {
    ensure(30)
    y -= 6
    page.drawText(tekst, { x: margin, y, size: 12, font: bold, color: zwart })
    y -= 6
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.6,
      color: rgb(0.85, 0.88, 0.93)
    })
    y -= 13
  }

  // --- Omslagblok ---
  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: accent })
  regel('Auditrapport', { size: 20, f: bold, gap: 26 })
  regel('Otto Visser & Partners accountants — Ondertekenportaal', { size: 9.5, color: grijs, gap: 20 })

  kop('1. Het verzoek')
  regel(`Titel: ${input.dossierTitle}`)
  regel(`Dossierkenmerk: ${input.dossierId}`)
  regel(`Status: ${input.status}`)
  regel(`Aangemaakt: ${fmt(input.createdAt)}`)
  regel(`Verstuurd: ${fmt(input.sentAt)}`)
  regel(`Afgerond: ${fmt(input.completedAt)}`)
  regel(`Geldigheid link tot: ${fmt(input.expiresAt)}`)
  regel(`Ondertekenvolgorde: ${input.signingMode === 'SEQUENTIAL' ? 'één voor één' : 'iedereen tegelijk'}`)
  regel(`Aangeboden door: ${input.ownerName} <${input.ownerEmail}>`)
  y -= 4
  alinea(
    `Alle tijdstippen in dit rapport staan in Nederlandse tijd (${TIJDZONE}), met de zomer- of ` +
      `wintertijd zoals die op dat moment gold.`
  )

  kop(`2. Betrouwbaarheidsniveau: ${input.assuranceLabel}`)
  alinea(input.assuranceUitleg)
  y -= 4
  if (input.assuranceLevel === 'AUDITSPOOR') {
    ensure(46)
    page.drawText('Er is geen digitaal zegel gebruikt.', { x: margin, y, size: 10, font: bold, color: rgb(0.72, 0.25, 0.05) })
    y -= 13
    alinea(
      'De bewijskracht van dit verzoek zit in de vastlegging in dit rapport: de verificatie per ' +
        'e-mail of sms vóórdat er iets zichtbaar werd, het IP-adres en apparaat bij elke stap, de ' +
        'verklaring die elke ondertekenaar las, en de vingerafdruk van de versie die hij zag. ' +
        'De ontvanger kan de echtheid niet in zijn PDF-lezer laten controleren.'
    )
  }

  // --- Documenten ---
  kop('3. De documenten')
  for (const [i, d] of input.documents.entries()) {
    ensure(70)
    regel(`${i + 1}. ${d.title}`, { f: bold, size: 10 })
    regel(`    Bestandsnaam: ${d.fileName}`, { size: 8.5, color: grijs })
    const kenmerken = [
      d.pages != null ? `${d.pages} pagina${d.pages === 1 ? '' : "'s"}` : null,
      d.detectedKind ? `herkend als ${d.detectedKind}` : null,
      d.detectedYear ? `boekjaar ${d.detectedYear}` : null,
      d.ocrUsed ? 'tekst via OCR gelezen' : null
    ].filter(Boolean)
    if (kenmerken.length) regel(`    ${kenmerken.join(' · ')}`, { size: 8.5, color: grijs })
    regel(`    Verzegelingsfase: ${d.sealStage}`, { size: 8.5, color: grijs })
    if (d.sealedAt) regel(`    Verzegeld op: ${fmt(d.sealedAt)} (serverklok)`, { size: 8.5, color: grijs })
    if (d.timestampedAt) {
      regel(`    Tijdstempeldienst: ${fmt(d.timestampedAt)} — dit is de bewijstijd`, { size: 8.5, color: grijs })
    }
    if (d.sealCertSerial) regel(`    Certificaat-serienummer: ${d.sealCertSerial}`, { size: 8.5, color: grijs })
    if (d.sealTsaUrl) regel(`    Tijdstempel-URL: ${d.sealTsaUrl}`, { size: 8, color: grijs })
    hexRegels('Vingerafdruk ondertekende inhoud (SHA-256):', d.documentSha256)
    hexRegels('Vingerafdruk met ondertekencertificaat, vóór het zegel:', d.preSealSha256)
    hexRegels('Vingerafdruk definitief bestand:', d.sealedSha256)
    y -= 6
  }

  // --- Ondertekenaars ---
  kop('4. De ondertekenaars')
  for (const [i, s] of input.signers.entries()) {
    ensure(120)
    regel(`${i + 1}. ${s.name}  <${s.email}>`, { f: bold, size: 10.5 })
    const rol = s.role === 'ZELF' ? 'medewerker van het kantoor' : 'externe ondertekenaar'
    regel(`    Rol: ${rol} · positie ${s.order + 1} · status ${s.status}`, { size: 8.5, color: grijs })
    if (s.clientName) regel(`    Gekoppeld aan cliënt: ${s.clientName}`, { size: 8.5, color: grijs })
    if (s.phone) regel(`    Telefoonnummer: ${s.phone}`, { size: 8.5, color: grijs })

    regel('    Verloop', { size: 9, f: bold, color: grijs })
    regel(`      Uitnodiging verstuurd: ${fmt(s.sentAt)}`, { size: 8.5, color: grijs })
    if (s.mailStatus) {
      const bezorg = `      Bezorgstatus e-mail: ${s.mailStatus}${s.mailStatusAt ? ` op ${fmt(s.mailStatusAt)}` : ''}`
      regel(bezorg, { size: 8.5, color: grijs })
      // Een bounce hoort hier te staan, niet weggelaten te worden: dat is precies
      // waar een discussie over "ik heb het nooit gekregen" op aankomt.
      if (s.mailBounceReason) alinea(`Reden: ${s.mailBounceReason}`, { size: 8, indent: 22 })
    }
    if (s.remindersSentTo) regel(`      Herinneringen verstuurd: ${s.remindersSentTo}`, { size: 8.5, color: grijs })
    regel(`      Voor het eerst geopend: ${fmt(s.openedAt)}`, { size: 8.5, color: grijs })
    if (s.role === 'ZELF') {
      regel(`      Herverificatie bij ondertekenen: ${fmt(s.reauthVerifiedAt)}`, { size: 8.5, color: grijs })
    } else {
      const kanaal = s.verificationMethod === 'SMS' ? 'sms' : 'e-mail'
      regel(`      Verificatiecode (${kanaal}) ingevoerd: ${fmt(s.otpVerifiedAt)}`, { size: 8.5, color: grijs })
    }
    regel(`      Ondertekend: ${fmt(s.signedAt)}`, { size: 8.5, color: grijs })
    if (s.declinedReason) alinea(`Geweigerd, opgegeven reden: ${s.declinedReason}`, { size: 8, indent: 22 })

    regel('    Herkomst', { size: 9, f: bold, color: grijs })
    regel(`      IP-adres bij ondertekenen: ${s.ip ?? '-'}`, { size: 8.5, color: grijs })
    if (s.userAgent) alinea(`Apparaat: ${s.userAgent}`, { size: 8, indent: 22 })
    else regel('      Apparaat: -', { size: 8.5, color: grijs })

    if (s.consentTextSnapshot) {
      regel(`    Gelezen verklaring op ${fmt(s.consentShownAt)}`, { size: 9, f: bold, color: grijs })
      alinea(`"${s.consentTextSnapshot}"`, { size: 8, indent: 22 })
      hexRegels('Vingerafdruk van die tekst (SHA-256):', s.consentTextHash, 22)
    }
    if (s.presentedHashes && Object.keys(s.presentedHashes).length > 0) {
      regel('    Versie die deze persoon op het scherm zag', { size: 9, f: bold, color: grijs })
      for (const [docId, h] of Object.entries(s.presentedHashes)) {
        const titel = input.documents.find((d) => d.id === docId)?.title ?? docId
        hexRegels(`${titel}:`, h, 22)
      }
    }
    y -= 8
  }

  // --- Het volledige spoor ---
  kop('5. Het volledige auditspoor')
  alinea(
    'Elke vastgelegde gebeurtenis, op volgorde van het doorlopende volgnummer. Dat nummer is ' +
      'doorlopend: een gat erin betekent dat er een regel is verdwenen. Elke regel bevat ook de ' +
      'hash van zichzelf en van zijn voorganger, zodat wijziging achteraf aantoonbaar is.'
  )
  y -= 6
  for (const e of input.events) {
    ensure(30)
    regel(`#${e.seq}  ${fmt(e.createdAt)}  ${e.type}`, { size: 8.5, f: bold })
    const detail: string[] = []
    if (e.actor) detail.push(e.actor)
    if (e.ipAddress) detail.push(`IP ${e.ipAddress}`)
    if (detail.length) regel(`      ${detail.join(' · ')}`, { size: 8, color: grijs })
    const melding = meldingVoorRapport(e.type, e.message)
    if (melding) alinea(melding, { size: 8, indent: 22 })
    if (e.userAgent) alinea(`Apparaat: ${e.userAgent}`, { size: 7.5, indent: 22 })
    const meta = metaTekst(e.metadata)
    if (meta) alinea(`Gegevens: ${meta}`, { size: 7.5, indent: 22 })
    if (e.hash) {
      ensure(10)
      page.drawText(`hash ${e.hash.slice(0, 24)}…  vorige ${(e.prevHash ?? 'geen').slice(0, 24)}…`, {
        x: margin + 22,
        y,
        size: 7,
        font: mono,
        color: rgb(0.55, 0.58, 0.65)
      })
      y -= 10
    }
    y -= 2
  }

  // --- Wat dit rapport wel en niet bewijst ---
  kop('6. Wat dit rapport wel en niet aantoont')
  regel('Wel', { size: 9.5, f: bold })
  alinea(
    'Dat de ondertekenaar toegang had tot het e-mailadres of telefoonnummer dat het kantoor had ' +
      'bevestigd, en dat hij zich daarmee heeft geverifieerd vóórdat er documentinhoud zichtbaar ' +
      'werd. Vanaf welk IP-adres en apparaat dat gebeurde, op welk moment, welke verklaring hij ' +
      'las, en welke versie van het document hij daarbij zag.'
  )
  y -= 4
  regel('Niet', { size: 9.5, f: bold })
  alinea(
    'Dit rapport komt uit onze eigen database en wordt door ons opgemaakt. De hashketen maakt ' +
      'wijziging achteraf aantoonbaar voor wie de keten al eerder heeft gezien, maar wie het ' +
      'kantoor zelf verdenkt, heeft daar niets aan. Daarvoor zijn er twee andere dingen: de ' +
      'vingerafdruk van het definitieve bestand die in de voltooiingsmail staat — in de mailbox ' +
      'van de ontvanger, met zijn eigen ontvangstdatum, buiten ons beheer — en, als dat niveau is ' +
      'gekozen, een digitaal zegel met een gekwalificeerde tijdstempel van een externe partij.'
  )
  y -= 4
  alinea(
    'De verificatiecode bewijst controle over een mailbox of telefoonnummer, niet de identiteit ' +
      'van een persoon. Er wordt geen identiteitsbewijs gecontroleerd. Dat het adres bij de juiste ' +
      'persoon hoort, is de vaststelling van het kantoor.'
  )

  kop('7. Ketencontrole')
  regel(
    input.chainOk
      ? 'De hashketen van dit dossier is nagelopen bij het opmaken van dit rapport en is intact.'
      : 'LET OP: de hashketen van dit dossier is NIET intact. Zie de toelichting hieronder.',
    { size: 9.5, f: bold, color: input.chainOk ? rgb(0.05, 0.45, 0.25) : rgb(0.72, 0.15, 0.15) }
  )
  if (input.chainDetail) alinea(input.chainDetail, { size: 8 })

  const opgemaakt = new Date()
  y -= 10
  ensure(16)
  page.drawText(`Rapport opgemaakt op ${fmt(opgemaakt)} (${utcOffset(opgemaakt)}, serverklok)`, {
    x: margin,
    y,
    size: 8,
    font,
    color: grijs
  })

  const bytes = await doc.save()
  return { bytes, sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex') }
}
