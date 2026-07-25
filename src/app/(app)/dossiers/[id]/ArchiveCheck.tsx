'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveX, AlertTriangle } from 'lucide-react'
import { setArchivedAction } from '../actions'

/**
 * Het archiveervinkje. Dit is de enige trigger waarmee documentbestanden ooit uit
 * het portaal verdwijnen — nooit op de klok, altijd op de vlag.
 */
export function ArchiveCheck({
  dossierId,
  archivedAt,
  archivedBy,
  archivedNote,
  bewaardagen,
  suggestie
}: {
  dossierId: string
  archivedAt: string | null
  archivedBy: string | null
  archivedNote: string | null
  bewaardagen: number
  suggestie: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState(archivedNote ?? suggestie)
  const [err, setErr] = useState<string | null>(null)

  function zet(archived: boolean) {
    setErr(null)
    start(async () => {
      const res = await setArchivedAction(dossierId, { archived, note: archived ? note : undefined })
      if (res.ok) router.refresh()
      else setErr(res.error ?? 'Er ging iets mis.')
    })
  }

  if (archivedAt) {
    const weg = new Date(new Date(archivedAt).getTime() + bewaardagen * 86_400_000)
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-900">
          <Archive className="h-4 w-4" /> Gearchiveerd in SharePoint
        </p>
        <p className="mt-1 text-emerald-800">
          Afgevinkt door {archivedBy ?? 'onbekend'} op{' '}
          {new Date(archivedAt).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          {archivedNote ? ` — ${archivedNote}` : ''}.
        </p>
        <p className="mt-2 text-emerald-800">
          De documentbestanden verdwijnen na{' '}
          {weg.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })} uit het portaal. Het
          bewijsspoor (auditregels, hashes en de tijdstempel) blijft zeven jaar staan.
        </p>
        <button className="btn-ghost mt-3 text-slate-600" disabled={pending} onClick={() => zet(false)}>
          <ArchiveX className="h-4 w-4" /> Vinkje terugdraaien
        </button>
        {err && <p className="mt-2 text-rose-600">{err}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium text-amber-900">
        <AlertTriangle className="h-4 w-4" /> Nog niet gearchiveerd
      </p>
      <p className="mt-1 text-amber-800">
        Dit portaal is geen archief. Download het ondertekende stuk, zet het in de klantmap in SharePoint, en vink het
        daarna hier af. Zolang dit vinkje uit staat, wordt er niets verwijderd.
      </p>
      <label className="label mt-3" htmlFor="archiefmap">
        Waar heb je het gezet? (voor het auditspoor)
      </label>
      <input
        id="archiefmap"
        className="input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="bijv. 12345 - Van Dijk BV/2024"
      />
      <button className="btn-primary mt-3" disabled={pending} onClick={() => zet(true)}>
        <Archive className="h-4 w-4" /> Afvinken als gearchiveerd
      </button>
      {err && <p className="mt-2 text-rose-600">{err}</p>}
    </div>
  )
}
