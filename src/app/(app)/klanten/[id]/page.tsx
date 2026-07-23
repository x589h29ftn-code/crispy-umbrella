import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateTime } from '@/lib/utils'
import { ClientForm } from '../ClientForm'
import { updateClientAction } from '../actions'

export default async function KlantBewerkenPage({ params }: { params: { id: string } }) {
  await requireOnboarded()
  const client = await prisma.client.findUnique({ where: { id: params.id } })
  if (!client || !client.active) notFound()

  // Alle dossiers waarin deze cliënt als ondertekenaar voorkomt.
  const dossiers = await prisma.dossier.findMany({
    where: { recipients: { some: { clientId: client.id } } },
    orderBy: { createdAt: 'desc' },
    include: { recipients: true },
    take: 100
  })

  const action = updateClientAction.bind(null, client.id)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{client.displayName}</h1>
        <p className="text-slate-500">
          {client.clientNumber ? `Klantnummer ${client.clientNumber} · ` : ''}Cliëntgegevens en ondertekendossiers.
        </p>
      </header>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Dossiers</h2>
          <p className="text-sm text-slate-500">Aangeboden en getekende stukken van deze cliënt.</p>
        </div>
        {dossiers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-500">
            <FileText className="h-7 w-7 text-slate-300" />
            <p>Nog geen dossiers voor deze cliënt.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {dossiers.map((d) => {
              const signed = d.recipients.filter((r) => r.status === 'SIGNED').length
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <Link href={`/dossiers/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      {d.title}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {d.recipients.length > 0 ? `${signed}/${d.recipients.length} ondertekend` : 'Geen ondertekenaars'} ·{' '}
                      {formatDateTime(d.createdAt)}
                    </div>
                  </div>
                  <StatusBadge status={d.status} />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card p-6">
        <h2 className="mb-4 font-semibold">Gegevens bewerken</h2>
        <ClientForm
          action={action}
          submitLabel="Wijzigingen opslaan"
          values={{
            displayName: client.displayName,
            clientNumber: client.clientNumber ?? '',
            companyName: client.companyName ?? '',
            contactName: client.contactName ?? '',
            firstName: client.firstName ?? '',
            email: client.email ?? '',
            phone: client.phone ?? '',
            kvk: client.kvk ?? '',
            address: client.address ?? '',
            postalCode: client.postalCode ?? '',
            city: client.city ?? '',
            country: client.country ?? 'Nederland',
            notes: client.notes ?? '',
            archiveFolder: client.archiveFolder ?? '',
            verificationMethod: client.verificationMethod
          }}
        />
      </section>
    </div>
  )
}
