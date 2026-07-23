'use server'

import { revalidatePath } from 'next/cache'
import * as XLSX from '@e965/xlsx'
import { prisma } from '@/lib/db'
import { requireAccountant } from '@/lib/auth/session'

export interface ImportState {
  error?: string
  added?: number
  updated?: number
  skipped?: number
  done?: boolean
}

// Zoekt een kolomwaarde op basis van meerdere mogelijke koppen (case-insensitief).
function pick(row: Record<string, unknown>, keys: string[]): string | null {
  const lower: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase().trim()] = v
  for (const k of keys) {
    const v = lower[k.toLowerCase()]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

export async function importClientsAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireAccountant()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Kies een Excel- of CSV-bestand.' }
  if (file.size > 5_000_000) return { error: 'Bestand te groot (max 5 MB).' }

  let rows: Record<string, unknown>[]
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  } catch {
    return { error: 'Kon het bestand niet lezen. Gebruik een .xlsx- of .csv-bestand met kolomkoppen.' }
  }
  if (rows.length === 0) return { error: 'Het bestand bevat geen rijen.' }

  let added = 0
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const company = pick(row, ['Bedrijfsnaam', 'Bedrijf', 'Onderneming'])
    const contact = pick(row, ['Contactpersoon', 'Contact', 'Naam'])
    const email = pick(row, ['E-mail', 'Email', 'E-mailadres', 'Emailadres', 'Mail'])
    const displayName = pick(row, ['Klantnaam', 'Naam', 'Bedrijfsnaam']) ?? company ?? contact ?? email
    if (!displayName) {
      skipped += 1
      continue
    }
    const vm = pick(row, ['Verificatie', 'Verificatiemethode', 'Ondertekenen via'])
    const data = {
      displayName,
      companyName: company,
      contactName: contact,
      firstName: pick(row, ['Voornaam', 'Roepnaam']),
      email,
      phone: pick(row, ['Telefoon', 'Telefoonnummer', 'Tel', 'Mobiel']),
      kvk: pick(row, ['KvK', 'KVK', 'KvK-nummer', 'KvKnummer']),
      address: pick(row, ['Adres', 'Straat']),
      postalCode: pick(row, ['Postcode']),
      city: pick(row, ['Plaats', 'Woonplaats', 'Stad']),
      country: pick(row, ['Land']) ?? 'Nederland',
      verificationMethod: (vm && /sms/i.test(vm) ? 'SMS' : 'EMAIL') as 'SMS' | 'EMAIL'
    }

    // Dedupe op e-mailadres wanneer aanwezig.
    const existing = email
      ? await prisma.client.findFirst({ where: { email, active: true } })
      : null
    if (existing) {
      await prisma.client.update({ where: { id: existing.id }, data })
      updated += 1
    } else {
      await prisma.client.create({ data })
      added += 1
    }
  }

  revalidatePath('/klanten')
  return { added, updated, skipped, done: true }
}
