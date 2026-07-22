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
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="input text-center text-lg tracking-[0.5em]"
          placeholder="000000"
        />
        <p className="mt-1 text-xs text-slate-500">Uit uw authenticator-app (Microsoft/Google Authenticator).</p>
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <SubmitButton />
    </form>
  )
}
