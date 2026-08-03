'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { createUserAction, type UserFormState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Aanmaken…' : 'Gebruiker aanmaken'}
    </button>
  )
}

export function CreateUserForm() {
  const [state, action] = useFormState(createUserAction, {} as UserFormState)
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="name">
            Naam
          </label>
          <input id="name" name="name" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="email">
            E-mailadres
          </label>
          <input id="email" name="email" type="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="role">
            Rol
          </label>
          <select id="role" name="role" className="input" defaultValue="MEDEWERKER">
            <option value="MEDEWERKER">Medewerker</option>
            <option value="BEHEERDER">Beheerder</option>
          </select>
        </div>
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      {state.createdEmail && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Gebruiker <strong>{state.createdEmail}</strong> aangemaakt. Tijdelijk wachtwoord:{' '}
          <span className="font-mono font-semibold">{state.tempPassword}</span>
          <br />
          Geef dit veilig door; de gebruiker stelt bij de eerste keer inloggen 2FA in.
        </div>
      )}
      <Submit />
    </form>
  )
}
