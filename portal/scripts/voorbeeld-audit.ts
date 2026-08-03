/**
 * Maakt de voorbeeldbestanden in docs/voorbeelden/.
 *
 * Twee dingen die vaak door elkaar worden gehaald:
 *
 *  1. het ONDERTEKENCERTIFICAAT — een pagina áchter het document zelf, die met
 *     het bestand meereist en de samenvatting per ondertekenaar bevat;
 *  2. het AUDITRAPPORT — een apart bestand met het volledige verloop, inclusief
 *     elke vastgelegde gebeurtenis en de hashketen.
 *
 * Dit script zet een compleet, verzonnen dossier in de database, genereert beide
 * bestanden, en ruimt het dossier daarna weer op. Zo blijven de voorbeelden
 * gelijk aan wat de code werkelijk maakt in plaats van een hertekening die
 * langzaam gaat afwijken.
 *
 *   npm run voorbeeld:audit
 *
 * Alle gegevens zijn verzonnen. De namen, adressen en nummers hieronder bestaan
 * niet; de hashes zijn echt (berekend over de voorbeeldbestanden).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { chainHash, type AuditInput } from '@/lib/audit'
import { hashPassword } from '@/lib/auth/password'
import { buildAuditReportFor } from '@/lib/auditReportData'
import { sealDocument } from '@/lib/pdf/seal'
import { stampSignatureImage } from '@/lib/pdf/signing'
import { consentTextVoor, consentHash } from '@/lib/consent'

const UIT = 'docs/voorbeelden'
const EMAIL = 'voorbeeld@ottovisseraccountants.nl'

const CRC_TABEL = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABEL[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const lengte = Buffer.alloc(4)
  lengte.writeUInt32BE(data.length)
  const romp = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(romp))
  return Buffer.concat([lengte, romp, crc])
}

/**
 * Een echte PNG met een handtekening-achtige streep erin.
 *
 * Bewust zelf gecodeerd in plaats van een base64-blok in de bron: een met de
 * hand getypte base64 is niet te controleren, en een ongeldige PNG loopt bij
 * `embedPng` niet op een fout maar op een hang (dat is hier één keer gebeurd).
 * Dit is te lezen, en als het fout is klopt de PNG meteen niet meer.
 */
function pngDataUrl(seed: number): string {
  const W = 260
  const H = 80
  const px = Buffer.alloc(W * H * 4, 0) // RGBA, volledig transparant
  const zet = (x: number, y: number, alpha: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const o = (y * W + x) * 4
    if (px[o + 3] >= alpha) return
    px[o] = 23
    px[o + 1] = 37
    px[o + 2] = 84 // donkerblauwe inkt
    px[o + 3] = alpha
  }
  // Eén doorlopende haal met wat variatie, zodat de twee ondertekenaars niet
  // dezelfde krabbel krijgen.
  for (let t = 0; t <= 1200; t++) {
    const u = t / 1200
    const x = 12 + u * (W - 28)
    const y =
      H / 2 +
      Math.sin(u * Math.PI * (3 + seed)) * (16 - u * 6) +
      Math.sin(u * Math.PI * (11 + seed * 2)) * 4 -
      u * 8
    const dik = 1.6 + Math.sin(u * Math.PI) * 0.9
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const afstand = Math.hypot(dx, dy)
        if (afstand > dik) continue
        zet(Math.round(x) + dx, Math.round(y) + dy, Math.round(255 * Math.min(1, dik - afstand + 0.35)))
      }
    }
  }
  // Onderstreping, zoals veel mensen onder hun naam zetten.
  for (let x = 16; x < W - 24; x++) zet(x, H - 12 + Math.round(Math.sin(x / 40) * 2), 210)

  const rijen: Buffer[] = []
  for (let y = 0; y < H; y++) {
    rijen.push(Buffer.from([0])) // filtertype 0 (None)
    rijen.push(px.subarray(y * W * 4, (y + 1) * W * 4))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // 8 bit per kanaal
  ihdr[9] = 6 // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rijen), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

async function schoon() {
  const oud = await prisma.accountant.findUnique({ where: { email: EMAIL }, select: { id: true } })
  if (!oud) return
  for (const d of await prisma.dossier.findMany({ where: { ownerId: oud.id }, select: { id: true } })) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
      await tx.dossier.delete({ where: { id: d.id } })
    })
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.auditEvent.deleteMany({ where: { accountantId: oud.id } })
    await tx.accountant.delete({ where: { id: oud.id } })
  })
}

