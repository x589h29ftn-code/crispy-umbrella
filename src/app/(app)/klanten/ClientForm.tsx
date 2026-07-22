'use client'

import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import type { FormState } from './actions'

type Values = Partial<{
  displayName: string
  companyName: string
  contactName: string
  email: string
  phone: string
  kvk: string
  address: string
  postalCode: string
  city: string
  country: string
  notes: string
}>

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Opslaan…' : label}
    </button>
  )
}

function Field({
  name,
  label,
  defaultValue,
  type = 'text',
  required
}: {
  name: string
  label: string
  defaultValue?: string
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
        {required && ' *'}
      </label>
      <input id={name} name={name} type={type} defaultValue={defaultValue ?? ''} required={required} className="input" />
    </div>
  )
}

export function ClientForm({
  action,
  values,
  submitLabel
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  values?: Values
  submitLabel: string
}) {
  const [state, formAction] = useFormState(action, {})
  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="displayName" label="Weergavenaam" defaultValue={values?.displayName} required />
        <Field name="companyName" label="Bedrijfsnaam" defaultValue={values?.companyName} />
        <Field name="contactName" label="Contactpersoon" defaultValue={values?.contactName} />
        <Field name="email" label="E-mailadres" type="email" defaultValue={values?.email} />
        <Field name="phone" label="Telefoon" defaultValue={values?.phone} />
        <Field name="kvk" label="KvK-nummer" defaultValue={values?.kvk} />
        <Field name="address" label="Adres" defaultValue={values?.address} />
        <Field name="postalCode" label="Postcode" defaultValue={values?.postalCode} />
        <Field name="city" label="Plaats" defaultValue={values?.city} />
        <Field name="country" label="Land" defaultValue={values?.country ?? 'Nederland'} />
      </div>
      <div>
        <label className="label" htmlFor="notes">
          Notities
        </label>
        <textarea id="notes" name="notes" rows={3} defaultValue={values?.notes ?? ''} className="input" />
      </div>
      {state.error && <p className="text-sm text-rose-600">{state.error}</p>}
      <div className="flex items-center gap-3">
        <Save label={submitLabel} />
        <Link href="/klanten" className="btn-ghost">
          Annuleren
        </Link>
      </div>
    </form>
  )
}
