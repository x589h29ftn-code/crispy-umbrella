'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck, Mail, PenLine, Loader2, CheckCircle2 } from 'lucide-react'
import { loadPdf, renderPage, type LoadedPdf } from '@/lib/pdfjs-client'
import { DrawSignature } from '@/components/DrawSignature'
import { TypeSignature } from '@/components/TypeSignature'

interface FieldRect {
  documentId: string
  page: number
  x: number
  y: number
  width: number
  height: number
}
interface DocInfo {
  id: string
  title: string
}

type Step = 'intro' | 'otp' | 'sign' | 'done' | 'declined'

const RENDER_WIDTH = 720

export function SignFlow({
  token,
  recipientName,
  dossierTitle,
  documents,
  fields
}: {
  token: string
  recipientName: string
  dossierTitle: string
  documents: DocInfo[]
  fields: FieldRect[]
}) {
  const [step, setStep] = useState<Step>('intro')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [destination, setDestination] = useState<string | null>(null)
  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [signature, setSignature] = useState<string | null>(null)

  async function requestOtp() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sign/${token}/otp`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Er ging iets mis.')
      setDestination(data.destination ?? null)
      setChannel(data.channel === 'sms' ? 'sms' : 'email')
      setStep('otp')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function verifyOtp() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sign/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Onjuiste code.')
      setStep('sign')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!signature) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sign/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl: signature })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Ondertekenen mislukt.')
      setStep('done')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function decline() {
    if (!confirm('Weet u zeker dat u niet wilt ondertekenen?')) return
    setBusy(true)
    await fetch(`/api/sign/${token}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '' })
    })
    setBusy(false)
    setStep('declined')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="card p-6">
        <div className="mb-3 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.jpg" alt="Otto Visser & Partners" className="h-8 w-8 rounded object-contain" />
          <span className="text-sm font-medium text-slate-600">Otto Visser &amp; Partners</span>
        </div>
        <div className="mb-1 flex items-center gap-2 text-sm text-brand-700">
          <ShieldCheck className="h-4 w-4" /> Beveiligd ondertekenen
        </div>
        <h1 className="text-xl font-semibold">{dossierTitle}</h1>
        <p className="text-slate-500">Beste {recipientName}, u bent gevraagd dit document te ondertekenen.</p>
      </div>

      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {step === 'intro' && (
        <div className="card space-y-4 p-6">
          <p className="text-slate-600">
            Om uw identiteit te bevestigen sturen we u een verificatiecode. Daarna kunt u het document bekijken en
            ondertekenen.
          </p>
          <button className="btn-primary" onClick={requestOtp} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Verstuur verificatiecode
          </button>
        </div>
      )}

      {step === 'otp' && (
        <div className="card space-y-4 p-6">
          <p className="text-slate-600">
            We hebben een 6-cijferige code {channel === 'sms' ? 'per sms' : 'per e-mail'} gestuurd naar{' '}
            {destination ?? (channel === 'sms' ? 'uw telefoon' : 'uw e-mailadres')}. Voer die hieronder in.
          </p>
          <label htmlFor="otp-code" className="label">
            Verificatiecode
          </label>
          <input
            id="otp-code"
            name="otp-code"
            className="input max-w-[220px] text-center text-lg tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={verifyOtp} disabled={busy || code.length !== 6}>
              Verifiëren
            </button>
            <button className="btn-ghost text-sm" onClick={requestOtp} disabled={busy}>
              Nieuwe code
            </button>
          </div>
        </div>
      )}

      {step === 'sign' && (
        <div className="space-y-6">
          {documents.map((d) => (
            <div key={d.id} className="space-y-2">
              {documents.length > 1 && <h2 className="text-lg font-semibold">{d.title}</h2>}
              <SignDocument token={token} documentId={d.id} fields={fields.filter((f) => f.documentId === d.id)} />
            </div>
          ))}
          <div id="ondertekenen" className="card space-y-4 p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <PenLine className="h-5 w-5" /> Uw handtekening
            </h2>
            <div className="flex gap-2">
              <button onClick={() => setMode('draw')} className={mode === 'draw' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>
                Tekenen
              </button>
              <button onClick={() => setMode('type')} className={mode === 'type' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>
                Typen
              </button>
            </div>
            {mode === 'draw' ? <DrawSignature onChange={setSignature} /> : <TypeSignature onChange={setSignature} />}
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={submit} disabled={busy || !signature}>
                {busy ? 'Bezig…' : 'Ondertekenen'}
              </button>
              <button className="btn-ghost text-sm text-rose-600" onClick={decline} disabled={busy}>
                Weigeren
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Door te ondertekenen bevestigt u akkoord met de inhoud van dit document. Uw IP-adres en tijdstip worden
              vastgelegd in het auditspoor.
            </p>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="card space-y-3 p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h2 className="text-xl font-semibold">Bedankt, uw handtekening is geplaatst.</h2>
          <p className="text-slate-500">
            Zodra alle partijen hebben getekend, ontvangt u de definitieve, ondertekende versie per e-mail.
          </p>
        </div>
      )}

      {step === 'declined' && (
        <div className="card space-y-3 p-8 text-center">
          <h2 className="text-xl font-semibold">U heeft niet ondertekend</h2>
          <p className="text-slate-500">Uw keuze is doorgegeven aan de afzender.</p>
        </div>
      )}
    </div>
  )
}

