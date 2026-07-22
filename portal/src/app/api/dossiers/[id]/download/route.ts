import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccountant, requestContext } from '@/lib/auth/session'
import { storage } from '@/lib/storage'
import { writeAudit } from '@/lib/audit'

// Download van het (verzegelde) document als bijlage.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acc = await getCurrentAccountant()
  if (!acc) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const dossier = await prisma.dossier.findUnique({ where: { id: params.id } })
  if (!dossier) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
  if (dossier.ownerId !== acc.id && acc.role !== 'BEHEERDER') {
    return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  }
  const key = dossier.sealedKey ?? dossier.workingKey
  if (!key) return NextResponse.json({ error: 'Geen document' }, { status: 404 })

  const bytes = await storage().get(key)
  await writeAudit({ type: 'GEDOWNLOAD', dossierId: dossier.id, accountantId: acc.id, ...requestContext() })

  const safeName = dossier.fileName.replace(/[^\w.\- ]/g, '_')
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
  })
}
