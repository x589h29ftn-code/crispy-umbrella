'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { requestContext } from '@/lib/auth/session'
import { generatePasswordResetToken } from '@/lib/auth/signingToken'
import { consume } from '@/lib/ratelimit'
import { sendMail } from '@/lib/email/transport'
import { passwordResetEmail } from '@/lib/email/templates'
import { writeAudit } from '@/lib/audit'

const TTL_MINUTES = 60

export interface RequestState {
  done?: boolean
  error?: string
}

const schema = z.object({ email: z.string().email().max(200) })

export async function requestPasswordResetAction(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const parsed = schema.safeParse({ email: formData.get('email') })
  // Altijd dezelfde melding (voorkomt dat je kunt achterhalen welke adressen bestaan).
  const generic: RequestState = { done: true }
  if (!parsed.success) return { error: 'Vul een geldig e-mailadres in.' }

  const { ip } = requestContext()
  const email = parsed.data.email.toLowerCase()
  const ok = await consume('passwordReset', `${ip ?? 'onbekend'}:${email}`)
  if (!ok) return generic // stil: niet verklappen dat er iets aan de hand is

  const user = await prisma.accountant.findUnique({ where: { email } })
  if (user && user.active) {
    const { raw, hash } = generatePasswordResetToken()
    await prisma.accountant.update({
      where: { id: user.id },
      data: { passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(Date.now() + TTL_MINUTES * 60_000) }
    })
    const mail = passwordResetEmail({
      name: user.name,
      url: `${env.APP_URL}/wachtwoord-herstellen/${raw}`,
      ttlMinutes: TTL_MINUTES
    })
    await sendMail({ to: user.email, ...mail }).catch((e) => console.error('[password reset mail]', e))
    await writeAudit({ type: 'INGETROKKEN', accountantId: user.id, message: 'Wachtwoordherstel aangevraagd' })
  }
  return generic
}
