'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'
import { X, Loader2 } from 'lucide-react'
import { loadPdf, renderPage, type LoadedPdf } from '@/lib/pdfjs-client'
import { RecipientPicker, type PickedClient } from '@/components/RecipientPicker'
import { saveFieldsAction } from '@/app/(app)/dossiers/actions'
import { cn } from '@/lib/utils'

const COLORS = ['#1d4ed8', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2']
const RENDER_WIDTH = 760

interface Recipient extends PickedClient {
  tempId: string
  color: string
}
interface Field {
  fid: string
  target: string // 'self' of recipient.tempId
  page: number
  l: number
  t: number
  w: number
  h: number
}
interface PageInfo {
  pdfWidth: number
  pdfHeight: number
}

export function FieldPlacer({
  dossierId,
  pdfUrl,
  selfSignatureAvailable
}: {
  dossierId: string
  pdfUrl: string
  selfSignatureAvailable: boolean
}) {
  const router = useRouter()
  const [numPages, setNumPages] = useState(0)
  const [pageInfo, setPageInfo] = useState<PageInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [includeSelf, setIncludeSelf] = useState(false)
  const [target, setTarget] = useState<string>('')
  const [fields, setFields] = useState<Field[]>([])
  const [draft, setDraft] = useState<{ page: number; l: number; t: number; w: number; h: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [pdfDoc, setPdfDoc] = useState<LoadedPdf | null>(null)

  // Stap 1: PDF laden (zet numPages zodat de canvassen in de DOM verschijnen).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(pdfUrl)
        if (!res.ok) throw new Error('Kon document niet laden')
        const pdf = await loadPdf(await res.arrayBuffer())
        if (cancelled) return
        setPdfDoc(pdf)
        setNumPages(pdf.numPages)
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfUrl])

  // Stap 2: renderen zodra de canvassen bestaan.
  useEffect(() => {
    if (!pdfDoc || numPages === 0) return
    let cancelled = false
    ;(async () => {
      const info: PageInfo[] = []
      for (let i = 1; i <= numPages; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await pdfDoc.getPage(i)
        const base = page.getViewport({ scale: 1 })
        const canvas = canvasRefs.current[i - 1]
        // eslint-disable-next-line no-await-in-loop
        if (canvas) await renderPage(page, canvas, RENDER_WIDTH / base.width)
        info[i - 1] = { pdfWidth: base.width, pdfHeight: base.height }
        if (cancelled) return
      }
      if (!cancelled) {
        setPageInfo(info)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfDoc, numPages])

  const activeColor = useCallback(() => {
    if (target === 'self') return '#0f172a'
    return recipients.find((r) => r.tempId === target)?.color ?? '#1d4ed8'
  }, [target, recipients])

  function addRecipient(r: PickedClient) {
    const tempId = nanoid()
    const color = COLORS[recipients.length % COLORS.length]
    setRecipients((prev) => [...prev, { ...r, tempId, color }])
    if (!target) setTarget(tempId)
  }
  function removeRecipient(tempId: string) {
    setRecipients((prev) => prev.filter((r) => r.tempId !== tempId))
    setFields((prev) => prev.filter((f) => f.target !== tempId))
    if (target === tempId) setTarget('')
  }

  function onDown(e: React.PointerEvent, page: number) {
    if (!target) {
      setError('Kies eerst voor wie u een tekenveld plaatst.')
      return
    }
    setError(null)
    const rect = e.currentTarget.getBoundingClientRect()
    dragStart.current = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDraft({ page, l: dragStart.current.x, t: dragStart.current.y, w: 0, h: 0 })
  }
  function onMove(e: React.PointerEvent) {
    if (!dragStart.current || !draft) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const l = Math.min(dragStart.current.x, x)
    const t = Math.min(dragStart.current.y, y)
    setDraft({ page: draft.page, l, t, w: Math.abs(x - dragStart.current.x), h: Math.abs(y - dragStart.current.y) })
  }
  function onUp() {
    if (draft && dragStart.current && draft.w > 0.02 && draft.h > 0.01) {
      setFields((prev) => [...prev, { fid: nanoid(), target, ...draft }])
    }
    dragStart.current = null
    setDraft(null)
  }

  async function save() {
    const usedRecipients = recipients.filter((r) => fields.some((f) => f.target === r.tempId))
    if (usedRecipients.length === 0) {
      setError('Voeg minstens één ontvanger toe en plaats een tekenveld voor die persoon.')
      return
    }
    const toPlacement = (f: Field) => {
      const info = pageInfo[f.page]
      return {
        page: f.page,
        x: f.l * info.pdfWidth,
        y: info.pdfHeight - (f.t + f.h) * info.pdfHeight,
        width: f.w * info.pdfWidth,
        height: f.h * info.pdfHeight
      }
    }
    const payload = {
      selfFields: fields.filter((f) => f.target === 'self').map(toPlacement),
      recipients: usedRecipients.map((r) => ({
        name: r.name,
        email: r.email,
        clientId: r.id ?? null,
        role: 'EXTERN' as const,
        fields: fields.filter((f) => f.target === r.tempId).map(toPlacement)
      }))
    }
    setSaving(true)
    setError(null)
    const res = await saveFieldsAction(dossierId, payload)
    setSaving(false)
    if (res.ok) router.push(`/dossiers/${dossierId}`)
    else setError(res.error ?? 'Opslaan mislukt.')
  }

  const targets = [...(includeSelf ? [{ id: 'self', label: 'Ikzelf', color: '#0f172a' }] : []), ...recipients.map((r) => ({ id: r.tempId, label: r.name || r.email, color: r.color }))]

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* Zijpaneel */}
      <div className="space-y-5">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Ontvangers</h3>
          <RecipientPicker onAdd={addRecipient} />
          <ul className="mt-3 space-y-1">
            {recipients.map((r) => (
              <li key={r.tempId} className="flex items-center justify-between rounded px-2 py-1 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />
                  {r.name} <span className="text-xs text-slate-400">{r.email}</span>
                </span>
                <button type="button" onClick={() => removeRecipient(r.tempId)} className="text-slate-400 hover:text-rose-600">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} />
            Ik onderteken zelf ook
          </label>
          {includeSelf && !selfSignatureAvailable && (
            <p className="mt-1 text-xs text-amber-600">Let op: stel eerst uw eigen handtekening in bij Instellingen.</p>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Veld plaatsen voor</h3>
          {targets.length === 0 ? (
            <p className="text-sm text-slate-400">Voeg eerst een ontvanger toe.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTarget(t.id)}
                  className={cn('badge ring-2', target === t.id ? 'ring-brand-400' : 'ring-transparent')}
                  style={{ background: `${t.color}22`, color: t.color }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Sleep een rechthoek op de pagina waar deze persoon moet tekenen. Klik op een veld om het te verwijderen.
          </p>
        </div>

        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        <button type="button" className="btn-primary w-full" onClick={save} disabled={saving || loading}>
          {saving ? 'Opslaan…' : 'Opslaan en naar overzicht'}
        </button>
      </div>

      {/* Documentweergave */}
      <div className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Document laden…
          </div>
        )}
        {Array.from({ length: numPages }).map((_, i) => (
          <div key={i} className="relative mx-auto w-fit rounded-lg border border-slate-200 bg-white shadow-card">
            <canvas
              ref={(el) => {
                canvasRefs.current[i] = el
              }}
              className="block rounded-lg"
            />
            <div
              className="absolute inset-0 cursor-crosshair touch-none"
              onPointerDown={(e) => onDown(e, i)}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {fields
                .filter((f) => f.page === i)
                .map((f) => {
                  const color = f.target === 'self' ? '#0f172a' : recipients.find((r) => r.tempId === f.target)?.color ?? '#1d4ed8'
                  return (
                    <div
                      key={f.fid}
                      className="group absolute flex items-center justify-center rounded"
                      style={{
                        left: `${f.l * 100}%`,
                        top: `${f.t * 100}%`,
                        width: `${f.w * 100}%`,
                        height: `${f.h * 100}%`,
                        background: `${color}22`,
                        border: `1.5px solid ${color}`
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setFields((prev) => prev.filter((x) => x.fid !== f.fid))
                      }}
                    >
                      <span className="pointer-events-none select-none text-[10px] font-semibold" style={{ color }}>
                        Handtekening
                      </span>
                    </div>
                  )
                })}
              {draft && draft.page === i && (
                <div
                  className="absolute rounded border-2 border-dashed"
                  style={{
                    left: `${draft.l * 100}%`,
                    top: `${draft.t * 100}%`,
                    width: `${draft.w * 100}%`,
                    height: `${draft.h * 100}%`,
                    borderColor: activeColor(),
                    background: `${activeColor()}18`
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
