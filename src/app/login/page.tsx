import { getCurrentAccountant } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  if (await getCurrentAccountant()) redirect('/dashboard')
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-full.jpg" alt="Otto Visser & Partners" className="mx-auto mb-4 h-20 object-contain" />
          <h1 className="text-xl font-semibold">Ondertekenportaal</h1>
        </div>
        <div className="card p-6">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Beveiligd met tweefactorauthenticatie. Alleen voor medewerkers.
        </p>
      </div>
    </main>
  )
}
