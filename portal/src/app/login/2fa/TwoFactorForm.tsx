'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { verify2faAction, type FormState } from '../actions'

const initial: FormState = {}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Controleren…' : 'Bevestigen'}
    </button>
  )
}

export function TwoFactorForm() {
  const [state, action] = useFormState(verify2faAction, initial)
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="code">
          Verificatiecode
        </label>
        <input
          id="code"
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="none"
          maxLength={16}
          required
          className="input text-center text-lg tracking-[0.3em]"
          placeholder="000000"
        />
        <p className="mt-1 text-xs text-slate-500">
          Uit uw authenticator-app (Microsoft/Google Authenticator). Geen toegang tot uw app? Voer een herstelcode in
          (bijv. <span className="font-mono">abcd-efgh</span>).
        </p>
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <SubmitButton />
    </form>
  )
}
