import { prisma } from '@/lib/db'
import { requireBeheerder } from '@/lib/auth/session'
import { professionalSigningConfigured } from '@/lib/signing-provider'
import { env } from '@/env'
import { CreateUserForm } from './CreateUserForm'
import { UserRow } from './UserRow'
import { UserCard } from './UserCard'
import { BeroepscertificaatForm } from './BeroepscertificaatForm'

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

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Beroepscertificaat</h2>
        <p className="mt-1 text-sm text-slate-500">
          Laat een accountant (AA/RA) op persoonlijke titel gekwalificeerd ondertekenen. Per medewerker in te
          schakelen; alleen de verwijzing (credential-id) wordt bewaard, nooit het geheim zelf.
        </p>
        {professionalSigningConfigured() ? (
          <p className="mt-1 text-sm text-emerald-700">
            Provider actief: <span className="font-medium">{env.PROFESSIONAL_SIGNING_DRIVER}</span>.
          </p>
        ) : (
          <p className="mt-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Er is nog geen ondertekenprovider ingesteld (<code>PROFESSIONAL_SIGNING_DRIVER=none</code>). Je kunt hier
            alvast per accountant het beroepscertificaat klaarzetten; zodra de provider en het certificaat actief zijn,
            wordt er automatisch gekwalificeerd ondertekend.
          </p>
        )}
        <div className="mt-4 space-y-4">
          {users
            .filter((u) => u.active)
            .map((u) => (
              <BeroepscertificaatForm
                key={u.id}
                user={{
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  professionalTitle: u.professionalTitle,
                  nbaNumber: u.nbaNumber,
                  signingCredentialId: u.signingCredentialId,
                  signingCertEnabled: u.signingCertEnabled
                }}
              />
            ))}
        </div>
      </section>
    </div>
  )
}
