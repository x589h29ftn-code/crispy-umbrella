import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccountant } from '@/lib/auth/session'
import { storage } from '@/lib/storage'

// Levert de (werk-)PDF van een dossier voor weergave in de browser.
// Alleen de eigenaar of een beheerder mag hem opvragen.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acc = await getCurrentAccountant()
  if (!acc) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const dossier = await prisma.dossier.findUnique({ where: { id: params.id } })
  if (!dossier) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
  // Toegang: eigenaar, beheerder, of een kantoorgebruiker die zelf op dit
  // dossier moet tekenen.
  const isSigner =
    dossier.ownerId !== acc.id && acc.role !== 'BEHEERDER'
      ? (await prisma.recipient.count({ where: { dossierId: dossier.id, accountantId: acc.id } })) > 0
      : true
  if (!isSigner) {
    return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  }

  const which = req.nextUrl.searchParams.get('which')
  const key = which === 'sealed' && dossier.sealedKey ? dossier.sealedKey : dossier.workingKey
  if (!key) return NextResponse.json({ error: 'Geen document' }, { status: 404 })

  const bytes = await storage().get(key)
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store'
    }
  })
}
