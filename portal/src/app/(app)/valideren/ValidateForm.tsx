'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { validateAction, type ValidateState } from './actions'
import type { ValidationSignature } from '@/lib/seal/sealer'

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

/**
 * Eén eindoordeel, prominent bovenaan, met drie toestanden.
 *
 * Waarom niet twee losse vinkjes ("ongewijzigd" naast "uitgever"): zonder
 * vertrouwensketen staat alleen vast dat de bytes niet zijn gewijzigd sinds
 * ondertekening en dat de ondertekenaar de sleutel had bij het certificaat dat ín
 * het document zit. Iemand kan een jaarrekening pakken, een bedrag wijzigen en
 * opnieuw ondertekenen met een zelfgemaakt certificaat waarin "Otto Visser &
 * Partners" als naam staat. De integriteitscontrole zegt dan groen. Zou de pagina
 * dan een groen vinkje tonen met daaronder een kleine melding over de uitgever, dan
 * leest een medewerker van een bank het vinkje en stopt. Dat mag hier niet.
 */
function Eindoordeel({ signatures, fileName }: { signatures: ValidationSignature[]; fileName?: string }) {
  const onleesbaar = signatures.some((s) => !!s.error)
  const gebroken = signatures.some((s) => s.intact === false || s.coversWholeDocument === false)
  const allemaalVertrouwd = signatures.every((s) => s.trusted === true)

  if (onleesbaar || gebroken) {
    return (
      <div className="rounded-lg border-2 border-rose-300 bg-rose-50 p-6">
        <h2 className="flex items-center gap-3 text-lg font-semibold text-rose-900">
          <ShieldAlert className="h-7 w-7 shrink-0" />
          Gewijzigd of ongeldig
        </h2>
        <p className="mt-2 text-sm text-rose-900">
          Dit bestand is na het ondertekenen gewijzigd, of het zegel is niet te controleren. Gebruik het niet als
          ondertekend stuk en neem contact op met Otto Visser &amp; Partners.
        </p>
      </div>
    )
  }

  if (allemaalVertrouwd) {
    return (
      <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-6">
        <h2 className="flex items-center gap-3 text-lg font-semibold text-emerald-900">
          <ShieldCheck className="h-7 w-7 shrink-0" />
          Geldig en uitgever bevestigd
        </h2>
        <p className="mt-2 text-sm text-emerald-900">
          {fileName ? <strong className="font-medium">{fileName}</strong> : 'Dit bestand'} is ondertekend door Otto
          Visser &amp; Partners en is sindsdien niet gewijzigd.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-6">
      <h2 className="flex items-center gap-3 text-lg font-semibold text-amber-900">
        <ShieldAlert className="h-7 w-7 shrink-0" />
        Ongewijzigd, maar uitgever niet te verifiëren
      </h2>
      <p className="mt-2 text-sm text-amber-900">
        Het bestand is niet gewijzigd sinds het is ondertekend, maar wij kunnen niet vaststellen door wie. Dit past ook
        bij een document dat door iemand anders opnieuw is ondertekend. <strong>Neem hier geen zekerheid aan.</strong>
      </p>
      <p className="mt-2 text-sm text-amber-900">
        Vergelijk het certificaatnummer hieronder met het nummer dat Otto Visser &amp; Partners op de eigen website
        publiceert, of neem contact op met het kantoor.
      </p>
    </div>
  )
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
          <Eindoordeel signatures={state.signatures} fileName={state.fileName} />

          {state.signatures.map((sig, i) => (
            <div key={i} className="card p-6">
              <h3 className="text-sm font-semibold text-slate-500">
                Zegel {i + 1} van {state.signatures!.length}
                {sig.fieldName ? ` · veld ${sig.fieldName}` : ''}
              </h3>
              {sig.error ? (
                <p className="mt-2 text-sm text-rose-600">{sig.error}</p>
              ) : (
                <>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    {/* Subject én issuer letterlijk. Zonder de issuer kan een lezer
                        niet zien dat een certificaat zelfondertekend is; iedereen
                        kan "Otto Visser & Partners" in het subject zetten. */}
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500">Certificaat op naam van (subject)</dt>
                      <dd className="break-words font-medium">{sig.signerName ?? '-'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500">Uitgegeven door (issuer)</dt>
                      <dd className="break-words font-medium">
                        {sig.issuerName ?? '-'}
                        {sig.selfIssued && (
                          <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-800">
                            zelfondertekend
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Certificaatnummer</dt>
                      <dd className="break-all font-mono text-xs">{sig.certSerial ?? '-'}</dd>
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
                      <dt className="text-slate-500">Uitgever bevestigd</dt>
                      <dd className="font-medium">{sig.trusted ? 'Ja' : 'Nee — zie waarschuwing hierboven'}</dd>
                    </div>
                  </dl>
                  {sig.trustError && (
                    <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{sig.trustError}</p>
                  )}
                  {sig.summary && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm text-slate-500">Technische uitkomst</summary>
                      <p className="mt-2 break-words rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-600">
                        {sig.summary}
                      </p>
                    </details>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
