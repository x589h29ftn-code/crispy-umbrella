import { ShieldCheck } from 'lucide-react'
import { getCurrentAccountant } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  if (await getCurrentAccountant()) redirect('/dashboard')
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Ondertekenportaal</h1>
          <p className="text-sm text-slate-500">Otto Visser &amp; Partners</p>
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
