import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from '@cantoo/pdf-lib'

/**
 * PDF/A (archiefexport).
 *
 * Een archief-PDF moet zelfstandig te openen zijn, ook over twintig jaar: alle
 * lettertypen zitten in het bestand, de kleuren zijn vastgelegd met een
 * kleurprofiel (OutputIntent) en de documentgegevens staan als XMP-metadata in
 * de PDF. Dat is precies wat deze module toevoegt.
 *
 * We schrijven PDF/A-2b. Deel 2 (en niet 1) omdat markeringen en watermerken
 * doorzichtigheid gebruiken, wat in deel 1 verboden is en in deel 2 mag; "b"
 * (basic) omdat we het beeld en de tekst vastleggen, niet de logische
 * leesstructuur voor voorleessoftware (dat is "a").
 *
 * Wat we niet kunnen: lettertypen die in een bestaand, geopend PDF-bestand niet
 * zijn ingebed kunnen we niet alsnog toevoegen — die glyphen zitten simpelweg
 * niet in het bestand. Zulke documenten zijn daarom niet gegarandeerd geldig
 * PDF/A. De tekst die PDF Studio zelf toevoegt (tekstvakken, watermerk,
 * paginanummers, stempels, veldlabels) wordt in PDF/A-modus altijd met een
 * ingebed lettertype geschreven.
 */

export const PDFA_PART = 2
export const PDFA_CONFORMANCE = 'B'

/** s15Fixed16 (ICC): een getal als 16.16 vaste komma, big-endian. */
function s15f16(value: number): number {
  return Math.round(value * 65536)
}

function writeUint32(bytes: number[], value: number): void {
  bytes.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)
}

function writeUint16(bytes: number[], value: number): void {
  bytes.push((value >>> 8) & 255, value & 255)
}

function writeAscii(bytes: number[], text: string): void {
  for (let i = 0; i < text.length; i += 1) bytes.push(text.charCodeAt(i) & 127)
}

/** XYZType-tag: drie s15Fixed16-waarden met een kop van 8 bytes. */
function xyzTag(x: number, y: number, z: number): number[] {
  const bytes: number[] = []
  writeAscii(bytes, 'XYZ ')
  writeUint32(bytes, 0)
  for (const v of [x, y, z]) writeUint32(bytes, s15f16(v))
  return bytes
}

/**
 * curveType met de échte sRGB-toonkromme als tabel. Eén enkele gammawaarde
 * (2,2) zou een klein verschil geven in de donkere tinten; met 1024 punten
 * volgen we de kromme uit de sRGB-norm exact.
 */
function srgbCurveTag(points = 1024): number[] {
  const bytes: number[] = []
  writeAscii(bytes, 'curv')
  writeUint32(bytes, 0)
  writeUint32(bytes, points)
  for (let i = 0; i < points; i += 1) {
    const x = i / (points - 1)
    const linear = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    writeUint16(bytes, Math.max(0, Math.min(65535, Math.round(linear * 65535))))
  }
  return bytes
}

/** textDescriptionType (ICC v2): ASCII-naam plus lege Unicode/Script-velden. */
function descTag(text: string): number[] {
  const bytes: number[] = []
  writeAscii(bytes, 'desc')
  writeUint32(bytes, 0)
  writeUint32(bytes, text.length + 1)
  writeAscii(bytes, text)
  bytes.push(0)
  writeUint32(bytes, 0) // Unicode-taalcode
  writeUint32(bytes, 0) // Unicode-lengte
  writeUint16(bytes, 0) // ScriptCode-code
  bytes.push(0) // ScriptCode-lengte
  for (let i = 0; i < 67; i += 1) bytes.push(0)
  return bytes
}

function textTag(text: string): number[] {
  const bytes: number[] = []
  writeAscii(bytes, 'text')
  writeUint32(bytes, 0)
  writeAscii(bytes, text)
  bytes.push(0)
  return bytes
}

/**
 * Bouwt een klein sRGB-kleurprofiel (ICC v2, matrix/TRC) om als OutputIntent in
 * de PDF te zetten. De primaries en het witpunt zijn de D50-waarden van
 * sRGB IEC61966-2.1; de toonkromme is de sRGB-kromme zelf, als tabel van 1024
 * punten.
 *
 * Zelf opbouwen in plaats van een profiel meeleveren: zo blijft de app klein en
 * hoeft er niets van het besturingssysteem gelezen te worden (wat op de ene pc
 * lukt en op de andere niet).
 */
