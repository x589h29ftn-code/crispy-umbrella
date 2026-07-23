import { prisma } from '@/lib/db'
import { requireBeheerder } from '@/lib/auth/session'
import { CreateUserForm } from './CreateUserForm'
import { UserRow } from './UserRow'
import { UserCard } from './UserCard'

export default async function GebruikersPage() {
  const me = await requireBeheerder()
  const users = await prisma.accountant.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Gebruikers</h1>
        <p className="text-slate-500">Beheer de medewerkers van het kantoor die met het portaal werken.</p>
      </header>

      <section className="card p-6">
        <h2 className="mb-3 text-lg font-semibold">Nieuwe gebruiker</h2>
        <CreateUserForm />
      </section>

      <section className="card overflow-hidden">
        <table className="hidden w-full text-sm md:table">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Naam</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <UserRow key={u.id} id={u.id} name={u.name} email={u.email} role={u.role} active={u.active} isSelf={u.id === me.id} />
            ))}
          </tbody>
        </table>

        {/* Kaartweergave op kleine schermen (telefoon) */}
        <ul className="divide-y divide-slate-100 md:hidden">
          {users.map((u) => (
            <UserCard key={u.id} id={u.id} name={u.name} email={u.email} role={u.role} active={u.active} isSelf={u.id === me.id} />
          ))}
        </ul>
      </section>
    </div>
  )
}
