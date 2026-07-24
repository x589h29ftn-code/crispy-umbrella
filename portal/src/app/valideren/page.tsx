import { ValidateForm } from './ValidateForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Document controleren — Otto Visser & Partners',
  description: 'Controleer of een digitaal ondertekend document onveranderd is.'
}

export default function ValiderenPage() {
  return (
    <main className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto max-w-2xl px-4">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Document controleren</h1>
          <p className="mt-1 text-slate-600">
            Upload een document dat u van ons hebt ontvangen. U ziet dan of het digitale zegel geldig is, wie het
            heeft verzegeld, wanneer dat gebeurde, en of er na ondertekening nog iets is gewijzigd.
          </p>
        </header>
        <ValidateForm />
        <p className="mt-8 text-xs text-slate-500">
          U kunt dit ook zelf zien in Adobe Acrobat Reader: open het document en bekijk het handtekeningpaneel.
        </p>
      </div>
    </main>
  )
}