/** Toont één document met gemarkeerde tekenvakken voor deze ontvanger. */
function SignDocument({ token, documentId, fields }: { token: string; documentId: string; fields: FieldRect[] }) {
  const [numPages, setNumPages] = useState(0)
  const [pageSizes, setPageSizes] = useState<{ w: number; h: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [pdfDoc, setPdfDoc] = useState<LoadedPdf | null>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/sign/${token}/pdf?documentId=${documentId}`)
        if (!res.ok) throw new Error()
        const pdf = await loadPdf(await res.arrayBuffer())
        if (cancelled) return
        setPdfDoc(pdf)
        setNumPages(pdf.numPages)
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, documentId])

  const render = useCallback(async () => {
    if (!pdfDoc || numPages === 0) return
    const sizes: { w: number; h: number }[] = []
    for (let i = 1; i <= numPages; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await pdfDoc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const canvas = canvasRefs.current[i - 1]
      // eslint-disable-next-line no-await-in-loop
      if (canvas) await renderPage(page, canvas, RENDER_WIDTH / base.width)
      sizes[i - 1] = { w: base.width, h: base.height }
    }
    setPageSizes(sizes)
    setLoading(false)
  }, [pdfDoc, numPages])

  useEffect(() => {
    render()
  }, [render])

  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Document laden…
        </div>
      )}
      {Array.from({ length: numPages }).map((_, i) => {
        const size = pageSizes[i]
        return (
          <div key={i} className="relative mx-auto w-fit rounded-lg border border-slate-200 bg-white shadow-card">
            <canvas
              ref={(el) => {
                canvasRefs.current[i] = el
              }}
              className="block h-auto max-w-full rounded-lg"
            />
            {size &&
              fields
                .filter((f) => f.page === i)
                .map((f, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label="Ga naar ondertekenen"
                    onClick={() => document.getElementById('ondertekenen')?.scrollIntoView({ behavior: 'smooth' })}
                    className="absolute flex animate-pulse items-center justify-center rounded border-2 border-brand-500 bg-brand-500/10 hover:bg-brand-500/20"
                    style={{
                      left: `${(f.x / size.w) * 100}%`,
                      top: `${((size.h - (f.y + f.height)) / size.h) * 100}%`,
                      width: `${(f.width / size.w) * 100}%`,
                      height: `${(f.height / size.h) * 100}%`
                    }}
                  >
                    <span className="text-[10px] font-semibold text-brand-700">Teken hier</span>
                  </button>
                ))}
          </div>
        )
      })}
    </div>
  )
}
