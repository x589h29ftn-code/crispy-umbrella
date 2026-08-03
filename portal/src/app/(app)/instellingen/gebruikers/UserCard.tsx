import { UserActions } from './UserActions'

/** Kaartweergave van een gebruiker op kleine schermen. */
export function UserCard({
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
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{name}</div>
          <div className="text-xs text-slate-400">{email}</div>
        </div>
        {active ? (
          <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-200">Actief</span>
        ) : (
          <span className="badge bg-slate-100 text-slate-500 ring-slate-200">Inactief</span>
        )}
      </div>
      <div className="mt-1 text-xs text-slate-500">{role === 'BEHEERDER' ? 'Beheerder' : 'Medewerker'}</div>
      <div className="mt-2">
        <UserActions id={id} active={active} isSelf={isSelf} />
      </div>
    </li>
  )
}
