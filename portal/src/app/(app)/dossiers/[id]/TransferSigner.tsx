'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserRoundCog } from 'lucide-react'
import { transferSignerAction } from '../actions'

// Vakantie- en ziektedekking voor een kantoorondertekenaar (C.3 uit changeset
// v1.7). Bewust een expliciete handeling in plaats van "iedere medewerker mag
// elk kantoorveld invullen": zo blijft de handtekening aan één persoon hangen en
// staat in het auditspoor wie hem heeft overgedragen.

export function TransferSigner({
  recipientId,
  huidigeNaam,
  collegas
}: {
  recipientId: string
  huidigeNaam: string
  collegas: { id: string; name: string; totpEnabled: boolean }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keuze, setKeuze] = useState('')

  if (collegas.length === 0) return null

  async function overdragen() {
    if (!keuze) return
    setBusy(true)
    setError(null)
    const res = await transferSignerAction(recipientId, keuze)
    setBusy(false)
    if (res.ok) {
      setOpen(false)
      router.refresh()
    } else setError(res.error ?? 'Overdragen mislukt.')
  }

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700"
        onClick={() => setOpen(true)}
      >
        <UserRoundCog className="h-3.5 w-3.5" /> Overdragen
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-600">
        {huidigeNaam} vervangen door een collega. De nieuwe ondertekenaar krijgt bericht en tekent zelf; de
        overdracht komt in het auditspoor.
      </p>
      <select
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        value={keuze}
        onChange={(e) => setKeuze(e.target.value)}
      >
        <option value="">Kies een collega…</option>
        {collegas.map((c) => (
          <option key={c.id} value={c.id} disabled={!c.totpEnabled}>
            {c.name}
            {c.totpEnabled ? '' : ' — geen tweefactorauthenticatie'}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={overdragen} disabled={busy || !keuze}>
          {busy ? 'Bezig…' : 'Overdragen'}
        </button>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setOpen(false)} disabled={busy}>
          Annuleren
        </button>
      </div>
    </div>
  )
}
