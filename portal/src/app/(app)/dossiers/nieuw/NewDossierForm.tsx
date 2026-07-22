'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { UploadCloud } from 'lucide-react'
import { createDossierAction, type FormState } from '../actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Uploaden en voorbereiden…' : 'Volgende: velden plaatsen'}
    </button>
  )
}

export function NewDossierForm() {
  const [state, action] = useFormState(createDossierAction, {} as FormState)
  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="title">
          Titel *
        </label>
        <input id="title" name="title" required className="input" placeholder="Bijv. Opdrachtbevestiging 2026" />
      </div>
      <div>
        <label className="label" htmlFor="file">
          Document (PDF of Word) *
        </label>
        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500 hover:border-brand-300 hover:bg-brand-50/40"
        >
          <UploadCloud className="h-8 w-8 text-slate-400" />
          <span className="text-sm">Klik om een bestand te kiezen (.pdf, .docx, …)</span>
          <input id="file" name="file" type="file" accept=".pdf,.docx,.doc,.odt,.rtf" required className="sr-only" />
        </label>
      </div>
      <div>
        <label className="label" htmlFor="message">
          Begeleidend bericht (optioneel)
        </label>
        <textarea id="message" name="message" rows={3} className="input" placeholder="Tekst in de e-mail aan de ontvanger." />
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <Submit />
    </form>
  )
}
