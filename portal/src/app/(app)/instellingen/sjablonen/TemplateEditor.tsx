'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { useState, useTransition } from 'react'
import { RotateCcw, Check } from 'lucide-react'
import type { DocumentKind } from '@prisma/client'
import { saveTemplateAction, resetTemplateAction, type TemplateState } from './actions'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary text-sm" disabled={pending}>
      {pending ? 'Opslaan…' : 'Opslaan'}
    </button>
  )
}

export function TemplateEditor({
  kind,
  label,
  title,
  body,
  isCustom
}: {
  kind: DocumentKind
  label: string
  title: string
  body: string
  isCustom: boolean
}) {
  const [state, action] = useFormState(saveTemplateAction, {} as TemplateState)
  const [resetting, startReset] = useTransition()

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{label}</h3>
        {isCustom ? (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Aangepast</span>
        ) : (
          <span className="text-xs text-slate-400">Standaardtekst</span>
        )}
      </div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="kind" value={kind} />
        <div>
          <label className="label text-xs" htmlFor={`title-${kind}`}>
            Titel
          </label>
          <input id={`title-${kind}`} name="titleTemplate" defaultValue={title} className="input" />
        </div>
        <div>
          <label className="label text-xs" htmlFor={`body-${kind}`}>
            Begeleidend bericht
          </label>
          <textarea id={`body-${kind}`} name="bodyTemplate" rows={4} defaultValue={body} className="input" />
        </div>
        <div className="flex items-center gap-3">
          <Save />
          {isCustom && (
            <button
              type="button"
              className="btn-ghost text-sm text-slate-500"
              disabled={resetting}
              onClick={() => startReset(async () => void (await resetTemplateAction(kind)))}
            >
              <RotateCcw className="h-4 w-4" /> Terug naar standaard
            </button>
          )}
          {state.ok && (
            <span className="flex items-center gap-1 text-sm text-emerald-600">
              <Check className="h-4 w-4" /> Opgeslagen
            </span>
          )}
          {state.error && <span className="text-sm text-rose-600">{state.error}</span>}
        </div>
      </form>
    </section>
  )
}
