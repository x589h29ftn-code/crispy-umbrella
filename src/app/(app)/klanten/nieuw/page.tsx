import { requireAccountant } from '@/lib/auth/session'
import { ClientForm } from '../ClientForm'
import { createClientAction } from '../actions'

export default async function NieuweKlantPage() {
  await requireAccountant()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Nieuwe cliënt</h1>
        <p className="text-slate-500">Deze gegevens gebruikt u later om ontvangers automatisch in te vullen.</p>
      </header>
      <div className="card p-6">
        <ClientForm action={createClientAction} submitLabel="Cliënt opslaan" />
      </div>
    </div>
  )
}
