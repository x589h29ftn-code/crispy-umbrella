import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { resolveToken } from '@/lib/signflow'
import { generateOtp } from '@/lib/auth/signingToken'
import { consume } from '@/lib/ratelimit'
import { sendMail } from '@/lib/email/transport'
import { otpEmail } from '@/lib/email/templates'
import { writeAudit } from '@/lib/audit'
import { reqContext } from '@/lib/reqctx'

// Vraagt een e-mail-OTP aan voor de ondertekenaar (2e factor).
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Deze tekenlink is niet (meer) geldig.' }, { status: 410 })

  const ctx = reqContext(req)
  const okRate = await consume('otpRequest', resolved.recipient.id)
  if (!okRate) return NextResponse.json({ error: 'Te veel aanvragen. Probeer het later opnieuw.' }, { status: 429 })

  const { code, hash } = generateOtp()
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000)
  await prisma.recipient.update({
    where: { id: resolved.recipient.id },
    data: { otpHash: hash, otpExpiresAt: expiresAt, otpAttempts: 0, otpVerifiedAt: null }
  })
  const mail = otpEmail({ recipientName: resolved.recipient.name, code, ttlMinutes: env.OTP_TTL_MINUTES })
  await sendMail({ to: resolved.recipient.email, ...mail })
  await writeAudit({
    type: 'OTP_VERSTUURD',
    dossierId: resolved.dossier.id,
    recipientId: resolved.recipient.id,
    ...ctx
  })
  return NextResponse.json({ ok: true, email: maskEmail(resolved.recipient.email) })
}

function maskEmail(e: string): string {
  const [u, d] = e.split('@')
  if (!d) return e
  const shown = u.slice(0, 2)
  return `${shown}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`
}
