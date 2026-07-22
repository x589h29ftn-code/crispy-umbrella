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
}

export interface SealInput {
  pdfBytes: Uint8Array
  dossierTitle: string
  dossierId: string
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
  return d ? NL.format(d) : '—'
}

export async function sealDocument(input: SealInput): Promise<SealResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib')
  // Hash over de volledig ondertekende inhoud, vóór het certificaat wordt
  // toegevoegd. Zo is de vingerafdruk reproduceerbaar te verifiëren.
  const sha256 = createHash('sha256').update(Buffer.from(input.pdfBytes)).digest('hex')
  const doc = await PDFDocument.load(Uint8Array.from(input.pdfBytes), { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const page = doc.addPage([595.28, 841.89]) // A4
  const { width, height } = page.getSize()
  const margin = 48
  const accent = rgb(0.11, 0.3, 0.85)
  const grey = rgb(0.35, 0.35, 0.4)
  let y = height - margin

  const line = (text: string, opts?: { size?: number; f?: typeof font; color?: typeof grey; gap?: number }) => {
    const size = opts?.size ?? 10
    page.drawText(text, { x: margin, y, size, font: opts?.f ?? font, color: opts?.color ?? rgb(0.1, 0.1, 0.12) })
    y -= (opts?.gap ?? size + 6)
  }

  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: accent })
  line('Ondertekencertificaat', { size: 20, f: bold, gap: 30 })
  line('Otto Visser & Partners — Ondertekenportaal', { size: 10, color: grey, gap: 24 })

  line('Document', { size: 12, f: bold, gap: 18 })
  line(`Titel: ${input.dossierTitle}`)
  line(`Dossierkenmerk: ${input.dossierId}`, { gap: 22 })

  line('Ondertekenaars', { size: 12, f: bold, gap: 18 })
  input.signers.forEach((s, i) => {
    if (y < margin + 120) {
      y = height - margin
      doc.addPage([595.28, 841.89])
    }
    line(`${i + 1}. ${s.name}  <${s.email}>`, { f: bold, size: 11 })
    line(`    Ondertekend op: ${fmt(s.signedAt)}`, { size: 9, color: grey })
    line(`    Identiteit geverifieerd (e-mailcode) op: ${fmt(s.otpVerifiedAt)}`, { size: 9, color: grey })
    line(`    IP-adres: ${s.ip ?? '—'}`, { size: 9, color: grey })
    const ua = (s.userAgent ?? '—').slice(0, 90)
    line(`    Apparaat: ${ua}`, { size: 9, color: grey, gap: 16 })
  })

  y -= 8
  line('Integriteit', { size: 12, f: bold, gap: 18 })
  line('Onderstaande SHA-256-vingerafdruk is berekend over de ondertekende', { size: 9, color: grey })
  line('documentinhoud (vóór dit certificaat). Elke wijziging maakt deze ongeldig.', { size: 9, color: grey, gap: 16 })

  const hashLine1 = sha256.slice(0, 32)
  const hashLine2 = sha256.slice(32)
  page.drawText(hashLine1, { x: margin, y, size: 10, font: bold, color: accent })
  y -= 14
  page.drawText(hashLine2, { x: margin, y, size: 10, font: bold, color: accent })
  y -= 26
  page.drawText(`Verzegeld op ${fmt(new Date())}`, { x: margin, y, size: 9, font, color: grey })

  const sealedBytes = await doc.save()
  return { sealedBytes, sha256 }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}
