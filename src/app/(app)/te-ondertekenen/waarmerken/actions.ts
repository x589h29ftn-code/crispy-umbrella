'use server'

import { redirect } from 'next/navigation'
import { requireAccountant } from '@/lib/auth/session'
import { initiateQualifiedSigning } from '@/lib/csc/flow'

export interface WaarmerkState {
  error?: string
}

/**
 * Start de bevestiging: bereidt de geselecteerde documenten voor en stuurt de
 * accountant door naar de provider. Eén bevestiging dekt de hele selectie.
 */
export async function startWaarmerkAction(_prev: WaarmerkState, formData: FormData): Promise<WaarmerkState> {
  const me = await requireAccountant()
  const documentIds = formData.getAll('documentId').map(String).filter(Boolean)
  if (documentIds.length === 0) return { error: 'Kies minstens één document.' }

  const result = await initiateQualifiedSigning({ accountantId: me.id, documentIds })
  if (!result.ok) return { error: result.error }
  // Buiten de try/catch: redirect() werkt met een exception.
  redirect(result.authorizeUrl)
}
