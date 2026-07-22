'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Bell, XCircle } from 'lucide-react'
import { sendDossierAction, remindDossierAction, withdrawDossierAction } from '../actions'

export function DossierActions({ dossierId, status }: { dossierId: string; status: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setMsg(null)
    setErr(null)
    start(async () => {
      const res = await fn()
      if (res.ok) {
        setMsg(okMsg)
        router.refresh()
      } else {
        setErr(res.error ?? 'Er ging iets mis.')
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === 'CONCEPT' && (
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() => run(() => sendDossierAction(dossierId), 'Verstuurd naar de ontvanger(s).')}
          >
            <Send className="h-4 w-4" /> Versturen
          </button>
        )}
        {(status === 'VERZONDEN' || status === 'GEDEELTELIJK') && (
          <>
            <button
              className="btn-secondary"
              disabled={pending}
              onClick={() => run(() => remindDossierAction(dossierId), 'Herinnering verstuurd.')}
            >
              <Bell className="h-4 w-4" /> Herinnering sturen
            </button>
            <button
              className="btn-ghost text-rose-600"
              disabled={pending}
              onClick={() => {
                if (confirm('Dit dossier intrekken? De tekenlinks worden ongeldig.')) {
                  run(() => withdrawDossierAction(dossierId), 'Dossier ingetrokken.')
                }
              }}
            >
              <XCircle className="h-4 w-4" /> Intrekken
            </button>
          </>
        )}
      </div>
      {msg && <p className="text-sm text-emerald-600">{msg}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </div>
  )
}
