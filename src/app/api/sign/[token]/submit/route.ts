import { NextResponse, type NextRequest } from 'next/server'
import { resolveToken, applySignature } from '@/lib/signflow'
import { signSubmitSchema } from '@/lib/validation/schemas'
import { reqContext } from '@/lib/reqctx'
import { consume } from '@/lib/ratelimit'
import { isLockTimeout, DRUKTE_MELDING } from '@/lib/locks'
import { AuditWriteError } from '@/lib/audit'

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
    // Wachten op een vergrendeling betekent dat iemand anders net dit document
    // verwerkt. Er is niets kapot en het token is niet verbruikt (dat zit in
    // dezelfde transactie), dus dit is een herhaalbare melding en geen 500.
    if (isLockTimeout(e)) {
      console.warn('[sign submit] vergrendeling verlopen', e)
      return NextResponse.json({ error: DRUKTE_MELDING, retryable: true }, { status: 409 })
    }
    // Een verplichte auditregel die niet lukt heeft de hele transactie
    // teruggerold: er staat geen stempel en het token is nog bruikbaar.
    if (e instanceof AuditWriteError) {
      console.error('[sign submit] auditregel mislukt', e)
      return NextResponse.json(
        {
          error:
            'Uw ondertekening kon niet worden vastgelegd en is daarom niet verwerkt. ' +
            'Probeer het opnieuw; neem contact op als het blijft mislukken.',
          retryable: true
        },
        { status: 503 }
      )
    }
    console.error('[sign submit]', e)
    return NextResponse.json({ error: 'Ondertekenen mislukt. Probeer het opnieuw.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
