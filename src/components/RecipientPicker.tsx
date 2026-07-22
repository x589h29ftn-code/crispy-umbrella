'use client'

import { useEffect, useRef, useState } from 'react'

export interface PickedClient {
  id?: string
  name: string
  email: string
  phone?: string | null
  verificationMethod?: 'EMAIL' | 'SMS'
}

interface Suggestion {
  id: string
  displayName: string
  companyName: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  verificationMethod: 'EMAIL' | 'SMS'
}

/** Autocomplete op de cliëntendatabase + handmatige invoer van een ontvanger. */
export function RecipientPicker({ onAdd }: { onAdd: (r: PickedClient) => void }) {
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [clientId, setClientId] = useState<string | undefined>()
  const [phone, setPhone] = useState<string | null>(null)
  const [method, setMethod] = useState<'EMAIL' | 'SMS'>('EMAIL')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 2) {
      setSuggestions([])
      return
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await res.json()
          setSuggestions(data.clients ?? [])
          setOpen(true)
        }
      } catch {
        /* stil */
      }
    }, 200)
  }, [q])

  function choose(s: Suggestion) {
    setName(s.contactName || s.displayName)
    setEmail(s.email ?? '')
    setClientId(s.id)
    setPhone(s.phone)
    setMethod(s.verificationMethod)
    setQ(s.displayName)
    setOpen(false)
  }

  function add() {
    if (!name.trim() || !/.+@.+\..+/.test(email)) return
    onAdd({
      id: clientId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone,
      verificationMethod: method
    })
    setQ('')
    setName('')
    setEmail('')
    setClientId(undefined)
    setPhone(null)
    setMethod('EMAIL')
    setSuggestions([])
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="relative">
        <input
          className="input"
          placeholder="Zoek een cliënt…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setClientId(undefined)
          }}
          onFocus={() => suggestions.length && setOpen(true)}
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-pop">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => choose(s)}
                >
                  <span className="font-medium">{s.displayName}</span>
                  <span className="text-xs text-slate-400">
                    {(s.contactName ? s.contactName + ' · ' : '') + (s.email ?? 'geen e-mail')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="input" placeholder="Naam ontvanger" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="E-mailadres" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button type="button" className="btn-secondary w-full text-sm" onClick={add} disabled={!name.trim() || !/.+@.+\..+/.test(email)}>
        + Ontvanger toevoegen
      </button>
    </div>
  )
}
