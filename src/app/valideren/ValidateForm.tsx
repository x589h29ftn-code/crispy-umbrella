'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { validateAction, type ValidateState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Controleren…' : 'Controleer document'}
    </button>
  )
}

const NL = new Intl.DateTimeFormat('nl-NL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Amsterdam'
})

function fmt(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : `${NL.format(d)} (Nederlandse tijd)`
}

export function ValidateForm() {
  const [state, action] = useFormState(validateAction, {} as ValidateState)

  return (
    <div className="space-y-6">
      <form action={action} className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="file">
            PDF-bestand
          </label>
          <input id="file" name="file" type="file" accept="application/pdf" required className="input" />
          <p className="mt-1 text-xs text-slate-500">
            Het bestand wordt alleen gecontroleerd en niet opgeslagen.
          </p>
        </div>
        {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
        <Submit />
      </form>

      {state.signed === false && (
        <div className="card flex gap-3 p-6">
          <ShieldAlert className="h-6 w-6 shrink-0 text-amber-500" />
          <div>
            <h2 className="font-semibold">Geen digitaal zegel gevonden</h2>
            <p className="mt-1 text-sm text-slate-600">
              In dit document zit geen digitale handtekening. Het kan nog steeds een geldig ondertekend stuk zijn —
              controleer dan het ondertekencertificaat op de laatste pagina — maar de echtheid is hier niet
              automatisch vast te stellen.
            </p>
          </div>
        </div>
      )}

      {state.signed && state.signatures && (
        <div className="space-y-4">
          {state.signatures.map((sig, i) => {
            const good = sig.intact && sig.valid
            return (
              <div key={i} className="card p-6">
                <div className="flex items-start gap-3">
                  {good ? (
                    <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="h-6 w-6 shrink-0 text-rose-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">
                      {good ? 'Zegel geldig — document onveranderd' : 'Zegel niet geldig'}
                    </h2>
                    {sig.error ? (
                      <p className="mt-1 text-sm text-rose-600">{sig.error}</p>
                    ) : (
                      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-slate-500">Verzegeld door</dt>
                          <dd className="break-words font-medium">{sig.signerName ?? '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Tijdstempel</dt>
                          <dd className="font-medium">{fmt(sig.timestamp)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Ongewijzigd sinds ondertekening</dt>
                          <dd className="font-medium">{sig.intact ? 'Ja' : 'Nee'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Dekt het hele document</dt>
                          <dd className="font-medium">{sig.coversWholeDocument ? 'Ja' : 'Nee'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Vertrouwd certificaat</dt>
                          <dd className="font-medium">{sig.trusted ? 'Ja' : 'Niet vastgesteld'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Certificaatnummer</dt>
                          <dd className="break-all font-mono text-xs">{sig.certSerial ?? '-'}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                </div>
                {sig.trustError && (
                  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{sig.trustError}</p>
                )}
                {sig.summary && (
                  <p className="mt-4 break-words rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-600">
                    {sig.summary}
                  </p>
                )}
              </div>
            )
          })}
          {state.signatures.every((s) => s.intact && s.valid) && (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Alle zegels in <strong className="font-medium">{state.fileName}</strong> zijn in orde.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
