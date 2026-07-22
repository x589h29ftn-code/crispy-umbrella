import { NextResponse, type NextRequest } from 'next/server'
import { resolveToken } from '@/lib/signflow'
import { storage } from '@/lib/storage'

// Levert het te ondertekenen document — alléén nadat de e-mailcode is geverifieerd.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Ongeldige link' }, { status: 410 })
  if (!resolved.recipient.otpVerifiedAt) {
    return NextResponse.json({ error: 'Verifieer eerst uw e-mailcode.' }, { status: 403 })
  }
  if (!resolved.dossier.workingKey) return NextResponse.json({ error: 'Geen document' }, { status: 404 })

  const bytes = await storage().get(resolved.dossier.workingKey)
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store'
    }
  })
}
