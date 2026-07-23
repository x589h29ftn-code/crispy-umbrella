'use client'

import { useState, useTransition } from 'react'
import { toggleUserActiveAction, resetPasswordAction, reset2faAction } from './actions'

export function UserRow({
  id,
  name,
  email,
  role,
  active,
  isSelf
}: {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  isSelf: boolean
}) {
  const [pending, start] = useTransition()
  const [temp, setTemp] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="font-medium">{name}</div>
        <div className="text-xs text-slate-400">{email}</div>
      </td>
      <td className="px-4 py-3 text-slate-600">{role === 'BEHEERDER' ? 'Beheerder' : 'Medewerker'}</td>
      <td className="px-4 py-3">
        {active ? (
          <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-200">Actief</span>
        ) : (
          <span className="badge bg-slate-100 text-slate-500 ring-slate-200">Inactief</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {temp && (
          <span className="mr-3 text-xs text-slate-500">
            Nieuw wachtwoord: <span className="font-mono font-semibold">{temp}</span>
          </span>
        )}
        {notice && <span className="mr-3 text-xs text-emerald-600">{notice}</span>}
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await resetPasswordAction(id)
              if (res.tempPassword) setTemp(res.tempPassword)
            })
          }
        >
          Wachtwoord resetten
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await reset2faAction(id)
              if (res.ok) setNotice('2FA gereset. Gebruiker stelt het opnieuw in bij inloggen.')
            })
          }
        >
          2FA resetten
        </button>
        {!isSelf && (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={pending}
            onClick={() => start(() => toggleUserActiveAction(id))}
          >
            {active ? 'Deactiveren' : 'Activeren'}
          </button>
        )}
      </td>
    </tr>
  )
}
