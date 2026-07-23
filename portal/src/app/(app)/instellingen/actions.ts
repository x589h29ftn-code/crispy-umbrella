'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAccountant, createSession } from '@/lib/auth/session'
import { verifyTotp, decryptTotpSecret } from '@/lib/auth/totp'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { generateBackupCodes } from '@/lib/auth/backupCodes'
import { totpVerifySchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit'

export interface FormState {
  error?: string
  ok?: boolean
  backupCodes?: string[] // eenmalig getoond na activeren/opnieuw genereren
}

export async function enable2faAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const acc = await requireAccountant()
  if (!acc.totpSecret) return { error: 'Geen secret gevonden. Herlaad de pagina.' }
  const parsed = totpVerifySchema.safeParse({ code: formData.get('code') })
  if (!parsed.success) return { error: 'Voer de 6-cijferige code in.' }
  const secret = decryptTotpSecret(acc.totpSecret)
  if (!verifyTotp(secret, parsed.data.code)) return { error: 'Onjuiste code. Probeer opnieuw.' }
  const { plain, hashes } = generateBackupCodes()
  await prisma.accountant.update({
    where: { id: acc.id },
    data: { totpEnabled: true, totpBackupCodes: hashes }
  })
  revalidatePath('/instellingen')
  return { ok: true, backupCodes: plain }
}

/// Genereert een nieuwe set herstelcodes (de oude vervallen daarmee).
export async function regenerateBackupCodesAction(): Promise<FormState> {
  const acc = await requireAccountant()
  if (!acc.totpEnabled) return { error: 'Schakel eerst tweefactorauthenticatie in.' }
  const { plain, hashes } = generateBackupCodes()
  await prisma.accountant.update({ where: { id: acc.id }, data: { totpBackupCodes: hashes } })
  revalidatePath('/instellingen')
  return { ok: true, backupCodes: plain }
}

export async function disable2faAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const acc = await requireAccountant()
  const password = String(formData.get('password') ?? '')
  const fresh = await prisma.accountant.findUnique({ where: { id: acc.id } })
  if (!fresh || !(await verifyPassword(fresh.passwordHash, password))) {
    return { error: 'Onjuist wachtwoord.' }
  }
  await prisma.accountant.update({
    where: { id: acc.id },
    data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] }
  })
  await writeAudit({ type: 'INGETROKKEN', accountantId: acc.id, message: '2FA uitgeschakeld' })
  revalidatePath('/instellingen')
  return { ok: true }
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const acc = await requireAccountant()
  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('next') ?? '')
  if (next.length < 10) return { error: 'Kies een nieuw wachtwoord van minimaal 10 tekens.' }
  const fresh = await prisma.accountant.findUnique({ where: { id: acc.id } })
  if (!fresh || !(await verifyPassword(fresh.passwordHash, current))) {
    return { error: 'Huidig wachtwoord is onjuist.' }
  }
  await prisma.accountant.update({
    where: { id: acc.id },
    data: { passwordHash: await hashPassword(next), mustChangePassword: false }
  })
  // Trek alle bestaande sessies in en geef deze sessie een verse cookie.
  await prisma.session.deleteMany({ where: { accountantId: acc.id } })
  await createSession(acc.id)
  revalidatePath('/instellingen')
  return { ok: true }
}

export async function saveSignatureAction(dataUrl: string): Promise<{ ok: boolean; error?: string }> {
  const acc = await requireAccountant()
  if (!/^data:image\/(png|jpe?g);base64,/.test(dataUrl) || dataUrl.length > 1_500_000) {
    return { ok: false, error: 'Ongeldige handtekening.' }
  }
  await prisma.accountant.update({ where: { id: acc.id }, data: { signaturePng: dataUrl } })
  revalidatePath('/instellingen')
  return { ok: true }
}