export function buildSrgbIccProfile(): Uint8Array {
  const tags: { sig: string; data: number[] }[] = [
    { sig: 'desc', data: descTag('sRGB IEC61966-2.1') },
    { sig: 'cprt', data: textTag('Public Domain') },
    { sig: 'wtpt', data: xyzTag(0.9642, 1, 0.8249) },
    { sig: 'rXYZ', data: xyzTag(0.4360, 0.2225, 0.0139) },
    { sig: 'gXYZ', data: xyzTag(0.3851, 0.7169, 0.0971) },
    { sig: 'bXYZ', data: xyzTag(0.1431, 0.0606, 0.7141) },
    // Alle drie de kanalen delen dezelfde kromme (zoals in sRGB).
    { sig: 'rTRC', data: srgbCurveTag() },
    { sig: 'gTRC', data: srgbCurveTag() },
    { sig: 'bTRC', data: srgbCurveTag() }
  ]

  const headerSize = 128
  const tableSize = 4 + tags.length * 12
  // Elke tag begint op een veelvoud van 4 bytes.
  let offset = headerSize + tableSize
  const placed = tags.map((tag) => {
    const start = offset + ((4 - (offset % 4)) % 4)
    offset = start + tag.data.length
    return { ...tag, start }
  })
  const total = offset + ((4 - (offset % 4)) % 4)

  const out = new Uint8Array(total)
  const header: number[] = []
  writeUint32(header, total)
  writeAscii(header, 'ADBE') // voorkeur-CMM
  writeUint32(header, 0x02100000) // versie 2.1
  writeAscii(header, 'mntr') // apparaatklasse: beeldscherm
  writeAscii(header, 'RGB ')
  writeAscii(header, 'XYZ ') // profielverbindingsruimte
  // Datum/tijd: een vaste waarde, zodat twee exports van hetzelfde document
  // byte-identiek blijven.
  for (const part of [2024, 1, 1, 0, 0, 0]) writeUint16(header, part)
  writeAscii(header, 'acsp')
  writeAscii(header, 'MSFT')
  writeUint32(header, 0) // vlaggen
  writeUint32(header, 0) // fabrikant
  writeUint32(header, 0) // model
  writeUint32(header, 0) // eigenschappen (8 bytes)
  writeUint32(header, 0)
  writeUint32(header, 0) // weergavedoel: perceptueel
  for (const v of [0.9642, 1, 0.8249]) writeUint32(header, s15f16(v)) // PCS-illuminant D50
  writeUint32(header, 0) // maker
  while (header.length < headerSize) header.push(0)
  out.set(header, 0)

  const table: number[] = []
  writeUint32(table, placed.length)
  for (const tag of placed) {
    writeAscii(table, tag.sig)
    writeUint32(table, tag.start)
    writeUint32(table, tag.data.length)
  }
  out.set(table, headerSize)
  for (const tag of placed) out.set(tag.data, tag.start)
  return out
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** ISO-8601 zonder milliseconden, zoals XMP het verwacht. */
function xmpDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

export interface PdfAMeta {
  title: string
  author?: string
  subject?: string
  keywords?: string[]
  producer: string
  creator: string
  date: Date
  /** Vast id (uuid) van dit document, voor xmpMM:DocumentID. */
  documentId: string
}

/** De XMP-pakketstroom die naast de Info-woordenlijst in de PDF komt te staan. */
export function pdfaXmp(meta: PdfAMeta): string {
  const stamp = xmpDate(meta.date)
  const keywords = (meta.keywords ?? []).filter(Boolean)
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(meta.title)}</rdf:li></rdf:Alt></dc:title>
${meta.author ? `   <dc:creator><rdf:Seq><rdf:li>${escapeXml(meta.author)}</rdf:li></rdf:Seq></dc:creator>\n` : ''}${
    meta.subject
      ? `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(meta.subject)}</rdf:li></rdf:Alt></dc:description>\n`
      : ''
  }${keywords.length ? `   <dc:subject><rdf:Bag>${keywords.map((k) => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>\n` : ''}  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${escapeXml(meta.creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${stamp}</xmp:CreateDate>
   <xmp:ModifyDate>${stamp}</xmp:ModifyDate>
   <xmp:MetadataDate>${stamp}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${escapeXml(meta.producer)}</pdf:Producer>
${keywords.length ? `   <pdf:Keywords>${escapeXml(keywords.join(', '))}</pdf:Keywords>\n` : ''}  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
   <xmpMM:DocumentID>uuid:${meta.documentId}</xmpMM:DocumentID>
   <xmpMM:InstanceID>uuid:${meta.documentId}</xmpMM:InstanceID>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>${PDFA_PART}</pdfaid:part>
   <pdfaid:conformance>${PDFA_CONFORMANCE}</pdfaid:conformance>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/**
 * Maakt van een opgebouwd document een PDF/A-2b-bestand: XMP-metadata, het
 * sRGB-kleurprofiel als OutputIntent en een documentidentificatie in de trailer.
 * Aanroepen als laatste stap, vlak voor `save()`.
 */
export function applyPdfA(doc: PDFDocument, meta: PdfAMeta): void {
  const context = doc.context

  // 1. XMP-metadata. Ongecomprimeerd en zonder filter: een PDF/A-lezer moet de
  //    metadata kunnen lezen zonder de PDF te ontleden.
  const xmp = context.stream(pdfaXmp(meta), {
    Type: 'Metadata',
    Subtype: 'XML'
  })
  doc.catalog.set(PDFName.of('Metadata'), context.register(xmp))

  // 2. OutputIntent met het sRGB-profiel: legt vast hoe de kleuren bedoeld zijn.
  const profile = buildSrgbIccProfile()
  const iccRef = context.register(
    context.flateStream(profile, { N: 3, Range: [0, 1, 0, 1, 0, 1] })
  )
  const intent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    DestOutputProfile: iccRef
  })
  doc.catalog.set(PDFName.of('OutputIntents'), context.obj([context.register(intent)]))

  // 3. Documentidentificatie in de trailer (verplicht in PDF/A).
  const id = PDFHexString.of(meta.documentId.replace(/-/g, '').toUpperCase())
  context.trailerInfo.ID = context.obj([id, id])
}

/** Verzamelt de naam van een lettertype als het níet in het bestand zit. */
function collectFont(doc: PDFDocument, dict: PDFDict, found: Set<string>): void {
  const subtype = String(dict.get(PDFName.of('Subtype')) ?? '')
  // Type3-lettertypen bestaan uit tekeningen in de PDF zelf: die zijn per
  // definitie compleet.
  if (subtype === '/Type3') return
  if (subtype === '/Type0') {
    // Samengesteld lettertype: het echte lettertype hangt eronder.
    const descendants = dict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)
    const first = descendants && descendants.size() ? doc.context.lookup(descendants.get(0)) : null
    if (first instanceof PDFDict) {
      collectFont(doc, first, found)
      return
    }
  }
  const descriptor = dict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
  const embedded =
    descriptor !== undefined &&
    ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.get(PDFName.of(key)) !== undefined)
  if (embedded) return
  const base = String(dict.get(PDFName.of('BaseFont')) ?? '')
    .replace(/^\//, '')
    // Subset-lettertypen beginnen met zes hoofdletters en een plus.
    .replace(/^[A-Z]{6}\+/, '')
  if (base) found.add(base)
}

/**
 * Zoekt de lettertypen die in het document worden gebruikt maar niet zijn
 * ingebed. Die kunnen wij niet toevoegen (de glyphen zitten niet in het
 * bronbestand), en juist daarop keurt een PDF/A-validator af — dus melden we
 * het eerlijk bij het opslaan.
 */
export function nonEmbeddedFontNames(doc: PDFDocument): string[] {
  const found = new Set<string>()
  for (const page of doc.getPages()) {
    const resources = page.node.Resources()
    const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (!fonts) continue
    for (const [, value] of fonts.entries()) {
      const dict = value instanceof PDFRef ? doc.context.lookup(value) : value
      if (dict instanceof PDFDict) collectFont(doc, dict, found)
    }
  }
  return [...found].sort()
}
