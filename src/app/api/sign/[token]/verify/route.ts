import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveToken } from '@/lib/signflow'
import { hashOtp, safeEqualHash } from '@/lib/auth/signingToken'
import { otpVerifySchema } from '@/lib/validation/schemas'
import { consume } from '@/lib/ratelimit'
import { writeAudit } from '@/lib/audit'
import { reqContext } from '@/lib/reqctx'

const MAX_ATTEMPTS = 5

// Verifieert de 6-cijferige e-mailcode.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Deze tekenlink is niet (meer) geldig.' }, { status: 410 })

  const body = await req.json().catch(() => ({}))
  const parsed = otpVerifySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Voer de 6-cijferige code in.' }, { status: 400 })

  const okRate = await consume('otpVerify', resolved.recipient.id)
  if (!okRate) return NextResponse.json({ error: 'Te veel pogingen. Vraag een nieuwe code aan.' }, { status: 429 })

  const r = resolved.recipient
  if (!r.otpHash || !r.otpExpiresAt || r.otpExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'De code is verlopen. Vraag een nieuwe aan.' }, { status: 400 })
  }
  if (r.otpAttempts >= MAX_ATTEMPTS) {
    await prisma.recipient.update({ where: { id: r.id }, data: { otpHash: null } })
    return NextResponse.json({ error: 'Te veel foute pogingen. Vraag een nieuwe code aan.' }, { status: 429 })
  }

  if (!safeEqualHash(hashOtp(parsed.data.code), r.otpHash)) {
    await prisma.recipient.update({ where: { id: r.id }, data: { otpAttempts: { increment: 1 } } })
    return NextResponse.json({ error: 'Onjuiste code.' }, { status: 400 })
  }

  await prisma.recipient.update({
    where: { id: r.id },
    data: { otpVerifiedAt: new Date(), otpHash: null }
  })
  await writeAudit({
    type: 'OTP_GEVERIFIEERD',
    dossierId: resolved.dossier.id,
    recipientId: r.id,
    ...reqContext(req)
  })
  return NextResponse.json({ ok: true })
}
