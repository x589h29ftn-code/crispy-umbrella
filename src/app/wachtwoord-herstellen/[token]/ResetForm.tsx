'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { resetPasswordWithTokenAction, type ResetState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Opslaan…' : 'Wachtwoord opslaan'}
    </button>
  )
}

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useFormState(resetPasswordWithTokenAction, {} as ResetState)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="password">
          Nieuw wachtwoord (min. 10 tekens)
        </label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Herhaal wachtwoord
        </label>
        <input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input" />
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <Submit />
    </form>
  )
}
