import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { resolveToken } from '@/lib/signflow'
import { generateOtp } from '@/lib/auth/signingToken'
import { consume } from '@/lib/ratelimit'
import { sendMail } from '@/lib/email/transport'
import { otpEmail } from '@/lib/email/templates'
import { sendSms } from '@/lib/sms/transport'
import { writeAudit } from '@/lib/audit'
import { reqContext } from '@/lib/reqctx'

// Vraagt een verificatiecode aan (2e factor). Kanaal (e-mail of sms) volgt de
// voorkeur van de cliënt; sms alleen als er een telefoonnummer bekend is.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Deze tekenlink is niet (meer) geldig.' }, { status: 410 })

  const ctx = reqContext(req)
  const r = resolved.recipient
  const okRate = await consume('otpRequest', r.id)
  if (!okRate) return NextResponse.json({ error: 'Te veel aanvragen. Probeer het later opnieuw.' }, { status: 429 })

  const { code, hash } = generateOtp()
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000)
  await prisma.recipient.update({
    where: { id: r.id },
    data: { otpHash: hash, otpExpiresAt: expiresAt, otpAttempts: 0, otpVerifiedAt: null }
  })

  const useSms = r.verificationMethod === 'SMS' && !!r.phone
  try {
    if (useSms) {
      await sendSms(
        r.phone as string,
        `Otto Visser & Partners: uw verificatiecode is ${code} (${env.OTP_TTL_MINUTES} min geldig).`
      )
    } else {
      const mail = otpEmail({ recipientName: r.name, code, ttlMinutes: env.OTP_TTL_MINUTES })
      await sendMail({ to: r.email, ...mail })
    }
  } catch (e) {
    console.error('[otp verzenden]', e)
    return NextResponse.json(
      { error: 'De verificatiecode kon niet worden verstuurd. Neem contact op met de afzender.' },
      { status: 502 }
    )
  }

  await writeAudit({ type: 'OTP_VERSTUURD', dossierId: resolved.dossier.id, recipientId: r.id, ...ctx })
  return NextResponse.json({
    ok: true,
    channel: useSms ? 'sms' : 'email',
    destination: useSms ? maskPhone(r.phone as string) : maskEmail(r.email)
  })
}

function maskEmail(e: string): string {
  const [u, d] = e.split('@')
  if (!d) return e
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`
}
function maskPhone(p: string): string {
  const digits = p.replace(/\D/g, '')
  return `•••• •• ${digits.slice(-3)}`
}
