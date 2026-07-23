'use client'

import { useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { UploadCloud, Plus, X, Sparkles, Loader2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { createDossierAction, analyzeDocumentAction, type FormState } from '../actions'

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
  docTitle: string
}

export function NewDossierForm() {
  const [state, action] = useFormState(createDossierAction, {} as FormState)
  const [rows, setRows] = useState<Row[]>([{ key: nanoid(), fileName: '', docTitle: '' }])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [analyzing, startAnalyzing] = useTransition()
  const [recognized, setRecognized] = useState<{ label: string; year: number | null; ocr: boolean } | null>(null)

  function addRow() {
    setRows((r) => [...r, { key: nanoid(), fileName: '', docTitle: '' }])
  }
  function removeRow(key: string) {
    setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== key) : r))
  }
  function setRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  }

  function onFilePicked(row: Row, index: number, file: File | undefined) {
    const name = file?.name ?? ''
    setRow(row.key, { fileName: name })
    if (!file) return
    // Automatische herkenning: vul dit documentveld en (voor het eerste
    // document) de verzoektitel en het begeleidend bericht voor.
    const fd = new FormData()
    fd.append('file', file)
    startAnalyzing(async () => {
      const res = await analyzeDocumentAction(fd)
      if (!res.ok || !res.recognized) {
        if (index === 0) setRecognized(null)
        return
      }
      if (index === 0) {
        setRecognized({ label: res.kindLabel, year: res.year, ocr: res.ocrUsed })
        setTitle((t) => t || res.suggestedTitle)
        setMessage((m) => m || res.suggestedBody)
      }
      setRow(row.key, { docTitle: res.suggestedTitle })
    })
  }

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="title">
          Titel van het verzoek *
        </label>
        <input
          id="title"
          name="title"
          required
          className="input"
          placeholder="Bijv. Aangifte 2025 - akkoordverklaringen"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
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
              value={row.docTitle}
              onChange={(e) => setRow(row.key, { docTitle: e.target.value })}
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
                onChange={(e) => onFilePicked(row, i, e.target.files?.[0])}
              />
            </label>
            {i === 0 && analyzing && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Document herkennen…
              </p>
            )}
            {i === 0 && !analyzing && recognized && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-700">
                <Sparkles className="h-3.5 w-3.5" /> Herkend als <strong className="font-semibold">
                  {recognized.label}
                </strong>
                {recognized.year ? ` (${recognized.year})` : ''}. Titel en bericht zijn vast ingevuld.
                {recognized.ocr ? ' Tekst via OCR gelezen.' : ''}
              </p>
            )}
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
        <textarea
          id="message"
          name="message"
          rows={4}
          className="input"
          placeholder="Tekst in de e-mail aan de ontvanger."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-400">
          Invulvelden zoals <span className="font-mono">{'{voornaam_klant}'}</span> worden bij het verzenden per
          ontvanger ingevuld.
        </p>
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
