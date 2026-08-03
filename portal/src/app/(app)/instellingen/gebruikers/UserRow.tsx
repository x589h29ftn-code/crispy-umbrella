import { UserActions } from './UserActions'

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
        <UserActions id={id} active={active} isSelf={isSelf} />
      </td>
    </tr>
  )
}
