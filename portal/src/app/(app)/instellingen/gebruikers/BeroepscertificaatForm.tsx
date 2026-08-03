'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { updateBeroepscertificaatAction, type BeroepState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-secondary" disabled={pending}>
      {pending ? 'Opslaan…' : 'Opslaan'}
    </button>
  )
}

export interface BeroepUser {
  id: string
  name: string
  email: string
  professionalTitle: string | null
  nbaNumber: string | null
  signingCredentialId: string | null
  signingCertEnabled: boolean
}

export function BeroepscertificaatForm({ user }: { user: BeroepUser }) {
  const [state, action] = useFormState(updateBeroepscertificaatAction, {} as BeroepState)
  const saved = state.ok && state.id === user.id
  return (
    <form action={action} className="rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="id" value={user.id} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{user.name}</p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
        {user.signingCertEnabled && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Beroepscertificaat actief
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor={`title-${user.id}`}>
            Titel
          </label>
          <select id={`title-${user.id}`} name="professionalTitle" className="input" defaultValue={user.professionalTitle ?? ''}>
            <option value="">Geen</option>
            <option value="AA">AA (Accountant-Administratieconsulent)</option>
            <option value="RA">RA (Registeraccountant)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`nba-${user.id}`}>
            NBA-nummer (optioneel)
          </label>
          <input id={`nba-${user.id}`} name="nbaNumber" className="input" defaultValue={user.nbaNumber ?? ''} />
        </div>
        <div>
          <label className="label" htmlFor={`cred-${user.id}`}>
            Credential-id (provider)
          </label>
          <input
            id={`cred-${user.id}`}
            name="signingCredentialId"
            className="input"
            placeholder="bv. Digidentity credential-id"
            defaultValue={user.signingCredentialId ?? ''}
          />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" name="signingCertEnabled" defaultChecked={user.signingCertEnabled} className="h-4 w-4" />
        Gekwalificeerd ondertekenen met beroepscertificaat inschakelen voor deze accountant
      </label>
      {state.error && state.id === user.id && <p className="mt-2 text-sm text-rose-600">{state.error}</p>}
      {saved && <p className="mt-2 text-sm text-emerald-700">Opgeslagen.</p>}
      <div className="mt-3">
        <Submit />
      </div>
    </form>
  )
}
