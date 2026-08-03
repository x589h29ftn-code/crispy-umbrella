'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { importClientsAction, type ImportState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Importeren…' : 'Importeren'}
    </button>
  )
}

export function ImportForm() {
  const [state, action] = useFormState(importClientsAction, {})
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="file">
          Excel- of CSV-bestand
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.xls,.csv"
          required
          className="input file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:text-brand-700"
        />
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      {state.done && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          Klaar: {state.added} toegevoegd, {state.updated} bijgewerkt, {state.skipped} overgeslagen.{' '}
          <Link href="/klanten" className="font-semibold underline">
            Naar cliënten
          </Link>
        </p>
      )}
      <Submit />
    </form>
  )
}
