import { requireAccountant } from '@/lib/auth/session'
import { AppShell } from '@/components/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const acc = await requireAccountant()
  return (
    <AppShell
      name={acc.name}
      role={acc.role}
      twofaEnabled={acc.totpEnabled}
      signatureSet={!!acc.signaturePng}
      mustChangePassword={acc.mustChangePassword}
    >
      {children}
    </AppShell>
  )
}
