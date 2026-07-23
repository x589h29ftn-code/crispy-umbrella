import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveToken } from '@/lib/signflow'
import { storage } from '@/lib/storage'
import { consume } from '@/lib/ratelimit'
import { reqContext } from '@/lib/reqctx'

// Levert het te ondertekenen document - alléén nadat de e-mailcode is geverifieerd.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!(await consume('token', reqContext(req).ip ?? 'onbekend'))) {
    return NextResponse.json({ error: 'Te veel verzoeken.' }, { status: 429 })
  }
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Ongeldige link' }, { status: 410 })
  if (!resolved.recipient.otpVerifiedAt) {
    return NextResponse.json({ error: 'Verifieer eerst uw e-mailcode.' }, { status: 403 })
  }
  const documentId = req.nextUrl.searchParams.get('documentId')
  const doc = documentId
    ? await prisma.document.findFirst({ where: { id: documentId, dossierId: resolved.dossier.id } })
    : await prisma.document.findFirst({ where: { dossierId: resolved.dossier.id }, orderBy: { order: 'asc' } })
  if (!doc?.workingKey) return NextResponse.json({ error: 'Geen document' }, { status: 404 })

  const bytes = await storage().get(doc.workingKey)
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
  })
}
