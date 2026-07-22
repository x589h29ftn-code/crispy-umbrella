'use client'

import { useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteClientAction } from './actions'

export function DeleteClientButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      className="btn-ghost text-slate-400 hover:text-rose-600"
      disabled={pending}
      onClick={() => {
        if (confirm(`Cliënt "${name}" verwijderen uit de lijst?`)) start(() => deleteClientAction(id))
      }}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )
}
