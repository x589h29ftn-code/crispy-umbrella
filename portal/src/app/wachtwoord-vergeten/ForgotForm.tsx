'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { requestPasswordResetAction, type RequestState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Versturen…' : 'Herstellink versturen'}
    </button>
  )
}

export function ForgotForm() {
  const [state, action] = useFormState(requestPasswordResetAction, {} as RequestState)

  if (state.done) {
    return (
      <div className="space-y-4 text-sm text-slate-600">
        <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">
          Als dit e-mailadres bij ons bekend is, is er een e-mail met een herstellink verstuurd. Controleer uw inbox
          (en de spammap).
        </p>
        <Link href="/login" className="text-brand-700 hover:underline">
          Terug naar inloggen
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-slate-600">
        Vul uw e-mailadres in. U ontvangt een link waarmee u een nieuw wachtwoord kunt instellen.
      </p>
      <div>
        <label className="label" htmlFor="email">
          E-mailadres
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" />
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <Submit />
      <p className="text-center text-sm">
        <Link href="/login" className="text-slate-500 hover:underline">
          Terug naar inloggen
        </Link>
      </p>
    </form>
  )
}
