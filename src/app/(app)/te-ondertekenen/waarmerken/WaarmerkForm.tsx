'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { ShieldCheck, Smartphone } from 'lucide-react'
import { startWaarmerkAction, type WaarmerkState } from './actions'

export interface WaarmerkDocument {
  documentId: string
  dossierId: string
  dossierTitle: string
  documentTitle: string
}

function Submit({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending || count === 0}>
      {pending ? (
        <>
          <Smartphone className="h-4 w-4 animate-pulse" /> Bevestig in uw app…
        </>
      ) : (
        <>
          <ShieldCheck className="h-4 w-4" />
          {count === 1 ? 'Ondertekenen (1 document)' : `Ondertekenen (${count} documenten)`}
        </>
      )}
    </button>
  )
}

export function WaarmerkForm({ documents, maxBatch }: { documents: WaarmerkDocument[]; maxBatch: number }) {
  const [state, action] = useFormState(startWaarmerkAction, {} as WaarmerkState)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(documents.slice(0, maxBatch).map((d) => d.documentId)))

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < maxBatch) next.add(id)
      return next
    })
  }
  const atLimit = selected.size >= maxBatch

  return (
    <form action={action} className="space-y-4">
      <div className="card divide-y divide-slate-100">
        {documents.map((d) => {
          const checked = selected.has(d.documentId)
          return (
            <label
              key={d.documentId}
              className="flex cursor-pointer items-start gap-3 p-4 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={checked}
                onChange={() => toggle(d.documentId)}
                disabled={!checked && atLimit}
              />
              {checked && <input type="hidden" name="documentId" value={d.documentId} />}
              <span className="min-w-0">
                <span className="block font-medium">{d.documentTitle}</span>
                <span className="block text-sm text-slate-500">{d.dossierTitle}</span>
              </span>
            </label>
          )
        })}
      </div>

      {atLimit && documents.length > maxBatch && (
        <p className="text-sm text-amber-700">
          U kunt maximaal {maxBatch} documenten onder één bevestiging meenemen. De rest doet u daarna in een tweede
          ronde.
        </p>
      )}
      {state.error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Submit count={selected.size} />
        <p className="text-sm text-slate-500">
          U wordt doorgestuurd naar uw certificaatprovider en bevestigt daar één keer met uw pincode.
        </p>
      </div>
    </form>
  )
}
