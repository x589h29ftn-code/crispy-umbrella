'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { requireBeheerder } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'
import { z } from 'zod'

export interface UserFormState {
  error?: string
  createdEmail?: string
  tempPassword?: string
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().max(200),
  role: z.enum(['MEDEWERKER', 'BEHEERDER']).default('MEDEWERKER')
})

/** Beheerder maakt een nieuwe kantoorgebruiker aan met een tijdelijk wachtwoord. */
export async function createUserAction(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireBeheerder()
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    role: formData.get('role')
  })
  if (!parsed.success) return { error: 'Controleer naam, e-mail en rol.' }
  const email = parsed.data.email.toLowerCase()
  const existing = await prisma.accountant.findUnique({ where: { email } })
  if (existing) return { error: 'Er bestaat al een gebruiker met dit e-mailadres.' }

  // Tijdelijk wachtwoord: leesbaar maar willekeurig.
  const tempPassword = randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '') + 'A1'
  await prisma.accountant.create({
    data: {
      name: parsed.data.name,
      email,
      role: parsed.data.role,
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true
    }
  })
  revalidatePath('/instellingen/gebruikers')
  return { createdEmail: email, tempPassword }
}

export async function toggleUserActiveAction(id: string): Promise<void> {
  const me = await requireBeheerder()
  if (id === me.id) return // jezelf niet deactiveren
  const user = await prisma.accountant.findUnique({ where: { id } })
  if (!user) return
  await prisma.accountant.update({ where: { id }, data: { active: !user.active } })
  if (!user.active === false) {
    // gedeactiveerd → sessies intrekken
    await prisma.session.deleteMany({ where: { accountantId: id } })
  }
  revalidatePath('/instellingen/gebruikers')
}

/** Beheerder zet de 2FA van een gebruiker terug (bij verlies van de telefoon).
 * De gebruiker moet bij de volgende login opnieuw 2FA instellen. */
export async function reset2faAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  await requireBeheerder()
  const user = await prisma.accountant.findUnique({ where: { id } })
  if (!user) return { error: 'Gebruiker niet gevonden.' }
  await prisma.accountant.update({
    where: { id },
    data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] }
  })
  await prisma.session.deleteMany({ where: { accountantId: id } })
  revalidatePath('/instellingen/gebruikers')
  return { ok: true }
}

export async function resetPasswordAction(id: string): Promise<{ tempPassword?: string; error?: string }> {
  await requireBeheerder()
  const user = await prisma.accountant.findUnique({ where: { id } })
  if (!user) return { error: 'Gebruiker niet gevonden.' }
  const tempPassword = randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '') + 'A1'
  await prisma.accountant.update({
    where: { id },
    data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true }
  })
  await prisma.session.deleteMany({ where: { accountantId: id } })
  revalidatePath('/instellingen/gebruikers')
  return { tempPassword }
}