/** Een document dat op een echt stuk lijkt, zodat de stempels ergens op staan. */
async function maakStuk(titel: string, regels: string[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([595.28, 841.89])
  page.drawText(titel, { x: 60, y: 760, size: 16, font: bold, color: rgb(0.14, 0.21, 0.29) })
  page.drawText('Jansen Holding B.V. — VOORBEELD, geen echt stuk', {
    x: 60,
    y: 738,
    size: 10,
    font,
    color: rgb(0.45, 0.5, 0.56)
  })
  let y = 700
  for (const r of regels) {
    page.drawText(r, { x: 60, y, size: 10.5, font, color: rgb(0.1, 0.14, 0.2) })
    y -= 18
  }
  page.drawText('Handtekening bestuurder:', { x: 60, y: 300, size: 10, font, color: rgb(0.35, 0.4, 0.46) })
  page.drawText('Handtekening accountant:', { x: 320, y: 300, size: 10, font, color: rgb(0.35, 0.4, 0.46) })
  return doc.save()
}

/** Voortgang op stderr; de drie regels op stdout zijn de uitkomst. */
function stap(wat: string) {
  process.stderr.write(`… ${wat}\n`)
}

async function main() {
  mkdirSync(UIT, { recursive: true })
  stap('opruimen')
  await schoon()
  const store = storage()

  stap('accountant')
  const acc = await prisma.accountant.create({
    data: {
      email: EMAIL,
      name: 'A. Visser RA',
      passwordHash: await hashPassword('Voorbeeld-Niet-Gebruiken-1'),
      professionalTitle: 'RA',
      totpEnabled: true
    }
  })

  stap('stuk maken')
  const stuk = await maakStuk('Jaarrekening 2025', [
    'Balans per 31 december 2025',
    '',
    'Materiële vaste activa            184.500',
    'Vlottende activa                  312.750',
    'Liquide middelen                   96.240',
    '',
    'Eigen vermogen                    401.120',
    'Langlopende schulden              120.000',
    'Kortlopende schulden               72.370'
  ])

  stap('dossier')
  const dossier = await prisma.dossier.create({
    data: {
      title: 'Jaarrekening 2025 — Jansen Holding B.V.',
      ownerId: acc.id,
      createdAt: new Date('2026-03-11T09:12:30Z'),
      status: 'ONDERTEKEND',
      assuranceLevel: 'AUDITSPOOR',
      signingMode: 'SEQUENTIAL',
      sentAt: new Date('2026-03-11T09:14:00Z'),
      expiresAt: new Date('2026-03-21T09:14:00Z'),
      completedAt: new Date('2026-03-13T14:31:00Z'),
      documents: {
        create: [
          {
            title: 'Jaarrekening 2025',
            fileName: 'jaarrekening-2025-jansen-holding.pdf',
            order: 0,
            originalKey: await store.put(stuk, 'pdf'),
            workingKey: await store.put(stuk, 'pdf'),
            detectedKind: 'JAARREKENING',
            detectedYear: 2025
          }
        ]
      }
    },
    include: { documents: true }
  })
  const doc = dossier.documents[0]

  // --- Twee ondertekenaars: de cliënt (sms) en de accountant (ingelogd) ---
  stap('ontvangers')
  const clientVerklaring = consentTextVoor('EXTERN')
  const client = await prisma.recipient.create({
    data: {
      dossierId: dossier.id,
      role: 'EXTERN',
      name: 'J. Jansen',
      email: 'j.jansen@voorbeeld.nl',
      phone: '+31 6 12 34 56 78',
      verificationMethod: 'SMS',
      order: 0,
      status: 'SIGNED',
      signedAt: new Date('2026-03-12T16:02:47Z'),
      otpVerifiedAt: new Date('2026-03-12T16:01:12Z'),
      mailStatus: 'DELIVERED',
      mailStatusAt: new Date('2026-03-11T09:14:22Z'),
      consentTextSnapshot: clientVerklaring,
      consentTextHash: consentHash(clientVerklaring),
      consentShownAt: new Date('2026-03-12T16:01:40Z')
    }
  })
  const kantoorVerklaring = consentTextVoor('ZELF', 'JAARREKENING')
  const kantoor = await prisma.recipient.create({
    data: {
      dossierId: dossier.id,
      accountantId: acc.id,
      role: 'ZELF',
      name: acc.name,
      email: acc.email,
      order: 1,
      status: 'SIGNED',
      signedAt: new Date('2026-03-13T14:30:18Z'),
      reauthVerifiedAt: new Date('2026-03-13T14:30:05Z'),
      consentTextSnapshot: kantoorVerklaring,
      consentTextHash: consentHash(kantoorVerklaring),
      consentShownAt: new Date('2026-03-13T14:29:40Z')
    }
  })

  // --- De stempels echt zetten, zodat het voorbeeld een écht stuk is ---
  stap('stempelen')
  let bytes: Uint8Array = stuk
  const plek = [
    { r: client, x: 60, y: 250, seed: 1 },
    { r: kantoor, x: 320, y: 250, seed: 4 }
  ]
  for (const p of plek) {
    await prisma.signatureField.create({
      data: {
        dossierId: dossier.id,
        recipientId: p.r.id,
        documentId: doc.id,
        page: 0,
        x: p.x,
        y: p.y,
        width: 170,
        height: 50,
        filled: true
      }
    })
    bytes = await stampSignatureImage(
      bytes,
      { page: 0, x: p.x, y: p.y, width: 170, height: 50 },
      pngDataUrl(p.seed),
      {
        name: p.r.name,
        dateText: new Intl.DateTimeFormat('nl-NL', {
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'Europe/Amsterdam'
        })
          .format(p.r.signedAt!)
          .replace(', ', ' ')
      }
    )
  }

  // Hash van de versie die elk van beiden op het scherm zag. Bij één voor één
  // ondertekenen verschilt die per persoon; dat is precies wat het rapport toont.
  const { createHash } = await import('node:crypto')
  const hashVan = (b: Uint8Array) => createHash('sha256').update(Buffer.from(b)).digest('hex')
  await prisma.recipient.update({
    where: { id: client.id },
    data: { presentedHashes: { [doc.id]: hashVan(stuk) }, presentedAt: new Date('2026-03-12T16:01:40Z') }
  })
  await prisma.recipient.update({
    where: { id: kantoor.id },
    data: { presentedHashes: { [doc.id]: hashVan(bytes) }, presentedAt: new Date('2026-03-13T14:29:40Z') }
  })

  // --- Het ondertekencertificaat in het document ---
  stap('certificaatpagina')
  const { sealedBytes, sha256 } = await sealDocument({
    pdfBytes: bytes,
    dossierTitle: dossier.title,
    dossierId: dossier.id,
    documentId: doc.id,
    sealed: false,
    fieldCounts: { signature: 2, initials: 0, date: 0 },
    signers: [
      {
        name: client.name,
        email: client.email,
        sentAt: new Date('2026-03-11T09:14:00Z'),
        openedAt: new Date('2026-03-12T16:00:31Z'),
        otpVerifiedAt: client.otpVerifiedAt,
        signedAt: client.signedAt,
        verification: 'SMS',
        ip: '84.24.101.7',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
        presentedHashes: { [doc.id]: hashVan(stuk) },
        consentTextSnapshot: clientVerklaring,
        consentShownAt: client.consentShownAt
      },
      {
        name: kantoor.name,
        email: kantoor.email,
        sentAt: new Date('2026-03-12T16:02:50Z'),
        openedAt: new Date('2026-03-13T14:29:12Z'),
        reauthVerifiedAt: kantoor.reauthVerifiedAt,
        signedAt: kantoor.signedAt,
        verification: 'KANTOOR',
        ip: '81.204.9.12',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        presentedHashes: { [doc.id]: hashVan(bytes) },
        consentTextSnapshot: kantoorVerklaring,
        consentShownAt: kantoor.consentShownAt
      }
    ]
  })
  const sealedKey = await store.put(sealedBytes, 'pdf')
  await prisma.document.update({
    where: { id: doc.id },
    data: {
      sealedKey,
      documentSha256: sha256,
      preSealSha256: hashVan(sealedBytes),
      sealedSha256: hashVan(sealedBytes),
      sealStage: 'SEALED',
      sealedAt: new Date('2026-03-13T14:30:52Z')
    }
  })
  writeFileSync(`${UIT}/Voorbeeld-ondertekend-document.pdf`, Buffer.from(sealedBytes))

  // --- Het auditspoor, in de volgorde waarin het echt gebeurt ---
  //
  // Niet via `writeAudit`: die zet het tijdstip zelf op "nu", en dan staan alle
  // zestien regels op dezelfde seconde. Voor een voorbeeld dat een echt verloop
  // moet laten zien is dat waardeloos. Daarom worden de regels hier met een
  // eigen tijdstip geschreven, mét dezelfde `chainHash` als de productiecode —
  // de ketencontrole aan het eind van dit script bewijst dat dat klopt.
  stap('auditspoor')
  type Regel = AuditInput & { at: Date }
  const spoor: Regel[] = [
    {
      at: new Date('2026-03-11T09:12:30Z'),
      type: 'AANGEMAAKT',
      dossierId: dossier.id,
      accountantId: acc.id,
      message: 'twee ondertekenaars, één voor één'
    },
    { at: new Date('2026-03-11T09:14:00Z'), type: 'VERZONDEN', dossierId: dossier.id, recipientId: client.id, message: client.email },
    {
      at: new Date('2026-03-11T09:14:22Z'),
      type: 'MAIL_AFGELEVERD',
      dossierId: dossier.id,
      recipientId: client.id,
      metadata: { provider: 'postmark' }
    },
    {
      at: new Date('2026-03-11T09:31:04Z'),
      type: 'MAIL_GEOPEND',
      dossierId: dossier.id,
      recipientId: client.id,
      metadata: { provider: 'postmark' }
    },
    {
      at: new Date('2026-03-12T08:00:11Z'),
      type: 'HERINNERD',
      dossierId: dossier.id,
      recipientId: client.id,
      message: 'automatische herinnering (dag 1 na verzending)'
    },
    {
      at: new Date('2026-03-12T16:00:31Z'),
      type: 'GEOPEND',
      dossierId: dossier.id,
      recipientId: client.id,
      message: client.email,
      ip: '84.24.101.7',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
    },
    {
      at: new Date('2026-03-12T16:00:44Z'),
      type: 'OTP_VERSTUURD',
      dossierId: dossier.id,
      recipientId: client.id,
      metadata: { kanaal: 'sms', bestemming: '+316****5678' }
    },
    // Eerst een verkeerde code. Dat hoort erbij: het laat zien dat mislukte
    // pogingen even hard worden vastgelegd als geslaagde.
    {
      at: new Date('2026-03-12T16:00:58Z'),
      type: 'OTP_MISLUKT',
      dossierId: dossier.id,
      recipientId: client.id,
      ip: '84.24.101.7',
      metadata: { attempt: 1, remaining: 4 }
    },
    {
      at: new Date('2026-03-12T16:01:12Z'),
      type: 'OTP_GEVERIFIEERD',
      dossierId: dossier.id,
      recipientId: client.id,
      ip: '84.24.101.7'
    },
    {
      at: new Date('2026-03-12T16:02:47Z'),
      type: 'ONDERTEKEND',
      dossierId: dossier.id,
      recipientId: client.id,
      message: client.email,
      ip: '84.24.101.7',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
    },
    {
      at: new Date('2026-03-12T16:02:50Z'),
      type: 'VERZONDEN',
      dossierId: dossier.id,
      recipientId: kantoor.id,
      message: `${kantoor.email} (kantoor)`
    },
    {
      at: new Date('2026-03-13T14:29:12Z'),
      type: 'GEOPEND',
      dossierId: dossier.id,
      recipientId: kantoor.id,
      accountantId: acc.id,
      message: kantoor.email,
      ip: '81.204.9.12',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    },
    {
      at: new Date('2026-03-13T14:30:05Z'),
      type: 'HERVERIFICATIE_GESLAAGD',
      dossierId: dossier.id,
      recipientId: kantoor.id,
      accountantId: acc.id,
      message: 'verse code geaccepteerd bij ondertekenen',
      ip: '81.204.9.12'
    },
    {
      at: new Date('2026-03-13T14:30:18Z'),
      type: 'ONDERTEKEND',
      dossierId: dossier.id,
      recipientId: kantoor.id,
      message: kantoor.email,
      ip: '81.204.9.12',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
    },
    {
      at: new Date('2026-03-13T14:30:50Z'),
      type: 'VERZEGELING_OVERGESLAGEN',
      dossierId: dossier.id,
      message: 'Jaarrekening 2025 — bewust zonder zegel verstuurd (niveau auditspoor)',
      metadata: { niveau: 'AUDITSPOOR' }
    },
    {
      at: new Date('2026-03-13T14:30:52Z'),
      type: 'VERZEGELD',
      dossierId: dossier.id,
      metadata: { sealed: false, hashes: { 'Jaarrekening 2025': sha256.slice(0, 16) } }
    },
    // Bewust een gebeurtenis mét interne metadata erbij, om te laten zien dat die
    // NIET in het cliëntgerichte rapport terechtkomt (zie de allowlist in
    // lib/pdf/auditReport.ts).
    {
      at: new Date('2026-03-13T14:31:06Z'),
      type: 'GEARCHIVEERD',
      dossierId: dossier.id,
      message: '1 bestand(en) naar sharepoint',
      metadata: { target: 'Getekende stukken/1042 - Jansen Holding BV/2025' }
    },
    {
      at: new Date('2026-03-16T10:07:19Z'),
      type: 'GEDOWNLOAD',
      dossierId: dossier.id,
      recipientId: client.id,
      message: 'Jaarrekening 2025 (downloadlink)',
      ip: '84.24.101.7'
    }
  ]
  let vorige: string | null = null
  for (const regel of spoor) {
    const { at, ip, userAgent, ...rest } = regel
    const hash = chainHash({
      prevHash: vorige,
      type: rest.type,
      dossierId: rest.dossierId,
      recipientId: rest.recipientId,
      message: rest.message,
      metadata: rest.metadata,
      createdAt: at
    })
    await prisma.auditEvent.create({
      data: { ...rest, ipAddress: ip, userAgent, createdAt: at, prevHash: vorige, hash }
    })
    vorige = hash
  }

  // --- Het auditrapport ---
  stap('auditrapport')
  const rapport = await buildAuditReportFor(dossier.id)
  if (!rapport) throw new Error('geen rapport')
  writeFileSync(`${UIT}/Voorbeeld-auditrapport.pdf`, Buffer.from(rapport.bytes))

  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const rapportDoc = await PDFDocument.load(rapport.bytes)
  const stukDoc = await PDFDocument.load(sealedBytes)
  console.log(`ondertekend document: ${stukDoc.getPageCount()} pagina's`)
  console.log(`auditrapport:         ${rapportDoc.getPageCount()} pagina's, ${rapport.gebeurtenissen} gebeurtenissen`)
  console.log(`ketencontrole:        ${rapport.chainOk ? 'intact' : 'GEBROKEN'}`)

  await schoon()
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
