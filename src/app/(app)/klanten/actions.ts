'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireAccountant } from '@/lib/auth/session'
import { clientSchema } from '@/lib/validation/schemas'

export interface FormState {
  error?: string
}

function readClient(formData: FormData) {
  return clientSchema.safeParse({
    displayName: formData.get('displayName'),
    companyName: formData.get('companyName'),
    contactName: formData.get('contactName'),
    firstName: formData.get('firstName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    kvk: formData.get('kvk'),
    address: formData.get('address'),
    postalCode: formData.get('postalCode'),
    city: formData.get('city'),
    country: formData.get('country'),
    notes: formData.get('notes'),
    verificationMethod: formData.get('verificationMethod') ?? 'EMAIL'
  })
}

function clean(v: string | undefined | null): string | null {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

export async function createClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAccountant()
  const parsed = readClient(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Controleer de invoer.' }
  const d = parsed.data
  await prisma.client.create({
    data: {
      displayName: d.displayName,
      companyName: clean(d.companyName),
      contactName: clean(d.contactName),
      firstName: clean(d.firstName),
      email: clean(d.email),
      phone: clean(d.phone),
      kvk: clean(d.kvk),
      address: clean(d.address),
      postalCode: clean(d.postalCode),
      city: clean(d.city),
      country: clean(d.country) ?? 'Nederland',
      notes: clean(d.notes),
      verificationMethod: d.verificationMethod
    }
  })
  revalidatePath('/klanten')
  redirect('/klanten')
}

export async function updateClientAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAccountant()
  const parsed = readClient(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Controleer de invoer.' }
  const d = parsed.data
  await prisma.client.update({
    where: { id },
    data: {
      displayName: d.displayName,
      companyName: clean(d.companyName),
      contactName: clean(d.contactName),
      firstName: clean(d.firstName),
      email: clean(d.email),
      phone: clean(d.phone),
      kvk: clean(d.kvk),
      address: clean(d.address),
      postalCode: clean(d.postalCode),
      city: clean(d.city),
      country: clean(d.country) ?? 'Nederland',
      notes: clean(d.notes),
      verificationMethod: d.verificationMethod
    }
  })
  revalidatePath('/klanten')
  redirect('/klanten')
}

export async function deleteClientAction(id: string): Promise<void> {
  await requireAccountant()
  // Soft-delete: cliënt blijft gekoppeld aan bestaande dossiers.
  await prisma.client.update({ where: { id }, data: { active: false } })
  revalidatePath('/klanten')
}
