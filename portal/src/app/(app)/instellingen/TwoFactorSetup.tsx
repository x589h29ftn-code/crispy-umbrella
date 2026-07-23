'use client'

import Image from 'next/image'
import { useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { KeyRound } from 'lucide-react'
import { enable2faAction, disable2faAction, regenerateBackupCodesAction, type FormState } from './actions'

const initial: FormState = {}

function EnableButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Controleren…' : 'Activeren'}
    </button>
  )
}

/// Toont de eenmalige herstelcodes met een duidelijke bewaarwaarschuwing.
function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2 font-medium text-amber-800">
        <KeyRound className="h-4 w-4" /> Herstelcodes
      </div>
      <p className="mb-3 text-sm text-amber-800">
        Bewaar deze codes op een veilige plek. Elke code werkt <strong>één keer</strong> en vervangt de code uit uw app
        als u daar geen toegang toe heeft. Ze worden maar één keer getoond.
      </p>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
        {codes.map((c) => (
          <span key={c} className="rounded bg-white px-2 py-1 text-center text-slate-800 ring-1 ring-amber-200">
            {c}
          </span>
        ))}
      </div>
    </div>
  )
}

function DisableForm({ backupCodesLeft }: { backupCodesLeft: number }) {
  const [state, action] = useFormState(disable2faAction, initial)
  const [regen, startRegen] = useTransition()
  const [newCodes, setNewCodes] = useState<string[] | null>(null)

  return (
    <div className="space-y-4">
      <p className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
        Tweefactorauthenticatie is actief.
      </p>

      {newCodes ? (
        <BackupCodes codes={newCodes} />
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>
            Herstelcodes over: <strong>{backupCodesLeft}</strong>
          </span>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={regen}
            onClick={() =>
              startRegen(async () => {
                const res = await regenerateBackupCodesAction()
                if (res.backupCodes) setNewCodes(res.backupCodes)
              })
            }
          >
            {regen ? 'Bezig…' : 'Nieuwe herstelcodes genereren'}
          </button>
        </div>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="disable-pw">
            Bevestig met uw wachtwoord om uit te schakelen
          </label>
          <input id="disable-pw" name="password" type="password" required className="input max-w-xs" autoComplete="current-password" />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Uitschakelen
        </button>
      </form>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
    </div>
  )
}

export function TwoFactorSetup({
  enabled,
  qrDataUrl,
  secret,
  backupCodesLeft = 0
}: {
  enabled: boolean
  qrDataUrl?: string
  secret?: string
  backupCodesLeft?: number
}) {
  const [state, action] = useFormState(enable2faAction, initial)

  if (enabled) {
    return <DisableForm backupCodesLeft={backupCodesLeft} />
  }

  // Net geactiveerd: toon de herstelcodes eenmalig.
  if (state.ok && state.backupCodes) {
    return (
      <div className="space-y-4">
        <p className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
          Tweefactorauthenticatie is geactiveerd.
        </p>
        <BackupCodes codes={state.backupCodes} />
      </div>
    )
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="mb-3 text-sm text-slate-600">
          Scan de QR-code met een authenticator-app (Microsoft Authenticator, Google Authenticator) en voer daarna de
          6-cijferige code in.
        </p>
        {qrDataUrl && (
          <Image src={qrDataUrl} alt="QR-code voor 2FA" width={200} height={200} unoptimized className="rounded-lg border border-slate-200" />
        )}
        {secret && (
          <p className="mt-2 break-all text-xs text-slate-400">
            Handmatige sleutel: <span className="font-mono">{secret}</span>
          </p>
        )}
      </div>
      <form action={action} className="space-y-3 self-center">
        <div>
          <label className="label" htmlFor="code">
            Code uit de app
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            className="input text-center text-lg tracking-[0.4em]"
            placeholder="000000"
          />
        </div>
        {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
        <EnableButton />
      </form>
    </div>
  )
}
