import { ValidateForm } from './ValidateForm'
import { requireOnboarded } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Document controleren — Otto Visser & Partners',
  description: 'Controleer of een digitaal ondertekend document onveranderd is.'
}

export default async function ValiderenPage() {
  // Achter de login: een PDF-parser hoort geen onbeauthenticeerde ingang te zijn.
  await requireOnboarded()
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Document controleren</h1>
        <p className="mt-1 text-slate-600">
          Upload een ondertekend document om te zien of de handtekening geldig is, wie het heeft ondertekend, wanneer
          dat gebeurde, en of er na ondertekening nog iets is gewijzigd. Handig bij een steekproef op het archief.
        </p>
      </header>
      <ValidateForm />
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-700">Kan een cliënt of bank dit ook zelf?</p>
        <p className="mt-1">
          Ja, en dat is de bedoeling. Een gekwalificeerde handtekening van een aanbieder op de EU-vertrouwenslijst
          wordt door Adobe Acrobat Reader zelf als geldig getoond, met de naam van de ondertekenaar. Daar is deze
          pagina niet voor nodig — vandaar dat hij achter de login staat.
        </p>
      </div>
    </div>
  )
}
