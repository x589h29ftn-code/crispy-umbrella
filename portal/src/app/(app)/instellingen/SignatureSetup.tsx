'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { DrawSignature } from '@/components/DrawSignature'
import { TypeSignature } from '@/components/TypeSignature'
import { saveSignatureAction } from './actions'

export function SignatureSetup({ current }: { current: string | null }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(current)
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function save() {
    if (!dataUrl) return
    startTransition(async () => {
      const res = await saveSignatureAction(dataUrl)
      if (res.ok) {
        setSaved(dataUrl)
        setMsg('Handtekening opgeslagen.')
      } else {
        setMsg(res.error ?? 'Opslaan mislukt.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {saved && (
        <div>
          <p className="label">Huidige handtekening</p>
          <Image
            src={saved}
            alt="Uw handtekening"
            width={220}
            height={80}
            unoptimized
            className="rounded-lg border border-slate-200 bg-white p-2"
          />
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('draw')} className={mode === 'draw' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>
          Tekenen
        </button>
        <button type="button" onClick={() => setMode('type')} className={mode === 'type' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>
          Typen
        </button>
      </div>
      {mode === 'draw' ? <DrawSignature onChange={setDataUrl} /> : <TypeSignature onChange={setDataUrl} />}
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={!dataUrl || pending}>
          {pending ? 'Opslaan…' : 'Handtekening opslaan'}
        </button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>
    </div>
  )
}
