'use client'

import { useState, useTransition } from 'react'
import { FolderTree, Check } from 'lucide-react'
import { setArchiveFolderAction } from '../actions'

/**
 * Toont en bewerkt de map waarin de getekende stukken worden gearchiveerd.
 * Leeg = de standaard (klantmap + boekjaar), die als placeholder wordt getoond.
 */
export function ArchiveFolderCard({
  dossierId,
  defaultFolder,
  current,
  locked
}: {
  dossierId: string
  defaultFolder: string
  current: string | null
  locked: boolean
}) {
  const [value, setValue] = useState(current ?? '')
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  return (
    <section className="card p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <FolderTree className="h-5 w-5" /> Archiefbestemming
      </h2>
      <p className="mb-3 text-sm text-slate-500">
        Waar de getekende stukken na afronding terechtkomen. Laat u dit leeg, dan gebruikt het portaal automatisch:{' '}
        <span className="font-mono text-xs">{defaultFolder || 'de klantmap'}</span>
      </p>
      <input
        className="input"
        value={value}
        disabled={locked || pending}
        placeholder={defaultFolder || 'Standaard klantmap'}
        onChange={(e) => {
          setValue(e.target.value)
          setSaved(false)
        }}
      />
      {!locked && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={pending}
            onClick={() => start(async () => { await setArchiveFolderAction(dossierId, value); setSaved(true) })}
          >
            {pending ? 'Opslaan…' : 'Bestemming opslaan'}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-emerald-600">
              <Check className="h-4 w-4" /> Opgeslagen
            </span>
          )}
        </div>
      )}
      {locked && <p className="mt-2 text-xs text-slate-400">Dit dossier is al afgerond; de bestemming kan niet meer worden gewijzigd.</p>}
    </section>
  )
}
