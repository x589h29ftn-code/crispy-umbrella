'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { DocumentKind } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireBeheerder } from '@/lib/auth/session'

export interface TemplateState {
  error?: string
  ok?: boolean
}

const KINDS: DocumentKind[] = [
  'JAARREKENING',
  'NOTULEN_AVA',
  'BEVESTIGING_JAARREKENING',
  'AKKOORD_IB',
  'AKKOORD_VPB',
  'OPDRACHTBEVESTIGING'
]

const schema = z.object({
  kind: z.enum(KINDS as [DocumentKind, ...DocumentKind[]]),
  titleTemplate: z.string().trim().min(1, 'Titel is verplicht').max(300),
  bodyTemplate: z.string().trim().min(1, 'Bericht is verplicht').max(4000)
})

export async function saveTemplateAction(_prev: TemplateState, formData: FormData): Promise<TemplateState> {
  const me = await requireBeheerder()
  const parsed = schema.safeParse({
    kind: formData.get('kind'),
    titleTemplate: formData.get('titleTemplate'),
    bodyTemplate: formData.get('bodyTemplate')
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Controleer de invoer.' }
  const { kind, titleTemplate, bodyTemplate } = parsed.data
  await prisma.messageTemplate.upsert({
    where: { kind },
    update: { titleTemplate, bodyTemplate, updatedById: me.id },
    create: { kind, titleTemplate, bodyTemplate, updatedById: me.id }
  })
  revalidatePath('/instellingen/sjablonen')
  return { ok: true }
}

export async function resetTemplateAction(kind: DocumentKind): Promise<{ ok: boolean }> {
  await requireBeheerder()
  await prisma.messageTemplate.deleteMany({ where: { kind } })
  revalidatePath('/instellingen/sjablonen')
  return { ok: true }
}
