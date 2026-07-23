'use server'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { hashPasswordResetToken } from '@/lib/auth/signingToken'
import { requestContext } from '@/lib/auth/session'
import { consume } from '@/lib/ratelimit'
import { writeAudit } from '@/lib/audit'

export interface ResetState {
  error?: string
}

/** Zoekt de gebruiker bij een geldige, niet-verlopen hersteltoken. */
async function findByToken(rawToken: string) {
  if (!rawToken || rawToken.length < 10) return null
  const user = await prisma.accountant.findFirst({
    where: { passwordResetTokenHash: hashPasswordResetToken(rawToken) }
  })
  if (!user || !user.active) return null
  if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt.getTime() < Date.now()) return null
  return user
}

export async function isValidResetToken(rawToken: string): Promise<boolean> {
  return (await findByToken(rawToken)) !== null
}

export async function resetPasswordWithTokenAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const rawToken = String(formData.get('token') ?? '')
  const next = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  const { ip } = requestContext()
  const ok = await consume('passwordReset', `reset:${ip ?? 'onbekend'}`)
  if (!ok) return { error: 'Te veel pogingen. Probeer het later opnieuw.' }

  if (next.length < 10) return { error: 'Kies een wachtwoord van minimaal 10 tekens.' }
  if (next !== confirm) return { error: 'De twee wachtwoorden komen niet overeen.' }

  const user = await findByToken(rawToken)
  if (!user) return { error: 'Deze herstellink is ongeldig of verlopen. Vraag een nieuwe aan.' }

  await prisma.accountant.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(next),
      mustChangePassword: false,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null
    }
  })
  // Alle bestaande sessies intrekken (veiligheid); gebruiker logt opnieuw in.
  await prisma.session.deleteMany({ where: { accountantId: user.id } })
  await writeAudit({ type: 'INGETROKKEN', accountantId: user.id, message: 'Wachtwoord opnieuw ingesteld via herstellink' })

  redirect('/login?reset=1')
}
