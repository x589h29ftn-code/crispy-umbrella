import { redirect } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { getPending2fa } from '@/lib/auth/session'
import { TwoFactorForm } from './TwoFactorForm'

export default function TwoFactorPage() {
  if (!getPending2fa()) redirect('/login')
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Tweede stap</h1>
          <p className="text-sm text-slate-500">Voer uw verificatiecode in</p>
        </div>
        <div className="card p-6">
          <TwoFactorForm />
        </div>
      </div>
    </main>
  )
}
