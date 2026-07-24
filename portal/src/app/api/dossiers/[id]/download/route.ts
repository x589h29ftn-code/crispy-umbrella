import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccountant, requestContext } from '@/lib/auth/session'
import { storage } from '@/lib/storage'
import { sha256Hex } from '@/lib/seal/sealer'
import { writeAudit } from '@/lib/audit'

// Download van één (verzegeld) document uit een dossier als bijlage.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acc = await getCurrentAccountant()
  if (!acc) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const dossier = await prisma.dossier.findUnique({ where: { id: params.id } })
  if (!dossier) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
  if (dossier.ownerId !== acc.id && acc.role !== 'BEHEERDER') {
    return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  }
  const documentId = req.nextUrl.searchParams.get('documentId')
  const doc = documentId
    ? await prisma.document.findFirst({ where: { id: documentId, dossierId: dossier.id } })
    : await prisma.document.findFirst({ where: { dossierId: dossier.id }, orderBy: { order: 'asc' } })
  if (!doc) return NextResponse.json({ error: 'Geen document' }, { status: 404 })
  const key = doc.sealedKey ?? doc.workingKey
  if (!key) return NextResponse.json({ error: 'Geen document' }, { status: 404 })

  const bytes = await storage().get(key)

  // Integriteitscontrole: is dit nog exact het bestand dat is verzegeld? Wijkt de
  // hash af, dan is er onderweg iets aan het bestand veranderd (bijvoorbeeld door
  // een tool die de PDF herschrijft) en gaat de download niet door.
  if (doc.sealedKey && key === doc.sealedKey && doc.sealedSha256) {
    const actual = sha256Hex(bytes)
    if (actual !== doc.sealedSha256) {
      await writeAudit({
        type: 'INTEGRITEIT_AFWIJKING',
        dossierId: dossier.id,
        accountantId: acc.id,
        message: `document ${doc.id}: hash wijkt af van het zegel`,
        metadata: { expected: doc.sealedSha256, actual },
        ...requestContext()
      })
      return NextResponse.json(
        { error: 'Integriteitscontrole mislukt: dit bestand wijkt af van de verzegelde versie. Neem contact op met de beheerder.' },
        { status: 409 }
      )
    }
  }

  await writeAudit({ type: 'GEDOWNLOAD', dossierId: dossier.id, accountantId: acc.id, ...requestContext() })

  const safeName = doc.fileName.replace(/[^\w.\- ]/g, '_')
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
  })
}
