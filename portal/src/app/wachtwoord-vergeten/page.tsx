import { ForgotForm } from './ForgotForm'

export default function WachtwoordVergetenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-full.jpg" alt="Otto Visser & Partners" className="mx-auto mb-4 h-20 object-contain" />
          <h1 className="text-xl font-semibold">Wachtwoord vergeten</h1>
        </div>
        <div className="card p-6">
          <ForgotForm />
        </div>
      </div>
    </main>
  )
}
