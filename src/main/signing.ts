// Digitale ondertekening (PAdES) in het hoofdproces.
//
// Gratis start: een zelf-ondertekend certificaat dat lokaal in userData/signing
// wordt bewaard. PDF-lezers tonen bij zo'n certificaat "onbekende uitgever" —
// later kan de gebruiker een AATL/gekwalificeerd .p12 importeren voor een
// vertrouwde handtekening. De cryptografie (PKCS#7-CMS) draait via @signpdf;
// node-forge maakt/parseert het certificaat.
import { app } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, stat } from 'fs/promises'
import forge from 'node-forge'

function signingDir(): string {
  return join(app.getPath('userData'), 'signing')
}
function certPath(): string {
  return join(signingDir(), 'self-cert.p12')
}
function certMetaPath(): string {
  return join(signingDir(), 'cert-meta.json')
}

interface CertMeta {
  subject: string
  org?: string
  validTo: number
  createdAt: number
  isSelfSigned: boolean
  passphrase: string
}

export interface CertStatus {
  exists: boolean
  subject?: string
  validTo?: number
  isSelfSigned?: boolean
}

async function readMeta(): Promise<CertMeta | null> {
  try {
    return JSON.parse(await readFile(certMetaPath(), 'utf-8')) as CertMeta
  } catch {
    return null
  }
}

export async function certStatus(): Promise<CertStatus> {
  const meta = await readMeta()
  if (!meta) return { exists: false }
  try {
    await stat(certPath())
  } catch {
    return { exists: false }
  }
  return { exists: true, subject: meta.subject, validTo: meta.validTo, isSelfSigned: meta.isSelfSigned }
}

export async function createSelfCert(
  name: string,
  org?: string
): Promise<{ ok: boolean; subject?: string; validTo?: number; error?: string }> {
  try {
    await mkdir(signingDir(), { recursive: true })
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    // Serienummer moet positief zijn: laat het met '00' beginnen zodat het
    // hoogste bit nooit gezet is.
    cert.serialNumber = '00' + forge.util.bytesToHex(forge.random.getBytesSync(15))
    cert.validity.notBefore = new Date()
    const notAfter = new Date()
    notAfter.setFullYear(notAfter.getFullYear() + 5)
    cert.validity.notAfter = notAfter
    const attrs: forge.pki.CertificateField[] = [
      { name: 'commonName', value: name },
      ...(org ? [{ name: 'organizationName', value: org }] : []),
      { name: 'countryName', value: 'NL' }
    ]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
      { name: 'extKeyUsage', emailProtection: true, clientAuth: true }
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const passphrase = forge.util.bytesToHex(forge.random.getBytesSync(16))
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' })
    const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
    await writeFile(certPath(), Buffer.from(p12Der, 'binary'))
    const meta: CertMeta = {
      subject: name,
      org,
      validTo: notAfter.getTime(),
      createdAt: Date.now(),
      isSelfSigned: true,
      passphrase
    }
    await writeFile(certMetaPath(), JSON.stringify(meta), 'utf-8')
    return { ok: true, subject: name, validTo: notAfter.getTime() }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export async function importP12(
  data: Uint8Array,
  passphrase: string
): Promise<{ ok: boolean; subject?: string; validTo?: number; error?: string }> {
  try {
    await mkdir(signingDir(), { recursive: true })
    const der = forge.util.createBuffer(Buffer.from(data).toString('binary'))
    const asn1 = forge.asn1.fromDer(der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase)
    let subject = 'Onbekend'
    let validTo = 0
    let isSelfSigned = false
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })
    const certBag = bags[forge.pki.oids.certBag]?.[0]
    if (certBag?.cert) {
      const cn = certBag.cert.subject.getField('CN') as { value?: string } | null
      if (cn?.value) subject = cn.value
      validTo = certBag.cert.validity.notAfter.getTime()
      try {
        isSelfSigned = certBag.cert.isIssuer(certBag.cert)
      } catch {
        isSelfSigned = false
      }
    }
    await writeFile(certPath(), Buffer.from(data))
    const meta: CertMeta = { subject, validTo, createdAt: Date.now(), isSelfSigned, passphrase }
    await writeFile(certMetaPath(), JSON.stringify(meta), 'utf-8')
    return { ok: true, subject, validTo }
  } catch (error) {
    return { ok: false, error: 'Kon het certificaat niet lezen — klopt het wachtwoord?' }
  }
}

export interface SignOptions {
  reason?: string
  name?: string
  location?: string
  contactInfo?: string
}

export async function signPades(
  pdfBytes: Uint8Array,
  opts: SignOptions
): Promise<{ ok: boolean; data?: Uint8Array; error?: string }> {
  const meta = await readMeta()
  const p12 = await readFile(certPath()).catch(() => null)
  if (!meta || !p12) {
    return { ok: false, error: 'Geen certificaat — maak eerst een zelf-ondertekend certificaat aan.' }
  }
  try {
    // @signpdf/placeholder-plain verwacht een klassieke cross-reference-tabel;
    // pdf-lib bewaart standaard object-streams. Even opnieuw opslaan zonder
    // object-streams zodat de placeholder betrouwbaar past.
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const doc = await PDFDocument.load(Buffer.from(pdfBytes), { ignoreEncryption: true, updateMetadata: false })
    const normalized = Buffer.from(await doc.save({ useObjectStreams: false }))

    const { plainAddPlaceholder } = await import('@signpdf/placeholder-plain')
    const withPlaceholder = plainAddPlaceholder({
      pdfBuffer: normalized,
      reason: opts.reason || 'Digitaal ondertekend met PDF Studio',
      contactInfo: opts.contactInfo || '',
      name: opts.name || meta.subject,
      location: opts.location || ''
    })

    const { P12Signer } = await import('@signpdf/signer-p12')
    // De named export gebruiken: bij een dynamische import van deze CJS-module
    // is `.default` de hele namespace, niet de instance — via `SignPdf`
    // instantiëren we betrouwbaar.
    const { SignPdf } = await import('@signpdf/signpdf')
    const signer = new P12Signer(p12, { passphrase: meta.passphrase })
    const signed = await new SignPdf().sign(withPlaceholder, signer)
    return { ok: true, data: new Uint8Array(signed) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
