'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAccountant } from '@/lib/auth/session'
import { verifyTotp, decryptTotpSecret } from '@/lib/auth/totp'
import { totpVerifySchema } from '@/lib/validation/schemas'

export interface FormState {
  error?: string
  ok?: boolean
}

export async function enable2faAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const acc = await requireAccountant()
  if (!acc.totpSecret) return { error: 'Geen secret gevonden. Herlaad de pagina.' }
  const parsed = totpVerifySchema.safeParse({ code: formData.get('code') })
  if (!parsed.success) return { error: 'Voer de 6-cijferige code in.' }
  const secret = decryptTotpSecret(acc.totpSecret)
  if (!verifyTotp(secret, parsed.data.code)) return { error: 'Onjuiste code. Probeer opnieuw.' }
  await prisma.accountant.update({ where: { id: acc.id }, data: { totpEnabled: true } })
  revalidatePath('/instellingen')
  return { ok: true }
}

export async function disable2faAction(): Promise<void> {
  const acc = await requireAccountant()
  await prisma.accountant.update({
    where: { id: acc.id },
    data: { totpEnabled: false, totpSecret: null }
  })
  revalidatePath('/instellingen')
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
