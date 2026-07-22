import { requireAccountant } from '@/lib/auth/session'
import { NewDossierForm } from './NewDossierForm'

export default async function NieuwDossierPage() {
  await requireAccountant()
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Nieuw ondertekendossier</h1>
        <p className="text-slate-500">Importeer een document om te laten ondertekenen.</p>
      </header>
      <div className="card p-6">
        <NewDossierForm />
      </div>
    </div>
  )
}
