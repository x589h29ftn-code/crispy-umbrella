import Link from 'next/link'
import { ResetForm } from './ResetForm'
import { isValidResetToken } from './actions'

export default async function WachtwoordHerstellenPage({ params }: { params: { token: string } }) {
  const valid = await isValidResetToken(params.token)

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-full.jpg" alt="Otto Visser & Partners" className="mx-auto mb-4 h-20 object-contain" />
          <h1 className="text-xl font-semibold">Nieuw wachtwoord instellen</h1>
        </div>
        <div className="card p-6">
          {valid ? (
            <ResetForm token={params.token} />
          ) : (
            <div className="space-y-4 text-sm text-slate-600">
              <p className="rounded-lg bg-rose-50 p-3 text-rose-700">
                Deze herstellink is ongeldig of verlopen. Vraag een nieuwe aan.
              </p>
              <Link href="/wachtwoord-vergeten" className="text-brand-700 hover:underline">
                Nieuwe herstellink aanvragen
              </Link>
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-slate-500 hover:underline">
            Terug naar inloggen
          </Link>
        </p>
      </div>
    </main>
  )
}
