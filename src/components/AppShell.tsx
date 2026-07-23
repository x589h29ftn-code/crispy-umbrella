'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileSignature,
  Users,
  Settings,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  PenLine,
  UserCog,
  Menu,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { logoutAction } from '@/app/(app)/actions'

export function AppShell({
  name,
  role,
  twofaEnabled,
  signatureSet,
  mustChangePassword,
  children
}: {
  name: string
  role: string
  twofaEnabled: boolean
  signatureSet: boolean
  mustChangePassword: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/dossiers/nieuw', label: 'Nieuw dossier', icon: FileSignature },
    { href: '/te-ondertekenen', label: 'Te ondertekenen', icon: PenLine },
    { href: '/klanten', label: 'Cliënten', icon: Users },
    ...(role === 'BEHEERDER' ? [{ href: '/instellingen/gebruikers', label: 'Gebruikers', icon: UserCog }] : []),
    { href: '/instellingen', label: 'Instellingen', icon: Settings }
  ]

  const onboardingItems = [
    !mustChangePassword ? null : 'kies een eigen wachtwoord',
    twofaEnabled ? null : 'stel tweefactorauthenticatie in',
    signatureSet ? null : 'stel uw handtekening in'
  ].filter(Boolean) as string[]

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 space-y-1 px-3 py-2">
      {nav.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== '/dashboard' && item.href !== '/instellingen' && pathname.startsWith(item.href + '/'))
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  const UserBlock = () => (
    <div className="border-t border-slate-200 p-3">
      <div className="mb-2 px-2">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-slate-500">{role === 'BEHEERDER' ? 'Beheerder' : 'Medewerker'}</div>
      </div>
      <form action={logoutAction}>
        <button type="submit" className="btn-ghost w-full justify-start">
          <LogOut className="h-4 w-4" /> Uitloggen
        </button>
      </form>
    </div>
  )

  const Brand = () => (
    <div className="flex items-center gap-2 px-5 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm font-semibold leading-tight">Ondertekenportaal</div>
        <div className="text-xs text-slate-500">Otto Visser &amp; Partners</div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      {/* Desktop-zijbalk */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <Brand />
        <NavList />
        <UserBlock />
      </aside>

      {/* Mobiele drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button aria-label="Menu sluiten" className="btn-ghost" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList onNavigate={() => setMobileOpen(false)} />
            <UserBlock />
          </div>
        </div>
      )}

      <main className="flex-1 bg-slate-50">
        {/* Mobiele topbar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <button aria-label="Menu openen" className="btn-ghost" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">Ondertekenportaal</span>
          <form action={logoutAction}>
            <button type="submit" aria-label="Uitloggen" className="btn-ghost">
              <LogOut className="h-5 w-5" />
            </button>
          </form>
        </div>

        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          {onboardingItems.length > 0 && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Rond het instellen van uw account af.</p>
                <p>
                  Nog te doen: {onboardingItems.join(', ')}.{' '}
                  <Link href="/instellingen" className="font-semibold underline">
                    Ga naar Instellingen
                  </Link>
                  .
                </p>
              </div>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  )
}
