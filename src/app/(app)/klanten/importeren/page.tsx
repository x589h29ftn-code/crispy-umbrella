import { Download } from 'lucide-react'
import { requireOnboarded } from '@/lib/auth/session'
import { ImportForm } from './ImportForm'

export default async function ImporterenPage() {
  await requireOnboarded()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Cliënten importeren</h1>
        <p className="text-slate-500">Upload een Excel- of CSV-bestand met kolomkoppen.</p>
      </header>
      <div className="card p-6">
        <a href="/voorbeeld-clienten.csv" download className="btn-secondary mb-4 inline-flex text-sm">
          <Download className="h-4 w-4" /> Download voorbeeld-CSV
        </a>
        <ImportForm />
        <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          <p className="mb-1 font-medium text-slate-700">Herkende kolomkoppen</p>
          <p>
            <span className="font-mono text-xs">Klantnaam</span> of <span className="font-mono text-xs">Bedrijfsnaam</span>,{' '}
            <span className="font-mono text-xs">Contactpersoon</span>, <span className="font-mono text-xs">Voornaam</span>,{' '}
            <span className="font-mono text-xs">E-mail</span>,{' '}
            <span className="font-mono text-xs">Telefoon</span>, <span className="font-mono text-xs">KvK</span>,{' '}
            <span className="font-mono text-xs">Adres</span>, <span className="font-mono text-xs">Postcode</span>,{' '}
            <span className="font-mono text-xs">Plaats</span>, <span className="font-mono text-xs">Verificatie</span> (e-mail
            of sms).
          </p>
          <p className="mt-2">
            De eerste rij bevat de kolomkoppen. Zowel <span className="font-mono text-xs">.csv</span> (komma of
            puntkomma) als <span className="font-mono text-xs">.xlsx</span> werkt. Rijen met een e-mailadres dat al
            bestaat, worden bijgewerkt in plaats van dubbel toegevoegd.
          </p>
        </div>
      </div>
    </div>
  )
}
