import Link from 'next/link'
import { Plus, FileText } from 'lucide-react'
import type { DossierStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { StatusBadge } from '@/components/StatusBadge'
import { STATUS_LABEL } from '@/lib/status'
import { formatDateTime } from '@/lib/utils'

const FILTERS: (DossierStatus | 'ALLE')[] = ['ALLE', 'CONCEPT', 'VERZONDEN', 'GEDEELTELIJK', 'ONDERTEKEND']

export default async function DashboardPage({ searchParams }: { searchParams: { status?: string } }) {
  const acc = await requireOnboarded()
  const isBeheerder = acc.role === 'BEHEERDER'
  const statusFilter = FILTERS.includes(searchParams.status as DossierStatus) ? (searchParams.status as DossierStatus) : null

  const where = {
    ...(isBeheerder ? {} : { ownerId: acc.id }),
    ...(statusFilter ? { status: statusFilter } : {})
  }

  const [dossiers, counts] = await Promise.all([
    prisma.dossier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { recipients: true, owner: { select: { name: true } } }
    }),
    prisma.dossier.groupBy({
      by: ['status'],
      where: isBeheerder ? {} : { ownerId: acc.id },
      _count: true
    })
  ])

  const countFor = (s: DossierStatus) => counts.find((c) => c.status === s)?._count ?? 0

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-slate-500">
            {isBeheerder ? 'Alle dossiers van het kantoor.' : 'Uw ondertekendossiers.'}
          </p>
        </div>
        <Link href="/dossiers/nieuw" className="btn-primary">
          <Plus className="h-4 w-4" /> Nieuw dossier
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (f === 'ALLE' && !statusFilter) || f === statusFilter
          const label = f === 'ALLE' ? 'Alle' : STATUS_LABEL[f as DossierStatus]
          const count = f === 'ALLE' ? counts.reduce((a, c) => a + c._count, 0) : countFor(f as DossierStatus)
          return (
            <Link
              key={f}
              href={f === 'ALLE' ? '/dashboard' : `/dashboard?status=${f}`}
              className={active ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
            >
              {label} <span className="ml-1 opacity-70">{count}</span>
            </Link>
          )
        })}
      </div>

      <div className="card overflow-hidden">
        {dossiers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-500">
            <FileText className="h-8 w-8 text-slate-300" />
            <p>Nog geen dossiers. Maak een nieuw ondertekendossier aan.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Titel</th>
                <th className="px-4 py-3">Ondertekenaars</th>
                {isBeheerder && <th className="px-4 py-3">Accountant</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Aangemaakt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dossiers.map((d) => {
                const signed = d.recipients.filter((r) => r.status === 'SIGNED').length
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dossiers/${d.id}`} className="font-medium text-brand-700 hover:underline">
                        {d.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {d.recipients.length > 0 ? `${signed}/${d.recipients.length} ondertekend` : '—'}
                    </td>
                    {isBeheerder && <td className="px-4 py-3 text-slate-600">{d.owner.name}</td>}
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(d.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
