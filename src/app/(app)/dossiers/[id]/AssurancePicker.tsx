'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Check } from 'lucide-react'
import type { AssuranceLevel } from '@prisma/client'
import { setAssuranceLevelAction } from '../actions'

// De afzender kiest per verzoek hoeveel bewijskracht hij wil. Een akkoordbrief bij
// een IB-aangifte en een jaarrekening vragen niet hetzelfde.
//
// Alleen zolang het verzoek nog niet verstuurd is: daarna zou het niveau wijzigen
// betekenen dat de ondertekenaars iets anders hebben gekregen dan waar het
// auditrapport straks over gaat.

export function AssurancePicker({
  dossierId,
  huidig,
  beschikbaar,
  labels,
  uitleg,
  wijzigbaar
}: {
  dossierId: string
  huidig: AssuranceLevel
  beschikbaar: AssuranceLevel[]
  labels: Record<string, string>
  uitleg: Record<string, string>
  wijzigbaar: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<AssuranceLevel | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function kies(niveau: AssuranceLevel) {
    if (niveau === huidig) return
    setBusy(niveau)
    setError(null)
    const res = await setAssuranceLevelAction(dossierId, niveau)
    setBusy(null)
    if (res.ok) router.refresh()
    else setError(res.error ?? 'Wijzigen mislukt.')
  }

  // Na versturen alleen tonen wat er is gekozen, zonder keuzemogelijkheid.
  if (!wijzigbaar) {
    return (
      <div className="flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div>
          <div className="font-medium">{labels[huidig]}</div>
          <p className="text-xs leading-relaxed text-slate-500">{uitleg[huidig]}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {beschikbaar.map((niveau) => {
        const actief = niveau === huidig
        return (
          <button
            key={niveau}
            type="button"
            onClick={() => kies(niveau)}
            disabled={busy !== null}
            className={`flex w-full items-start gap-2 rounded-lg border p-3 text-left transition ${
              actief
                ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200'
                : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'
            }`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                actief ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300'
              }`}
            >
              {actief && <Check className="h-3 w-3" />}
            </span>
            <span>
              <span className="block text-sm font-medium">
                {labels[niveau]}
                {busy === niveau && <span className="ml-2 text-xs text-slate-500">bezig…</span>}
              </span>
              <span className="block text-xs leading-relaxed text-slate-500">{uitleg[niveau]}</span>
            </span>
          </button>
        )
      })}
      {beschikbaar.length === 1 && (
        <p className="text-xs text-slate-500">
          Er is één niveau beschikbaar. Een organisatiezegel of beroepscertificaat moet de beheerder eerst
          instellen.
        </p>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  )
}
