import { prisma } from '@/lib/db'
import { requireAccountant } from '@/lib/auth/session'
import { generateTotpSecret, encryptTotpSecret, decryptTotpSecret, totpQrDataUrl } from '@/lib/auth/totp'
import { TwoFactorSetup } from './TwoFactorSetup'
import { SignatureSetup } from './SignatureSetup'
import { ChangePassword } from './ChangePassword'

export default async function InstellingenPage() {
  const acc = await requireAccountant()

  // Genereer eenmalig een TOTP-secret als er nog geen is (blijft stabiel bij
  // herladen totdat 2FA geactiveerd of uitgeschakeld wordt).
  let secretBase32: string | undefined
  if (!acc.totpEnabled) {
    if (!acc.totpSecret) {
      secretBase32 = generateTotpSecret()
      await prisma.accountant.update({
        where: { id: acc.id },
        data: { totpSecret: encryptTotpSecret(secretBase32) }
      })
    } else {
      secretBase32 = decryptTotpSecret(acc.totpSecret)
    }
  }
  const qr = secretBase32 ? await totpQrDataUrl(secretBase32, acc.email) : undefined

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Instellingen</h1>
        <p className="text-slate-500">Beheer uw beveiliging en handtekening.</p>
      </header>

      <section className="card p-6">
        <h2 className="mb-1 text-lg font-semibold">Profiel</h2>
        <p className="text-sm text-slate-500">
          {acc.name} — {acc.email} ({acc.role === 'BEHEERDER' ? 'Beheerder' : 'Medewerker'})
        </p>
      </section>

      <section className="card p-6">
        <h2 className="mb-3 text-lg font-semibold">Wachtwoord</h2>
        {acc.mustChangePassword && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            U logt in met een tijdelijk wachtwoord. Kies hieronder een eigen wachtwoord.
          </p>
        )}
        <ChangePassword />
      </section>

      <section className="card p-6">
        <h2 className="mb-3 text-lg font-semibold">Tweefactorauthenticatie</h2>
        <TwoFactorSetup enabled={acc.totpEnabled} qrDataUrl={qr} secret={secretBase32} />
      </section>

      <section className="card p-6">
        <h2 className="mb-3 text-lg font-semibold">Mijn handtekening</h2>
        <p className="mb-4 text-sm text-slate-500">
          Deze handtekening plaatst u met één klik op documenten die u zelf ondertekent.
        </p>
        <SignatureSetup current={acc.signaturePng} />
      </section>
    </div>
  )
}
