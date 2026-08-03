'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { loginAction, type FormState } from './actions'

const initial: FormState = {}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Bezig…' : 'Inloggen'}
    </button>
  )
}

export function LoginForm() {
  const [state, action] = useFormState(loginAction, initial)
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          E-mailadres
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Wachtwoord
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <SubmitButton />
      <p className="text-center text-sm">
        <Link href="/wachtwoord-vergeten" className="text-slate-500 hover:underline">
          Wachtwoord vergeten?
        </Link>
      </p>
    </form>
  )
}
