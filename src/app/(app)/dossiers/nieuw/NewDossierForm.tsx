'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { UploadCloud, Plus, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { createDossierAction, type FormState } from '../actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Uploaden en voorbereiden…' : 'Volgende: velden plaatsen'}
    </button>
  )
}

interface Row {
  key: string
  fileName: string
}

export function NewDossierForm() {
  const [state, action] = useFormState(createDossierAction, {} as FormState)
  const [rows, setRows] = useState<Row[]>([{ key: nanoid(), fileName: '' }])

  function addRow() {
    setRows((r) => [...r, { key: nanoid(), fileName: '' }])
  }
  function removeRow(key: string) {
    setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== key) : r))
  }

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="title">
          Titel van het verzoek *
        </label>
        <input id="title" name="title" required className="input" placeholder="Bijv. Aangifte 2025 — akkoordverklaringen" />
      </div>

      <div className="space-y-3">
        <label className="label">Documenten (PDF of Word) *</label>
        {rows.map((row, i) => (
          <div key={row.key} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Document {i + 1}</span>
              {rows.length > 1 && (
                <button
                  type="button"
                  aria-label="Document verwijderen"
                  onClick={() => removeRow(row.key)}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <input
              name="docTitle"
              className="input mb-2"
              placeholder="Titel van dit document (bijv. Akkoordverklaring aangifte IB)"
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500 hover:border-brand-300">
              <UploadCloud className="h-4 w-4 text-slate-400" />
              <span>{row.fileName || 'Kies een bestand (.pdf, .docx, …)'}</span>
              <input
                name="file"
                type="file"
                accept=".pdf,.docx,.doc,.odt,.rtf"
                required
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]?.name ?? ''
                  setRows((r) => r.map((x) => (x.key === row.key ? { ...x, fileName: f } : x)))
                }}
              />
            </label>
          </div>
        ))}
        <button type="button" className="btn-secondary text-sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Nog een document toevoegen
        </button>
      </div>

      {rows.length > 1 && (
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Verzendwijze</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="deliveryMode" value="together" defaultChecked className="mt-1" />
            <span>
              <span className="font-medium">Samen in één verzoek (aanbevolen)</span>
              <br />
              <span className="text-slate-500">
                De ontvanger krijgt één e-mail en tekent alle documenten na één keer inloggen.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="deliveryMode" value="separate" className="mt-1" />
            <span>
              <span className="font-medium">Elk document als apart verzoek</span>
              <br />
              <span className="text-slate-500">
                Er wordt per document een los verzoek aangemaakt (aparte e-mail en status). U bereidt ze daarna
                afzonderlijk voor.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      <div>
        <label className="label" htmlFor="message">
          Begeleidend bericht (optioneel)
        </label>
        <textarea id="message" name="message" rows={3} className="input" placeholder="Tekst in de e-mail aan de ontvanger." />
      </div>
      <div className="max-w-[220px]">
        <label className="label" htmlFor="linkTtlDays">
          Geldigheid uitnodiging (dagen)
        </label>
        <input id="linkTtlDays" name="linkTtlDays" type="number" min={1} max={90} defaultValue={10} className="input" />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="sendCopyToRecipient" defaultChecked className="h-4 w-4" />
        Ontvanger ook een kopie van de getekende documenten mailen
      </label>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <Submit />
    </form>
  )
}
