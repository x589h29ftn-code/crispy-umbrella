import { NextResponse, type NextRequest } from 'next/server'
import { resolveToken, declineSignature } from '@/lib/signflow'
import { declineSchema } from '@/lib/validation/schemas'
import { reqContext } from '@/lib/reqctx'

// Ontvanger weigert te tekenen.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Deze tekenlink is niet (meer) geldig.' }, { status: 410 })
  if (!resolved.recipient.otpVerifiedAt) {
    return NextResponse.json({ error: 'Verifieer eerst uw e-mailcode.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const parsed = declineSchema.safeParse(body)
  const reason = parsed.success ? (parsed.data.reason as string | undefined) : undefined
  await declineSignature(resolved.recipient.id, reason, reqContext(req))
  return NextResponse.json({ ok: true })
}
