import { createHash } from 'node:crypto'

// Verzegelt de definitieve PDF: berekent de SHA-256-hash en voegt een
// Nederlands auditcertificaat als extra pagina toe. Zo is elke latere
// byte-wijziging aantoonbaar en staat het bewijs in het document zelf.

export interface SealSigner {
  name: string
  email: string
  ip?: string | null
  userAgent?: string | null
  otpVerifiedAt?: Date | null
  signedAt?: Date | null
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
  /** Nodig om per ondertekenaar de juiste getoonde hash te kunnen tonen. */
  documentId?: string
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
  second: '2-digit'
})

function fmt(d?: Date | null): string {
  return d ? NL.format(d) : '-'
}

export async function sealDocument(input: SealInput): Promise<SealResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib')
  // Hash over de volledig ondertekende inhoud, vóór het certificaat wordt
  // toegevoegd. Zo is de vingerafdruk reproduceerbaar te verifiëren.
  const sha256 = createHash('sha256').update(Buffer.from(input.pdfBytes)).digest('hex')
  const doc = await PDFDocument.load(Uint8Array.from(input.pdfBytes), { ignoreEncryption: true })
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

  const line = (text: string, opts?: { size?: number; f?: typeof font; color?: typeof grey; gap?: number }) => {
    const size = opts?.size ?? 10
    const gap = opts?.gap ?? size + 6
    ensure(gap)
    page.drawText(text, { x: margin, y, size, font: opts?.f ?? font, color: opts?.color ?? rgb(0.1, 0.1, 0.12) })
    y -= gap
  }

  /** Breekt lange tekst af op woordgrenzen binnen de beschikbare breedte. */
  const paragraph = (text: string, opts?: { size?: number; indent?: number }) => {
    const size = opts?.size ?? 9
    const indent = opts?.indent ?? 0
    const maxWidth = width - 2 * margin - indent
    const words = text.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        ensure(size + 3)
        page.drawText(current, { x: margin + indent, y, size, font, color: grey })
        y -= size + 3
        current = word
      } else {
        current = candidate
      }
    }
    if (current) {
      ensure(size + 3)
      page.drawText(current, { x: margin + indent, y, size, font, color: grey })
      y -= size + 3
    }
  }

  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: accent })
  line('Ondertekencertificaat', { size: 20, f: bold, gap: 30 })
  line('Otto Visser & Partners - Ondertekenportaal', { size: 10, color: grey, gap: 24 })

  line('Document', { size: 12, f: bold, gap: 18 })
  line(`Titel: ${input.dossierTitle}`)
  line(`Dossierkenmerk: ${input.dossierId}`, { gap: 22 })

  line('Ondertekenaars', { size: 12, f: bold, gap: 18 })
  input.signers.forEach((s, i) => {
    ensure(90)
    line(`${i + 1}. ${s.name}  <${s.email}>`, { f: bold, size: 11 })
    line(`    Ondertekend op: ${fmt(s.signedAt)} (serverklok)`, { size: 9, color: grey })
    line(`    Code uit de e-mail geverifieerd op: ${fmt(s.otpVerifiedAt)}`, { size: 9, color: grey })
    line(`    IP-adres: ${s.ip ?? '-'}`, { size: 9, color: grey })
    const ua = (s.userAgent ?? '-').slice(0, 90)
    line(`    Apparaat: ${ua}`, { size: 9, color: grey })
    // Welke bytes deze ondertekenaar te zien kreeg (kan per persoon verschillen
    // wanneer er één voor één wordt ondertekend).
    const shown = input.documentId ? s.presentedHashes?.[input.documentId] : undefined
    if (shown) {
      line(`    Getoonde documentversie (SHA-256): ${shown.slice(0, 32)}`, { size: 8, color: grey })
      line(`    ${shown.slice(32)}`, { size: 8, color: grey })
    }
    if (s.consentTextSnapshot) {
      line(`    Gelezen verklaring op ${fmt(s.consentShownAt)}:`, { size: 8, color: grey, gap: 11 })
      paragraph(`"${s.consentTextSnapshot}"`, { size: 8, indent: 16 })
    }
    y -= 8
  })

  y -= 8
  line('Integriteit', { size: 12, f: bold, gap: 18 })
  paragraph(
    'Onderstaande SHA-256-vingerafdruk is berekend over de ondertekende documentinhoud ' +
      '(vóór dit certificaat). Elke wijziging maakt deze ongeldig. Staat er een digitaal ' +
      'zegel in dit document, dan controleert uw PDF-lezer de integriteit automatisch en ' +
      'geldt het tijdstip uit de tijdstempeldienst als het moment van verzegeling.'
  )
  y -= 6

  const hashLine1 = sha256.slice(0, 32)
  const hashLine2 = sha256.slice(32)
  ensure(50)
  page.drawText(hashLine1, { x: margin, y, size: 10, font: bold, color: accent })
  y -= 14
  page.drawText(hashLine2, { x: margin, y, size: 10, font: bold, color: accent })
  y -= 26
  page.drawText(`Certificaat opgemaakt op ${fmt(new Date())} (serverklok)`, { x: margin, y, size: 9, font, color: grey })

  const sealedBytes = await doc.save()
  return { sealedBytes, sha256 }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}
