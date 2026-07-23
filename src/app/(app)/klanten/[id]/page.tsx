import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { ClientForm } from '../ClientForm'
import { updateClientAction } from '../actions'

export default async function KlantBewerkenPage({ params }: { params: { id: string } }) {
  await requireOnboarded()
  const client = await prisma.client.findUnique({ where: { id: params.id } })
  if (!client || !client.active) notFound()

  const action = updateClientAction.bind(null, client.id)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Cliënt bewerken</h1>
        <p className="text-slate-500">{client.displayName}</p>
      </header>
      <div className="card p-6">
        <ClientForm
          action={action}
          submitLabel="Wijzigingen opslaan"
          values={{
            displayName: client.displayName,
            companyName: client.companyName ?? '',
            contactName: client.contactName ?? '',
            email: client.email ?? '',
            phone: client.phone ?? '',
            kvk: client.kvk ?? '',
            address: client.address ?? '',
            postalCode: client.postalCode ?? '',
            city: client.city ?? '',
            country: client.country ?? 'Nederland',
            notes: client.notes ?? '',
            verificationMethod: client.verificationMethod
          }}
        />
      </div>
    </div>
  )
}
