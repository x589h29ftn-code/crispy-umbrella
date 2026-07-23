'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'
import { X, Loader2, ArrowUp, ArrowDown, Building2, User } from 'lucide-react'
import { loadPdf, renderPage, type LoadedPdf } from '@/lib/pdfjs-client'
import { RecipientPicker, type PickedClient } from '@/components/RecipientPicker'
import { saveFieldsAction } from '@/app/(app)/dossiers/actions'
import { cn } from '@/lib/utils'

const COLORS = ['#1d4ed8', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2']
const RENDER_WIDTH = 760

interface Signer {
  tempId: string
  kind: 'office' | 'client'
  name: string
  email: string
  phone?: string | null
  clientId?: string | null
  accountantId?: string | null
  verificationMethod: 'EMAIL' | 'SMS'
  color: string
}
interface OfficeUser {
  id: string
  name: string
  email: string
}
interface Field {
  fid: string
  target: string
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

export function FieldPlacer({ dossierId, pdfUrl }: { dossierId: string; pdfUrl: string }) {
  const router = useRouter()
  const [numPages, setNumPages] = useState(0)
  const [pageInfo, setPageInfo] = useState<PageInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [signingMode, setSigningMode] = useState<'PARALLEL' | 'SEQUENTIAL'>('SEQUENTIAL')
  const [signers, setSigners] = useState<Signer[]>([])
  const [target, setTarget] = useState<string>('')
  const [fields, setFields] = useState<Field[]>([])
  const [draft, setDraft] = useState<{ page: number; l: number; t: number; w: number; h: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const [officeUsers, setOfficeUsers] = useState<OfficeUser[]>([])
  const [officePick, setOfficePick] = useState('')
  const [addMode, setAddMode] = useState<'office' | 'client'>('office')

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [pdfDoc, setPdfDoc] = useState<LoadedPdf | null>(null)

  useEffect(() => {
    fetch('/api/accountants')
      .then((r) => (r.ok ? r.json() : { accountants: [] }))
      .then((d) => setOfficeUsers(d.accountants ?? []))
      .catch(() => {})
  }, [])

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

  function colorOf(tempId: string) {
    return signers.find((s) => s.tempId === tempId)?.color ?? '#1d4ed8'
  }

  function addOffice() {
    const u = officeUsers.find((o) => o.id === officePick)
    if (!u) return
    if (signers.some((s) => s.accountantId === u.id)) return
    const tempId = nanoid()
    setSigners((p) => [
      ...p,
      { tempId, kind: 'office', name: u.name, email: u.email, accountantId: u.id, verificationMethod: 'EMAIL', color: COLORS[p.length % COLORS.length] }
    ])
    setOfficePick('')
    if (!target) setTarget(tempId)
  }

  function addClient(r: PickedClient) {
    const tempId = nanoid()
    setSigners((p) => [
      ...p,
      {
        tempId,
        kind: 'client',
        name: r.name,
        email: r.email,
        phone: r.phone,
        clientId: r.id,
        verificationMethod: r.verificationMethod ?? 'EMAIL',
        color: COLORS[p.length % COLORS.length]
      }
    ])
    if (!target) setTarget(tempId)
  }

  function removeSigner(tempId: string) {
    setSigners((p) => p.filter((s) => s.tempId !== tempId))
    setFields((p) => p.filter((f) => f.target !== tempId))
    if (target === tempId) setTarget('')
  }

  function move(tempId: string, dir: -1 | 1) {
    setSigners((p) => {
      const i = p.findIndex((s) => s.tempId === tempId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= p.length) return p
      const copy = [...p]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
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
    setDraft({
      page: draft.page,
      l: Math.min(dragStart.current.x, x),
      t: Math.min(dragStart.current.y, y),
      w: Math.abs(x - dragStart.current.x),
      h: Math.abs(y - dragStart.current.y)
    })
  }
  function onUp() {
    if (draft && dragStart.current && draft.w > 0.02 && draft.h > 0.01) {
      setFields((p) => [...p, { fid: nanoid(), target, ...draft }])
    }
    dragStart.current = null
    setDraft(null)
  }

  async function save() {
    const used = signers.filter((s) => fields.some((f) => f.target === s.tempId))
    if (used.length === 0) {
      setError('Voeg minstens één ondertekenaar toe en plaats een tekenveld voor die persoon.')
      return
    }
    const missing = signers.filter((s) => !fields.some((f) => f.target === s.tempId))
    if (missing.length > 0) {
      setError(`Plaats ook een tekenveld voor: ${missing.map((s) => s.name).join(', ')}.`)
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
    // Volgorde = volgorde in de lijst.
    const payload = {
      signingMode,
      signers: signers.map((s) => ({
        kind: s.kind,
        name: s.name,
        email: s.email,
        phone: s.phone ?? null,
        clientId: s.clientId ?? null,
        accountantId: s.accountantId ?? null,
        verificationMethod: s.verificationMethod,
        fields: fields.filter((f) => f.target === s.tempId).map(toPlacement)
      }))
    }
    setSaving(true)
    setError(null)
    const res = await saveFieldsAction(dossierId, payload)
    setSaving(false)
    if (res.ok) router.push(`/dossiers/${dossierId}`)
    else setError(res.error ?? 'Opslaan mislukt.')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="space-y-5">
        {/* Volgorde */}
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Ondertekenvolgorde</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSigningMode('SEQUENTIAL')}
              className={signingMode === 'SEQUENTIAL' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}
            >
              Eén voor één
            </button>
            <button
              type="button"
              onClick={() => setSigningMode('PARALLEL')}
              className={signingMode === 'PARALLEL' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}
            >
              Iedereen tegelijk
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {signingMode === 'SEQUENTIAL'
              ? 'Elke ondertekenaar komt pas aan de beurt als de vorige heeft getekend.'
              : 'Alle ondertekenaars krijgen tegelijk een uitnodiging.'}
          </p>
        </div>

        {/* Ondertekenaars toevoegen */}
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Ondertekenaars</h3>
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => setAddMode('office')} className={addMode === 'office' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}>
              <Building2 className="h-3.5 w-3.5" /> Kantoor
            </button>
            <button type="button" onClick={() => setAddMode('client')} className={addMode === 'client' ? 'btn-primary flex-1 text-xs' : 'btn-secondary flex-1 text-xs'}>
              <User className="h-3.5 w-3.5" /> Cliënt
            </button>
          </div>
          {addMode === 'office' ? (
            <div className="flex gap-2">
              <select className="input" value={officePick} onChange={(e) => setOfficePick(e.target.value)}>
                <option value="">Kies een collega…</option>
                {officeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary text-xs" onClick={addOffice} disabled={!officePick}>
                +
              </button>
            </div>
          ) : (
            <RecipientPicker onAdd={addClient} />
          )}

          {/* Geordende lijst */}
          <ol className="mt-3 space-y-1">
            {signers.map((s, i) => (
              <li
                key={s.tempId}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm',
                  target === s.tempId ? 'border-brand-300 bg-brand-50' : 'border-slate-200'
                )}
              >
                <button type="button" onClick={() => setTarget(s.tempId)} className="flex flex-1 items-center gap-2 text-left">
                  {signingMode === 'SEQUENTIAL' && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">
                      {i + 1}
                    </span>
                  )}
                  <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1">
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-1 text-xs text-slate-400">{s.kind === 'office' ? 'kantoor' : s.email}</span>
                  </span>
                </button>
                {signingMode === 'SEQUENTIAL' && (
                  <span className="flex flex-col">
                    <button type="button" onClick={() => move(s.tempId, -1)} className="text-slate-400 hover:text-slate-700">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => move(s.tempId, 1)} className="text-slate-400 hover:text-slate-700">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
                <button type="button" onClick={() => removeSigner(s.tempId)} className="text-slate-400 hover:text-rose-600">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
          {signers.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Selecteer een ondertekenaar en sleep een rechthoek op de pagina waar die persoon moet tekenen.
            </p>
          )}
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
                .map((f) => (
                  <div
                    key={f.fid}
                    className="group absolute flex items-center justify-center rounded"
                    style={{
                      left: `${f.l * 100}%`,
                      top: `${f.t * 100}%`,
                      width: `${f.w * 100}%`,
                      height: `${f.h * 100}%`,
                      background: `${colorOf(f.target)}22`,
                      border: `1.5px solid ${colorOf(f.target)}`
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFields((p) => p.filter((x) => x.fid !== f.fid))
                    }}
                  >
                    <span className="pointer-events-none select-none text-[10px] font-semibold" style={{ color: colorOf(f.target) }}>
                      {signers.find((s) => s.tempId === f.target)?.name ?? 'Handtekening'}
                    </span>
                  </div>
                ))}
              {draft && draft.page === i && (
                <div
                  className="absolute rounded border-2 border-dashed"
                  style={{
                    left: `${draft.l * 100}%`,
                    top: `${draft.t * 100}%`,
                    width: `${draft.w * 100}%`,
                    height: `${draft.h * 100}%`,
                    borderColor: colorOf(target),
                    background: `${colorOf(target)}18`
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
