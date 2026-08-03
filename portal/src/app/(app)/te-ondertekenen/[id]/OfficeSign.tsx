'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PenLine, CheckCircle2 } from 'lucide-react'
import { loadPdf, renderPage, type LoadedPdf } from '@/lib/pdfjs-client'
import { DrawSignature } from '@/components/DrawSignature'
import { TypeSignature } from '@/components/TypeSignature'
import { officeSignAction, officeDeclineAction } from '../actions'

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
const RENDER_WIDTH = 720

export function OfficeSign({
  recipientId,
  dossierId,
  documents,
  fields,
  consentText,
  savedSignature
}: {
  recipientId: string
  dossierId: string
  documents: DocInfo[]
  fields: FieldRect[]
  consentText: string
  savedSignature?: string | null
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'saved' | 'draw' | 'type'>(savedSignature ? 'saved' : 'draw')
  const [signature, setSignature] = useState<string | null>(savedSignature ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [code, setCode] = useState('')

  async function submit() {
    if (!signature || code.trim().length !== 6) return
    setBusy(true)
    setError(null)
    const res = await officeSignAction(recipientId, signature, code.trim())
    // De code is eenmalig: na een mislukte poging moet er een verse komen,
    // anders typt iemand vijf keer dezelfde in en is hij geblokkeerd.
    setCode('')
    setBusy(false)
    if (res.ok) {
      setDone(true)
      setTimeout(() => router.push('/te-ondertekenen'), 1500)
    } else setError(res.error ?? 'Ondertekenen mislukt.')
  }

  async function decline() {
    if (!confirm('Weet u zeker dat u niet wilt ondertekenen?')) return
    setBusy(true)
    await officeDeclineAction(recipientId, '')
    setBusy(false)
    router.push('/te-ondertekenen')
  }

  if (done) {
    return (
      <div className="card space-y-3 p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <h2 className="text-xl font-semibold">Ondertekend</h2>
        <p className="text-slate-500">Bedankt. De volgende ondertekenaar (indien van toepassing) krijgt nu een seintje.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {documents.map((d) => (
        <div key={d.id} className="space-y-2">
          {documents.length > 1 && <h2 className="text-lg font-semibold">{d.title}</h2>}
          <DocPreview dossierId={dossierId} documentId={d.id} fields={fields.filter((f) => f.documentId === d.id)} />
        </div>
      ))}

      <div id="ondertekenen" className="card space-y-4 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PenLine className="h-5 w-5" /> Uw handtekening
        </h2>
        <div className="flex flex-wrap gap-2">
          {savedSignature && (
            <button
              onClick={() => {
                setMode('saved')
                setSignature(savedSignature)
              }}
              className={mode === 'saved' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
            >
              Opgeslagen handtekening
            </button>
          )}
          <button
            onClick={() => {
              setMode('draw')
              setSignature(null)
            }}
            className={mode === 'draw' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            Tekenen
          </button>
          <button
            onClick={() => {
              setMode('type')
              setSignature(null)
            }}
            className={mode === 'type' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
          >
            Typen
          </button>
        </div>
        {mode === 'saved' && savedSignature ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={savedSignature} alt="Uw opgeslagen handtekening" className="max-h-24 rounded-lg border border-slate-200 bg-white p-2" />
        ) : mode === 'draw' ? (
          <DrawSignature onChange={setSignature} />
        ) : (
          <TypeSignature onChange={setSignature} />
        )}
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{consentText}</p>
        <div className="space-y-1">
          <label htmlFor="reauth" className="block text-sm font-medium text-slate-700">
            Verificatiecode uit uw authenticatie-app
          </label>
          <input
            id="reauth"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.3em]"
            placeholder="000000"
          />
          <p className="text-xs text-slate-500">
            Een sessie blijft uren geldig. Met een verse code staat vast dat u er op dit moment zelf bij was.
          </p>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <p className="text-xs text-slate-500">Uw handtekening wordt op alle bovenstaande documenten geplaatst.</p>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={submit} disabled={busy || !signature || code.trim().length !== 6}>
            {busy ? 'Bezig…' : 'Ondertekenen'}
          </button>
          <button className="btn-ghost text-sm text-rose-600" onClick={decline} disabled={busy}>
            Weigeren
          </button>
        </div>
      </div>
    </div>
  )
}

/** Rendert één document met de tekenvakken van deze ondertekenaar. */
function DocPreview({ dossierId, documentId, fields }: { dossierId: string; documentId: string; fields: FieldRect[] }) {
  const [numPages, setNumPages] = useState(0)
  const [pageSizes, setPageSizes] = useState<{ w: number; h: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [pdfDoc, setPdfDoc] = useState<LoadedPdf | null>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/dossiers/${dossierId}/pdf?documentId=${documentId}`)
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
  }, [dossierId, documentId])

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
                    className="absolute flex items-center justify-center rounded border-2 border-brand-500 bg-brand-500/10 hover:bg-brand-500/20"
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
