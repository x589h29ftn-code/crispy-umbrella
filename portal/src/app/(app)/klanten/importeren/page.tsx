import { requireAccountant } from '@/lib/auth/session'
import { ImportForm } from './ImportForm'

export default async function ImporterenPage() {
  await requireAccountant()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Cliënten importeren</h1>
        <p className="text-slate-500">Upload een Excel- of CSV-bestand met kolomkoppen.</p>
      </header>
      <div className="card p-6">
        <ImportForm />
        <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          <p className="mb-1 font-medium text-slate-700">Herkende kolomkoppen</p>
          <p>
            <span className="font-mono text-xs">Klantnaam</span> of <span className="font-mono text-xs">Bedrijfsnaam</span>,{' '}
            <span className="font-mono text-xs">Contactpersoon</span>, <span className="font-mono text-xs">E-mail</span>,{' '}
            <span className="font-mono text-xs">Telefoon</span>, <span className="font-mono text-xs">KvK</span>,{' '}
            <span className="font-mono text-xs">Adres</span>, <span className="font-mono text-xs">Postcode</span>,{' '}
            <span className="font-mono text-xs">Plaats</span>. Rijen met een e-mailadres dat al bestaat, worden bijgewerkt.
          </p>
        </div>
      </div>
    </div>
  )
}
