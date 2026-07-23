'use client'

import { useState, useTransition } from 'react'
import { toggleUserActiveAction, resetPasswordAction, reset2faAction } from './actions'

/** Beheeracties voor één gebruiker (gedeeld door de tabelrij en de mobiele kaart). */
export function UserActions({ id, active, isSelf }: { id: string; active: boolean; isSelf: boolean }) {
  const [pending, start] = useTransition()
  const [temp, setTemp] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1">
      {temp && (
        <span className="mr-1 text-xs text-slate-500">
          Nieuw wachtwoord: <span className="font-mono font-semibold">{temp}</span>
        </span>
      )}
      {notice && <span className="mr-1 text-xs text-emerald-600">{notice}</span>}
      <button
        type="button"
        className="btn-ghost text-xs"
        disabled={pending}
        onClick={() => start(async () => { const r = await resetPasswordAction(id); if (r.tempPassword) setTemp(r.tempPassword) })}
      >
        Wachtwoord resetten
      </button>
      <button
        type="button"
        className="btn-ghost text-xs"
        disabled={pending}
        onClick={() => start(async () => { const r = await reset2faAction(id); if (r.ok) setNotice('2FA gereset. Gebruiker stelt het opnieuw in bij inloggen.') })}
      >
        2FA resetten
      </button>
      {!isSelf && (
        <button type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => start(() => toggleUserActiveAction(id))}>
          {active ? 'Deactiveren' : 'Activeren'}
        </button>
      )}
    </div>
  )
}
