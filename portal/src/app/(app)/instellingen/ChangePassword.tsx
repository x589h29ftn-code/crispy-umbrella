'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { changePasswordAction, type FormState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Opslaan…' : 'Wachtwoord wijzigen'}
    </button>
  )
}

export function ChangePassword() {
  const [state, action] = useFormState(changePasswordAction, {} as FormState)
  return (
    <form action={action} className="max-w-md space-y-4">
      <div>
        <label className="label" htmlFor="current">
          Huidig wachtwoord
        </label>
        <input id="current" name="current" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="next">
          Nieuw wachtwoord (min. 10 tekens)
        </label>
        <input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} className="input" />
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-600">Wachtwoord bijgewerkt.</p>}
      <Submit />
    </form>
  )
}
