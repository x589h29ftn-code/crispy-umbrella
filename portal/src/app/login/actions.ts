'use server'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { verifyPassword, hashPassword } from '@/lib/auth/password'
import { verifyTotp, decryptTotpSecret } from '@/lib/auth/totp'
import { consumeBackupCode, looksLikeBackupCode } from '@/lib/auth/backupCodes'
import {
  createSession,
  setPending2fa,
  getPending2fa,
  clearPending2fa,
  requestContext
} from '@/lib/auth/session'
import { consume } from '@/lib/ratelimit'
import { loginSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit'

export interface FormState {
  error?: string
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password')
  })
  if (!parsed.success) return { error: 'Vul een geldig e-mailadres en wachtwoord in.' }

  const { ip } = requestContext()
  const ok = await consume('login', `${ip ?? 'onbekend'}:${parsed.data.email.toLowerCase()}`)
  if (!ok) return { error: 'Te veel pogingen. Probeer het over enkele minuten opnieuw.' }

  const accountant = await prisma.accountant.findUnique({ where: { email: parsed.data.email.toLowerCase() } })
  // Altijd hetzelfde generieke antwoord (voorkomt account-enumeratie).
  const generic = { error: 'Onjuiste inloggegevens.' }
  // Bestaat het account niet, verbruik toch vergelijkbare rekentijd zodat de
  // responstijd niet verklapt of een e-mailadres bekend is.
  if (!accountant) {
    await hashPassword(parsed.data.password)
    return generic
  }
  const valid = await verifyPassword(accountant.passwordHash, parsed.data.password)
  if (!valid || !accountant.active) return generic

  if (accountant.totpEnabled && accountant.totpSecret) {
    setPending2fa(accountant.id)
    redirect('/login/2fa')
  }
  // Nog geen 2FA ingesteld: inloggen, maar de app dwingt het instellen af.
  await createSession(accountant.id)
  redirect('/instellingen')
}

export async function verify2faAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const accountantId = getPending2fa()
  if (!accountantId) redirect('/login')

  const code = String(formData.get('code') ?? '').trim()
  if (!code) return { error: 'Voer de code in.' }

  const { ip } = requestContext()
  const ok = await consume('totp', `${ip ?? 'onbekend'}:${accountantId}`)
  if (!ok) return { error: 'Te veel pogingen. Probeer het over enkele minuten opnieuw.' }

  const accountant = await prisma.accountant.findUnique({ where: { id: accountantId } })
  if (!accountant?.totpSecret) redirect('/login')

  // Herstelcode (bij geen toegang tot de app) of gewone 6-cijferige TOTP-code.
  if (looksLikeBackupCode(code)) {
    const remaining = consumeBackupCode(code, accountant.totpBackupCodes)
    if (!remaining) return { error: 'Onjuiste of al gebruikte herstelcode.' }
    await prisma.accountant.update({ where: { id: accountant.id }, data: { totpBackupCodes: remaining } })
    await writeAudit({ type: 'INGELOGD', accountantId: accountant.id, message: 'Ingelogd met herstelcode' })
  } else {
    const secret = decryptTotpSecret(accountant.totpSecret)
    if (!/^\d{6}$/.test(code) || !verifyTotp(secret, code)) return { error: 'Onjuiste of verlopen code.' }
  }

  clearPending2fa()
  await createSession(accountant.id)
  redirect('/dashboard')
}
