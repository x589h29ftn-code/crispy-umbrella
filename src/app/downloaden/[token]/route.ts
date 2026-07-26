import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { storage } from '@/lib/storage'
import { hashSigningToken } from '@/lib/auth/signingToken'
import { writeAudit } from '@/lib/audit'
import { consume } from '@/lib/ratelimit'
import { requestContext } from '@/lib/auth/session'

// Het getekende exemplaar ophalen met het downloadtoken uit de voltooiingsmail
// (D uit changeset v1.7).
//
// Bewust een ANDERE route en een ANDERE validatie dan het tekentoken. Dat token
// is eenmalig en verbruikt na ondertekening; hergebruiken om te downloaden zou
// betekenen dat het moet blijven leven, en dan is het geen eenmalig token meer.
//
// Dit token is herbruikbaar binnen zijn termijn — een download is een download,
// geen handeling — maar kan niet worden gebruikt om te ondertekenen: die route
// zoekt op `tokenHash` en komt hier nooit uit.
//
// De blootstelling is begrensd: het verzegelde PDF zit al als bijlage in
// diezelfde mailbox, dus het token geeft geen toegang die er niet al was.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { ip, userAgent } = requestContext()
  if (!(await consume('download', `${ip ?? 'onbekend'}`))) {
    return new NextResponse('Te veel verzoeken. Probeer het later opnieuw.', { status: 429 })
  }

  const raw = params.token
  if (!raw || raw.length < 10) return new NextResponse('Onbekende link.', { status: 404 })

  const recipient = await prisma.recipient.findUnique({
    where: { downloadTokenHash: hashSigningToken(raw) },
    include: {
      dossier: {
        include: { documents: { orderBy: { order: 'asc' } } }
      }
    }
  })
  if (!recipient?.downloadTokenHash) return new NextResponse('Onbekende link.', { status: 404 })
  if (!recipient.downloadTokenExpiresAt || recipient.downloadTokenExpiresAt.getTime() < Date.now()) {
    return new NextResponse(
      'Deze downloadlink is verlopen. Het document zat als bijlage bij de e-mail waarin u deze link kreeg; ' +
        'neem anders contact op met uw contactpersoon.',
      { status: 410 }
    )
  }

  const documenten = recipient.dossier.documents.filter((d) => d.sealedKey)
  if (documenten.length === 0) {
    // Kan gebeuren na het opschonen van de bestanden (90 dagen): de rijen staan
    // er nog, de blobs niet meer. Dat is geen fout maar een uitgelegde toestand.
    return new NextResponse(
      'Dit document is niet meer beschikbaar in het portaal. Het zat als bijlage bij de e-mail waarin u ' +
        'deze link kreeg; neem anders contact op met uw contactpersoon.',
      { status: 410 }
    )
  }

  // Welk document? Bij één document dat ene; bij meerdere kiest ?doc=<id>, met
  // het eerste als standaard zodat een kale link altijd iets oplevert.
  const gevraagd = req.nextUrl.searchParams.get('doc')
  const doc = (gevraagd && documenten.find((d) => d.id === gevraagd)) || documenten[0]

  let bytes: Uint8Array
  try {
    bytes = await storage().get(doc.sealedKey!)
  } catch (e) {
    console.error('[downloaden] blob niet leesbaar', e)
    return new NextResponse('Het document kon niet worden opgehaald.', { status: 500 })
  }

  await writeAudit({
    type: 'GEDOWNLOAD',
    dossierId: recipient.dossierId,
    recipientId: recipient.id,
    message: `${doc.title} (downloadlink)`,
    metadata: { documentId: doc.id, sha256: doc.sealedSha256 },
    ip,
    userAgent
  })

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${doc.fileName.replace(/[^\w.\- ]+/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
  })
}
