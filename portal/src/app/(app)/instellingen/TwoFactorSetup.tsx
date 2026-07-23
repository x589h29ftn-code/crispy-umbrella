'use client'

import Image from 'next/image'
import { useFormState, useFormStatus } from 'react-dom'
import { enable2faAction, disable2faAction, type FormState } from './actions'

const initial: FormState = {}

function EnableButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Controleren…' : 'Activeren'}
    </button>
  )
}

function DisableForm() {
  const [state, action] = useFormState(disable2faAction, initial)
  return (
    <div className="space-y-3">
      <p className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
        Tweefactorauthenticatie is actief.
      </p>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="disable-pw">
            Bevestig met uw wachtwoord om uit te schakelen
          </label>
          <input id="disable-pw" name="password" type="password" required className="input max-w-xs" autoComplete="current-password" />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Uitschakelen
        </button>
      </form>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
    </div>
  )
}

export function TwoFactorSetup({
  enabled,
  qrDataUrl,
  secret
}: {
  enabled: boolean
  qrDataUrl?: string
  secret?: string
}) {
  const [state, action] = useFormState(enable2faAction, initial)

  if (enabled) {
    return <DisableForm />
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="mb-3 text-sm text-slate-600">
          Scan de QR-code met een authenticator-app (Microsoft Authenticator, Google Authenticator) en voer daarna de
          6-cijferige code in.
        </p>
        {qrDataUrl && (
          <Image src={qrDataUrl} alt="QR-code voor 2FA" width={200} height={200} unoptimized className="rounded-lg border border-slate-200" />
        )}
        {secret && (
          <p className="mt-2 break-all text-xs text-slate-400">
            Handmatige sleutel: <span className="font-mono">{secret}</span>
          </p>
        )}
      </div>
      <form action={action} className="space-y-3 self-center">
        <div>
          <label className="label" htmlFor="code">
            Code uit de app
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            className="input text-center text-lg tracking-[0.4em]"
            placeholder="000000"
          />
        </div>
        {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
        <EnableButton />
      </form>
    </div>
  )
}
