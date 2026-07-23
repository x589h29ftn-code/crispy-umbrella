'use client'

import { useRef, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { UploadCloud, Plus, X, Sparkles, Loader2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import type { DocumentKind } from '@prisma/client'
import { createDossierAction, analyzeDocumentAction, combineSuggestionAction, type FormState } from '../actions'

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

interface RowAnalysis {
  kind: DocumentKind
  year: number | null
  kindLabel: string
  suggestedTitle: string
  suggestedBody: string
  ocr: boolean
}

interface Banner {
  labels: string[]
  year: number | null
  combined: boolean
  ocr: boolean
}

export function NewDossierForm() {
  const [state, action] = useFormState(createDossierAction, {} as FormState)
  const [rows, setRows] = useState<Row[]>([{ key: nanoid(), fileName: '', docTitle: '' }])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [analyzing, startAnalyzing] = useTransition()
  const [banner, setBanner] = useState<Banner | null>(null)

  // Herkenningsresultaten per documentrij en of de gebruiker titel/bericht zelf
  // heeft aangepast (dan niet meer automatisch overschrijven).
  const analysisRef = useRef<Record<string, RowAnalysis | undefined>>({})
  const titleTouched = useRef(false)
  const messageTouched = useRef(false)

  function addRow() {
    setRows((r) => [...r, { key: nanoid(), fileName: '', docTitle: '' }])
  }
  function removeRow(key: string) {
    setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== key) : r))
    delete analysisRef.current[key]
    recomputeSuggestion()
  }
  function setRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  }

  function applySuggestion(t: string, b: string) {
    if (!titleTouched.current) setTitle(t)
    if (!messageTouched.current) setMessage(b)
  }

  // Bepaalt de dossiertitel en het bericht op basis van alle herkende documenten.
  function recomputeSuggestion() {
    const recs = Object.values(analysisRef.current).filter((v): v is RowAnalysis => !!v)
    if (recs.length === 0) {
      setBanner(null)
      return
    }
    const year = recs.map((r) => r.year).find((y) => y != null) ?? null
    const ocr = recs.some((r) => r.ocr)
    if (recs.length === 1) {
      applySuggestion(recs[0].suggestedTitle, recs[0].suggestedBody)
      setBanner({ labels: [recs[0].kindLabel], year: recs[0].year, combined: false, ocr })
      return
    }
    setBanner({ labels: recs.map((r) => r.kindLabel), year, combined: true, ocr })
    startAnalyzing(async () => {
      const combined = await combineSuggestionAction(recs.map((r) => ({ kind: r.kind, year: r.year })))
      if (combined) applySuggestion(combined.title, combined.body)
    })
  }

  function onFilePicked(row: Row, file: File | undefined) {
    setRow(row.key, { fileName: file?.name ?? '' })
    if (!file) {
      delete analysisRef.current[row.key]
      recomputeSuggestion()
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    startAnalyzing(async () => {
      const res = await analyzeDocumentAction(fd)
      if (res.ok && res.recognized) {
        analysisRef.current[row.key] = {
          kind: res.kind,
          year: res.year,
          kindLabel: res.kindLabel,
          suggestedTitle: res.suggestedTitle,
          suggestedBody: res.suggestedBody,
          ocr: res.ocrUsed
        }
        setRow(row.key, { docTitle: res.suggestedTitle })
      } else {
        delete analysisRef.current[row.key]
      }
      recomputeSuggestion()
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
          onChange={(e) => {
            titleTouched.current = true
            setTitle(e.target.value)
          }}
        />
      </div>

      <div className="space-y-3">
        <label className="label">Documenten (PDF of Word) *</label>
        <p className="-mt-1 text-xs text-slate-500">
          Meerdere documenten (bijv. jaarrekening, notulen en bevestiging) kunnen samen in één verzoek. De ontvanger
          tekent ze na één keer inloggen achter elkaar.
        </p>
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
                onChange={(e) => onFilePicked(row, e.target.files?.[0])}
              />
            </label>
          </div>
        ))}
        <button type="button" className="btn-secondary text-sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Nog een document toevoegen
        </button>

        {analyzing && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Document herkennen…
          </p>
        )}
        {!analyzing && banner && (
          <p className="flex items-start gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {banner.combined ? (
                <>
                  Herkend: <strong className="font-semibold">{banner.labels.join(', ')}</strong>
                  {banner.year ? ` (${banner.year})` : ''}. Titel en bericht zijn samengevoegd tot één verzoek.
                </>
              ) : (
                <>
                  Herkend als <strong className="font-semibold">{banner.labels[0]}</strong>
                  {banner.year ? ` (${banner.year})` : ''}. Titel en bericht zijn vast ingevuld.
                </>
              )}
              {banner.ocr ? ' Tekst via OCR gelezen.' : ''}
            </span>
          </p>
        )}
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
          onChange={(e) => {
            messageTouched.current = true
            setMessage(e.target.value)
          }}
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
