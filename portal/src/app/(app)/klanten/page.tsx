import Link from 'next/link'
import { Plus, Upload, Search, Users } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { DeleteClientButton } from './DeleteClientButton'

export default async function KlantenPage({ searchParams }: { searchParams: { q?: string } }) {
  await requireOnboarded()
  const q = (searchParams.q ?? '').trim()
  const clients = await prisma.client.findMany({
    where: {
      active: true,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { companyName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {})
    },
    orderBy: { displayName: 'asc' },
    take: 200
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cliënten</h1>
          <p className="text-slate-500">Beheer uw cliëntgegevens voor het automatisch invullen van ontvangers.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/klanten/importeren" className="btn-secondary">
            <Upload className="h-4 w-4" /> Importeren
          </Link>
          <Link href="/klanten/nieuw" className="btn-primary">
            <Plus className="h-4 w-4" /> Nieuwe cliënt
          </Link>
        </div>
      </header>

      <form className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input name="q" defaultValue={q} placeholder="Zoeken op naam of e-mail…" className="input pl-9" />
      </form>

      <div className="card overflow-hidden">
        {clients.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-500">
            <Users className="h-8 w-8 text-slate-300" />
            <p>Nog geen cliënten. Voeg er een toe of importeer uit Excel.</p>
          </div>
        ) : (
          <>
          <table className="hidden w-full text-sm md:table">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Naam</th>
                <th className="px-4 py-3">Contact / e-mail</th>
                <th className="px-4 py-3">Plaats</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/klanten/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.displayName}
                    </Link>
                    {c.companyName && c.companyName !== c.displayName && (
                      <div className="text-xs text-slate-400">{c.companyName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>{c.contactName ?? '-'}</div>
                    <div className="text-xs text-slate-400">{c.email ?? '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.city ?? '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <DeleteClientButton id={c.id} name={c.displayName} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Kaartweergave op kleine schermen (telefoon) */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {clients.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <Link href={`/klanten/${c.id}`} className="font-medium text-brand-700 hover:underline">
                    {c.displayName}
                  </Link>
                  {c.companyName && c.companyName !== c.displayName && (
                    <div className="text-xs text-slate-400">{c.companyName}</div>
                  )}
                  <div className="mt-1 text-sm text-slate-600">{c.contactName ?? '-'}</div>
                  <div className="text-xs text-slate-400">{c.email ?? '-'}</div>
                  {c.city && <div className="text-xs text-slate-400">{c.city}</div>}
                </div>
                <DeleteClientButton id={c.id} name={c.displayName} />
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </div>
  )
}
