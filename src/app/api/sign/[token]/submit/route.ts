import { NextResponse, type NextRequest } from 'next/server'
import { resolveToken, applySignature } from '@/lib/signflow'
import { signSubmitSchema } from '@/lib/validation/schemas'
import { reqContext } from '@/lib/reqctx'
import { consume } from '@/lib/ratelimit'

// Verwerkt de handtekening: stempelt server-side en verzegelt bij voltooiing.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!(await consume('token', reqContext(req).ip ?? 'onbekend'))) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 })
  }
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Deze tekenlink is niet (meer) geldig.' }, { status: 410 })
  if (!resolved.recipient.otpVerifiedAt) {
    return NextResponse.json({ error: 'Verifieer eerst uw e-mailcode.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = signSubmitSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Ongeldige handtekening.' }, { status: 400 })
  if (parsed.data.signatureDataUrl.length > 1_500_000) {
    return NextResponse.json({ error: 'Handtekening te groot.' }, { status: 400 })
  }

  try {
    await applySignature(resolved.recipient.id, parsed.data.signatureDataUrl, reqContext(req))
  } catch (e) {
    console.error('[sign submit]', e)
    return NextResponse.json({ error: 'Ondertekenen mislukt. Probeer het opnieuw.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
