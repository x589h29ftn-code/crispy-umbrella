import { useEffect, useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { buildActiveGroupPdf } from '../lib/exportActions'
import { renderPdfBytesPage, type RenderedPagePreview } from '../lib/pdfRender'
import { loadOfficeValues } from '../lib/templates'
import {
  buildReminderEmail,
  buildRequestEmail,
  certStatus,
  createSelfCert,
  daysSince,
  deleteDossier,
  listDossiers,
  loadDoc,
  logEvent,
  mailDocument,
  makeParty,
  newDossier,
  pixelRectToPlacement,
  recomputeStatus,
  saveDoc,
  saveDossier,
  signPades,
  stampSignatureImage,
  STATUS_LABEL,
  type DossierStatus,
  type SignMethod,
  type SigningDossier,
  type SignParty,
  type SignPlacement
} from '../lib/signing'
import { IconClock, IconClose, IconSend, IconTrash } from './icons'

const PREVIEW_WIDTH = 520

type Role = 'self' | 'other'

interface DraftParty {
  id: string
  name: string
  email: string
  role: Role
  placement?: SignPlacement
}

interface Draft {
  title: string
  fileName: string
  bytes: Uint8Array
  method: SignMethod
  parties: DraftParty[]
  pageCount: number
}

type View =
  | { kind: 'list' }
  | { kind: 'new'; draft: Draft }
  | { kind: 'place'; draft: Draft; activePartyId: string; page: number }
  | { kind: 'detail'; id: string }
  | { kind: 'cert' }

/** Best-effort ondertekenaarsnaam uit de kantoorgegevens. */
function pickSignerName(office: Record<string, string>): string {
  const entries = Object.entries(office)
  const byKey = entries.find(([k]) => /ondertekenaar/i.test(k))?.[1]
  if (byKey?.trim()) return byKey.trim()
  const byName = entries.find(([k]) => /naam/i.test(k))?.[1]
  return byName?.trim() ?? ''
}

const METHOD_OPTIONS: { value: SignMethod; label: string; hint: string }[] = [
  { value: 'both', label: 'Beide', hint: 'Zichtbare handtekening én digitale (PAdES) ondertekening' },
  { value: 'image', label: 'Zichtbare handtekening', hint: 'Handtekening-afbeelding in de PDF' },
  { value: 'pades', label: 'Alleen digitaal (PAdES)', hint: 'Onzichtbare cryptografische ondertekening' }
]

export default function SigningDialog(): JSX.Element {
  const setOpen = useStudioStore((s) => s.setSigningDialogOpen)
  const addToast = useStudioStore((s) => s.addToast)
  const signatureAssets = useStudioStore((s) => s.signatureAssets)
  const activeSignatureId = useStudioStore((s) => s.activeSignatureId)
  const setDrawSignatureOpen = useStudioStore((s) => s.setDrawSignatureOpen)

  const [view, setView] = useState<View>({ kind: 'list' })
  const [dossiers, setDossiers] = useState<SigningDossier[]>([])
  const [signer, setSigner] = useState('')
  const [cert, setCert] = useState<{ exists: boolean; subject?: string; validTo?: number; isSelfSigned?: boolean }>({
    exists: false
  })
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const p12Ref = useRef<HTMLInputElement>(null)
  const importTargetRef = useRef<string | null>(null)

  async function refresh(): Promise<void> {
    setDossiers(await listDossiers())
    setCert(await certStatus())
  }

  useEffect(() => {
    void refresh()
    void loadOfficeValues().then((o) => setSigner(pickSignerName(o)))
  }, [])

  // Onthoud welk dossier open staat, zodat een geïmporteerd getekend document
  // altijd bij het juiste dossier terechtkomt.
  useEffect(() => {
    if (view.kind === 'detail') importTargetRef.current = view.id
  }, [view])

  // ---- Nieuw verzoek: bron kiezen ----

  async function startFromActive(): Promise<void> {
    const active = await buildActiveGroupPdf()
    if (!active) {
      addToast('info', 'Er is geen document geopend — open eerst een PDF of kies een bestand')
      return
    }
    beginDraft(active.bytes, `${active.name}.pdf`, active.name)
  }

  async function startFromFile(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer())
    beginDraft(bytes, file.name, file.name.replace(/\.pdf$/i, ''))
  }

  function beginDraft(bytes: Uint8Array, fileName: string, title: string): void {
    const draft: Draft = {
      title,
      fileName,
      bytes,
      method: 'both',
      parties: [{ id: 'self', name: signer, email: '', role: 'self' }],
      pageCount: 1
    }
    setView({ kind: 'new', draft })
  }

  // ---- Zelf ondertekenen ----

  function signatureImage(): string | null {
    const asset = signatureAssets.find((a) => a.id === activeSignatureId) ?? signatureAssets[0]
    return asset?.dataUrl ?? null
  }

  async function selfSign(dossier: SigningDossier): Promise<void> {
    const self = dossier.parties.find((p) => p.role === 'self')
    if (!self) return
    setBusy(true)
    try {
      let bytes = (await loadDoc(dossier.id, 'signed')) ?? (await loadDoc(dossier.id, 'orig'))
      if (!bytes) {
        addToast('error', 'Het brondocument is niet gevonden')
        return
      }
      if (dossier.method === 'image' || dossier.method === 'both') {
        const img = signatureImage()
        if (!img) {
          addToast('info', 'Teken of laad eerst een handtekening (knop Handtekening)')
          setDrawSignatureOpen(true)
          return
        }
        bytes = await stampSignatureImage(bytes, self.placement!, img)
      }
      if (dossier.method === 'pades' || dossier.method === 'both') {
        if (!cert.exists) {
          addToast('info', 'Maak eerst een certificaat aan bij "Certificaat"')
          setView({ kind: 'cert' })
          return
        }
        const r = await signPades(bytes, {
          name: self.name || signer,
          reason: `Ondertekening ${dossier.title}`,
          location: ''
        })
        if (!r.ok || !r.data) {
          addToast('error', r.error ?? 'Digitaal ondertekenen is mislukt')
          return
        }
        bytes = r.data
      }
      await saveDoc(dossier.id, 'signed', bytes)
      self.status = 'signed'
      self.signedAt = Date.now()
      logEvent(dossier, 'zelf-getekend')
      dossier.status = recomputeStatus(dossier)
      await saveDossier(dossier)
      addToast('success', 'Document is door jou ondertekend', {
        label: 'Openen',
        run: () => void downloadDoc(dossier, 'signed')
      })
      await refresh()
    } catch (error) {
      addToast('error', 'Ondertekenen is mislukt')
      console.error(error)
    } finally {
      setBusy(false)
    }
  }

  async function sendTo(dossier: SigningDossier, party: SignParty): Promise<void> {
    const bytes = (await loadDoc(dossier.id, 'signed')) ?? (await loadDoc(dossier.id, 'orig'))
    if (!bytes) return
    const mail = buildRequestEmail(dossier, party, signer)
    await mailDocument(dossier.fileName, bytes, { to: party.email, subject: mail.subject, body: mail.body })
    dossier.lastSentAt = Date.now()
    logEvent(dossier, 'verzonden', party.name)
    dossier.status = recomputeStatus(dossier)
    await saveDossier(dossier)
    addToast('success', `Outlook geopend voor ${party.name || 'de tweede partij'}`)
    await refresh()
  }

  async function remind(dossier: SigningDossier, party: SignParty): Promise<void> {
    const bytes = (await loadDoc(dossier.id, 'signed')) ?? (await loadDoc(dossier.id, 'orig'))
    if (!bytes) return
    const mail = buildReminderEmail(dossier, party, signer)
    await mailDocument(dossier.fileName, bytes, { to: party.email, subject: mail.subject, body: mail.body })
    dossier.lastReminderAt = Date.now()
    logEvent(dossier, 'herinnering', party.name)
    await saveDossier(dossier)
    addToast('success', `Herinnering voor ${party.name || 'de tweede partij'} klaargezet`)
    await refresh()
  }

  async function importSignedFile(file: File): Promise<void> {
    const id = importTargetRef.current
    if (!id) return
    const dossier = dossiers.find((d) => d.id === id)
    if (!dossier) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    await saveDoc(dossier.id, 'signed', bytes)
    dossier.parties.forEach((p) => {
      if (p.role === 'other' && p.status === 'pending') {
        p.status = 'signed'
        p.signedAt = Date.now()
      }
    })
    logEvent(dossier, 'geimporteerd')
    dossier.status = recomputeStatus(dossier)
    await saveDossier(dossier)
    addToast('success', 'Getekend document geïmporteerd')
    await refresh()
  }

  async function downloadDoc(dossier: SigningDossier, kind: 'orig' | 'signed'): Promise<void> {
    const bytes = await loadDoc(dossier.id, kind)
    if (!bytes) {
      addToast('error', 'Bestand niet gevonden')
      return
    }
    const suffix = kind === 'signed' ? '-getekend' : ''
    await window.api.savePdf(`${dossier.title}${suffix}.pdf`, bytes)
  }

  async function removeDossier(id: string): Promise<void> {
    await deleteDossier(id)
    addToast('info', 'Dossier verwijderd')
    setView({ kind: 'list' })
    await refresh()
  }

  // ---- Certificaat ----

  const [certName, setCertName] = useState('')
  const [certOrg, setCertOrg] = useState('')

  async function makeCert(): Promise<void> {
    if (!certName.trim()) {
      addToast('info', 'Vul een naam in voor het certificaat')
      return
    }
    setBusy(true)
    const r = await createSelfCert(certName.trim(), certOrg.trim() || undefined)
    setBusy(false)
    if (r.ok) {
      addToast('success', 'Zelf-ondertekend certificaat aangemaakt')
      await refresh()
    } else {
      addToast('error', r.error ?? 'Certificaat aanmaken is mislukt')
    }
  }

  async function importP12(file: File): Promise<void> {
    const password = window.prompt('Wachtwoord van het certificaat (.p12/.pfx):') ?? ''
    const bytes = new Uint8Array(await file.arrayBuffer())
    setBusy(true)
    const r = await window.api.signingImportP12(bytes, password)
    setBusy(false)
    if (r.ok) {
      addToast('success', `Certificaat "${r.subject}" geïmporteerd`)
      await refresh()
    } else {
      addToast('error', r.error ?? 'Certificaat importeren is mislukt')
    }
  }

  // ---- Render ----

  const activeDetail = view.kind === 'detail' ? dossiers.find((d) => d.id === view.id) : undefined

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card smart-card templates-card signing-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__head">
          <h2>
            {view.kind === 'list' && 'Ondertekenen — dashboard'}
            {view.kind === 'new' && 'Nieuw ondertekenverzoek'}
            {view.kind === 'place' && 'Tekenvakken plaatsen'}
            {view.kind === 'detail' && (activeDetail?.title ?? 'Dossier')}
            {view.kind === 'cert' && 'Certificaat'}
          </h2>
          <button type="button" className="icon-btn icon-btn--chrome" onClick={() => setOpen(false)} title="Sluiten">
            <IconClose size={16} />
          </button>
        </div>

        <div className="smart-card__body">
          {view.kind === 'list' && (
            <ListView
              dossiers={dossiers}
              cert={cert}
              onNew={() => void startFromActive()}
              onNewFile={() => fileRef.current?.click()}
              onOpen={(id) => setView({ kind: 'detail', id })}
              onCert={() => setView({ kind: 'cert' })}
            />
          )}

          {view.kind === 'new' && (
            <NewView
              draft={view.draft}
              signer={signer}
              onChange={(d) => setView({ kind: 'new', draft: d })}
              onCancel={() => setView({ kind: 'list' })}
              onPlace={(partyId) => setView({ kind: 'place', draft: view.draft, activePartyId: partyId, page: 0 })}
              addToast={addToast}
            />
          )}

          {view.kind === 'place' && (
            <PlaceView
              draft={view.draft}
              activePartyId={view.activePartyId}
              page={view.page}
              onSetActive={(pid) => setView({ ...view, activePartyId: pid })}
              onSetPage={(p) => setView({ ...view, page: p })}
              onPlace={(placement) => {
                const parties = view.draft.parties.map((p) =>
                  p.id === view.activePartyId ? { ...p, placement } : p
                )
                setView({ ...view, draft: { ...view.draft, parties } })
              }}
              onBack={() => setView({ kind: 'new', draft: view.draft })}
              onFinish={async () => {
                const draft = view.draft
                const parties = draft.parties.map((p) =>
                  makeParty({ name: p.name, email: p.email || undefined, role: p.role, placement: p.placement! })
                )
                const dossier = newDossier({ title: draft.title, fileName: draft.fileName, method: draft.method, parties, createdBy: signer })
                await saveDossier(dossier)
                await saveDoc(dossier.id, 'orig', draft.bytes)
                addToast('success', `Dossier "${dossier.title}" aangemaakt`)
                await refresh()
                setView({ kind: 'detail', id: dossier.id })
              }}
              addToast={addToast}
            />
          )}

          {view.kind === 'detail' && activeDetail && (
            <DetailView
              dossier={activeDetail}
              busy={busy}
              onBack={() => setView({ kind: 'list' })}
              onSelfSign={() => void selfSign(activeDetail)}
              onSend={(party) => void sendTo(activeDetail, party)}
              onRemind={(party) => void remind(activeDetail, party)}
              onImport={() => {
                importTargetRef.current = activeDetail.id
                importRef.current?.click()
              }}
              onDownload={(kind) => void downloadDoc(activeDetail, kind)}
              onDelete={() => void removeDossier(activeDetail.id)}
            />
          )}

          {view.kind === 'cert' && (
            <CertView
              cert={cert}
              busy={busy}
              name={certName}
              org={certOrg}
              onName={setCertName}
              onOrg={setCertOrg}
              onCreate={() => void makeCert()}
              onImport={() => p12Ref.current?.click()}
              onBack={() => setView({ kind: 'list' })}
            />
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void startFromFile(f)
          }}
        />
        <input
          ref={importRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importSignedFile(f)
          }}
        />
        <input
          ref={p12Ref}
          type="file"
          accept=".p12,.pfx"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importP12(f)
          }}
        />
      </div>
    </div>
  )
}

// ================= Sub-views =================

function StatusBadge({ status }: { status: DossierStatus }): JSX.Element {
  return <span className={`signing-badge signing-badge--${status}`}>{STATUS_LABEL[status]}</span>
}

function ListView({
  dossiers,
  cert,
  onNew,
  onNewFile,
  onOpen,
  onCert
}: {
  dossiers: SigningDossier[]
  cert: { exists: boolean; subject?: string; isSelfSigned?: boolean }
  onNew: () => void
  onNewFile: () => void
  onOpen: (id: string) => void
  onCert: () => void
}): JSX.Element {
  return (
    <>
      <div className="smart-card__intro">
        Verstuur documenten ter ondertekening, teken zelf en volg hier of de tweede partij al getekend heeft.
      </div>
      <div className="modal-card__actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <button type="button" className="pill-btn pill-btn--primary" onClick={onNew}>
          Nieuw verzoek (huidig document)
        </button>
        <button type="button" className="pill-btn" onClick={onNewFile}>
          Nieuw verzoek (bestand kiezen)…
        </button>
        <button type="button" className="pill-btn" onClick={onCert}>
          Certificaat{cert.exists ? ' ✓' : '…'}
        </button>
      </div>

      {dossiers.length === 0 ? (
        <div className="templates-empty">Nog geen ondertekendossiers. Maak een nieuw verzoek aan.</div>
      ) : (
        <div className="templates-list">
          {dossiers.map((d) => {
            const pending = d.parties.filter((p) => p.role === 'other' && p.status === 'pending')
            const overdue = d.lastSentAt && pending.length > 0 ? daysSince(d.lastSentAt) : null
            return (
              <div key={d.id} className="templates-item signing-item" onClick={() => onOpen(d.id)}>
                <div className="templates-item__main">
                  <div className="templates-item__name">{d.title}</div>
                  <div className="templates-item__meta">
                    <StatusBadge status={d.status} />
                    {d.parties.map((p) => (
                      <span key={p.id} className={`signing-chip signing-chip--${p.status}`}>
                        {p.role === 'self' ? 'Ik' : p.name || 'Partij'}
                        {p.status === 'signed' ? ' ✓' : ''}
                      </span>
                    ))}
                    {overdue !== null && (
                      <span className="signing-overdue">
                        <IconClock size={12} /> {overdue === 0 ? 'vandaag verzonden' : `${overdue} dg. geleden verzonden`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function NewView({
  draft,
  signer,
  onChange,
  onCancel,
  onPlace,
  addToast
}: {
  draft: Draft
  signer: string
  onChange: (d: Draft) => void
  onCancel: () => void
  onPlace: (firstPartyId: string) => void
  addToast: (kind: 'success' | 'error' | 'info', message: string) => void
}): JSX.Element {
  function update(part: Partial<Draft>): void {
    onChange({ ...draft, ...part })
  }
  function updateParty(id: string, part: Partial<DraftParty>): void {
    update({ parties: draft.parties.map((p) => (p.id === id ? { ...p, ...part } : p)) })
  }
  function addOther(): void {
    update({
      parties: [...draft.parties, { id: `other-${draft.parties.length}`, name: '', email: '', role: 'other' }]
    })
  }
  function removeParty(id: string): void {
    update({ parties: draft.parties.filter((p) => p.id !== id) })
  }
  function proceed(): void {
    if (!draft.title.trim()) {
      addToast('info', 'Geef het dossier een titel')
      return
    }
    if (!draft.parties.length) {
      addToast('info', 'Voeg minstens één ondertekenaar toe')
      return
    }
    if (draft.parties.some((p) => p.role === 'other' && !p.name.trim())) {
      addToast('info', 'Geef elke tweede partij een naam')
      return
    }
    onPlace(draft.parties[0].id)
  }

  return (
    <>
      <div className="templates-edit__grid">
        <label className="templates-edit__field">
          <span>Titel van het dossier</span>
          <input value={draft.title} onChange={(e) => update({ title: e.target.value })} />
        </label>
        <label className="templates-edit__field">
          <span>Bestand</span>
          <input value={draft.fileName} readOnly />
        </label>
      </div>

      <div className="signing-method">
        <span className="signing-method__title">Wijze van ondertekenen</span>
        {METHOD_OPTIONS.map((m) => (
          <label key={m.value} className="signing-method__opt" title={m.hint}>
            <input
              type="radio"
              name="signmethod"
              checked={draft.method === m.value}
              onChange={() => update({ method: m.value })}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>

      <div className="signing-parties">
        <div className="signing-parties__title">Ondertekenaars</div>
        {draft.parties.map((p) => (
          <div key={p.id} className="signing-party-row">
            <span className={`signing-chip signing-chip--${p.role === 'self' ? 'self' : 'pending'}`}>
              {p.role === 'self' ? 'Ik' : 'Partij'}
            </span>
            <input
              className="signing-party-row__name"
              placeholder={p.role === 'self' ? signer || 'Mijn naam' : 'Naam tweede partij'}
              value={p.name}
              onChange={(e) => updateParty(p.id, { name: e.target.value })}
            />
            {p.role === 'other' && (
              <input
                className="signing-party-row__email"
                placeholder="e-mailadres"
                value={p.email}
                onChange={(e) => updateParty(p.id, { email: e.target.value })}
              />
            )}
            {p.role === 'other' && (
              <button
                type="button"
                className="icon-btn icon-btn--chrome icon-btn--danger"
                onClick={() => removeParty(p.id)}
                title="Verwijderen"
              >
                <IconClose size={12} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="pill-btn" onClick={addOther}>
          + Tweede partij toevoegen
        </button>
      </div>

      <div className="modal-card__actions">
        <button type="button" className="pill-btn" onClick={onCancel}>
          Annuleren
        </button>
        <button type="button" className="pill-btn pill-btn--primary" onClick={proceed}>
          Volgende: tekenvakken plaatsen →
        </button>
      </div>
    </>
  )
}

function PlaceView({
  draft,
  activePartyId,
  page,
  onSetActive,
  onSetPage,
  onPlace,
  onBack,
  onFinish,
  addToast
}: {
  draft: Draft
  activePartyId: string
  page: number
  onSetActive: (id: string) => void
  onSetPage: (p: number) => void
  onPlace: (placement: SignPlacement) => void
  onBack: () => void
  onFinish: () => void
  addToast: (kind: 'success' | 'error' | 'info', message: string) => void
}): JSX.Element {
  const [preview, setPreview] = useState<RenderedPagePreview | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setPreview(null)
    void renderPdfBytesPage(draft.bytes, page, PREVIEW_WIDTH).then((p) => {
      if (alive) setPreview(p)
    })
    return () => {
      alive = false
    }
  }, [draft.bytes, page])

  const activeParty = draft.parties.find((p) => p.id === activePartyId)
  const pageCount = preview?.pageCount ?? 1

  function onDown(e: React.MouseEvent): void {
    if (!boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    setDrag({ x0: e.clientX - rect.left, y0: e.clientY - rect.top, x1: e.clientX - rect.left, y1: e.clientY - rect.top })
  }
  function onMove(e: React.MouseEvent): void {
    if (!drag || !boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    setDrag({ ...drag, x1: e.clientX - rect.left, y1: e.clientY - rect.top })
  }
  function onUp(): void {
    if (!drag || !preview || !activeParty) {
      setDrag(null)
      return
    }
    const left = Math.min(drag.x0, drag.x1)
    const top = Math.min(drag.y0, drag.y1)
    const width = Math.abs(drag.x1 - drag.x0)
    const height = Math.abs(drag.y1 - drag.y0)
    setDrag(null)
    if (width < 20 || height < 12) return
    onPlace(pixelRectToPlacement({ left, top, width, height }, preview, page))
  }

  const allPlaced = draft.parties.every((p) => p.placement)

  return (
    <div className="signing-place">
      <div className="signing-place__side">
        <div className="signing-place__hint">
          Kies een ondertekenaar en sleep een tekenvak op de pagina waar de handtekening moet komen.
        </div>
        {draft.parties.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`signing-place__party${p.id === activePartyId ? ' signing-place__party--active' : ''}`}
            onClick={() => onSetActive(p.id)}
          >
            <span className={`signing-chip signing-chip--${p.role === 'self' ? 'self' : 'pending'}`}>
              {p.role === 'self' ? 'Ik' : p.name || 'Partij'}
            </span>
            <span className="signing-place__placed">{p.placement ? `pagina ${p.placement.page + 1} ✓` : 'nog niet geplaatst'}</span>
          </button>
        ))}
        {pageCount > 1 && (
          <div className="signing-place__pager">
            <button type="button" className="pill-btn pill-btn--icon" disabled={page === 0} onClick={() => onSetPage(page - 1)}>
              ‹
            </button>
            <span>
              pagina {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="pill-btn pill-btn--icon"
              disabled={page >= pageCount - 1}
              onClick={() => onSetPage(page + 1)}
            >
              ›
            </button>
          </div>
        )}
        <div className="modal-card__actions" style={{ marginTop: 'auto' }}>
          <button type="button" className="pill-btn" onClick={onBack}>
            Terug
          </button>
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            disabled={!allPlaced}
            onClick={() => {
              if (!allPlaced) {
                addToast('info', 'Plaats voor elke ondertekenaar een tekenvak')
                return
              }
              onFinish()
            }}
          >
            Dossier aanmaken
          </button>
        </div>
      </div>
      <div className="signing-place__canvas">
        {preview ? (
          <div
            ref={boxRef}
            className="signing-place__page"
            style={{ width: preview.pxWidth, height: preview.pxHeight }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          >
            <img src={preview.dataUrl} alt="Voorbeeld" draggable={false} style={{ width: '100%', height: '100%' }} />
            {draft.parties.map((p) =>
              p.placement && p.placement.page === page ? (
                <div
                  key={p.id}
                  className="signing-place__mark"
                  style={{
                    left: (p.placement.x / preview.pdfWidth) * preview.pxWidth,
                    top: preview.pxHeight - ((p.placement.y + p.placement.height) / preview.pdfHeight) * preview.pxHeight,
                    width: (p.placement.width / preview.pdfWidth) * preview.pxWidth,
                    height: (p.placement.height / preview.pdfHeight) * preview.pxHeight
                  }}
                >
                  {p.role === 'self' ? 'Ik' : p.name || 'Partij'}
                </div>
              ) : null
            )}
            {drag && (
              <div
                className="signing-place__dragbox"
                style={{
                  left: Math.min(drag.x0, drag.x1),
                  top: Math.min(drag.y0, drag.y1),
                  width: Math.abs(drag.x1 - drag.x0),
                  height: Math.abs(drag.y1 - drag.y0)
                }}
              />
            )}
          </div>
        ) : (
          <div className="signing-place__loading">Voorbeeld laden…</div>
        )}
      </div>
    </div>
  )
}

function DetailView({
  dossier,
  busy,
  onBack,
  onSelfSign,
  onSend,
  onRemind,
  onImport,
  onDownload,
  onDelete
}: {
  dossier: SigningDossier
  busy: boolean
  onBack: () => void
  onSelfSign: () => void
  onSend: (party: SignParty) => void
  onRemind: (party: SignParty) => void
  onImport: () => void
  onDownload: (kind: 'orig' | 'signed') => void
  onDelete: () => void
}): JSX.Element {
  const self = dossier.parties.find((p) => p.role === 'self')
  const others = dossier.parties.filter((p) => p.role === 'other')
  return (
    <>
      <div className="signing-detail__head">
        <StatusBadge status={dossier.status} />
        <span className="signing-detail__file">{dossier.fileName}</span>
      </div>

      <div className="signing-detail__parties">
        {dossier.parties.map((p) => (
          <div key={p.id} className="signing-detail__party">
            <span className={`signing-chip signing-chip--${p.status}`}>
              {p.role === 'self' ? 'Ik' : p.name || 'Tweede partij'}
              {p.status === 'signed' ? ' ✓' : ''}
            </span>
            {p.email && <span className="signing-detail__email">{p.email}</span>}
            <span className="signing-detail__pstatus">{p.status === 'signed' ? 'Ondertekend' : 'Nog niet getekend'}</span>
          </div>
        ))}
      </div>

      <div className="modal-card__actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        {self && self.status !== 'signed' && (
          <button type="button" className="pill-btn pill-btn--primary" disabled={busy} onClick={onSelfSign}>
            {busy ? 'Bezig…' : 'Zelf ondertekenen'}
          </button>
        )}
        {others.map((p) => (
          <span key={p.id} style={{ display: 'inline-flex', gap: 6 }}>
            <button type="button" className="pill-btn" onClick={() => onSend(p)}>
              <IconSend size={13} /> Versturen naar {p.name || 'partij'}
            </button>
            {p.status !== 'signed' && dossier.lastSentAt && (
              <button type="button" className="pill-btn" onClick={() => onRemind(p)}>
                <IconClock size={13} /> Herinnering
              </button>
            )}
          </span>
        ))}
        {others.length > 0 && (
          <button type="button" className="pill-btn" onClick={onImport}>
            Getekend document importeren…
          </button>
        )}
        <button type="button" className="pill-btn" onClick={() => onDownload('signed')}>
          Getekende PDF openen
        </button>
        <button type="button" className="pill-btn" onClick={() => onDownload('orig')}>
          Origineel openen
        </button>
      </div>

      <div className="signing-detail__timeline">
        <div className="signing-detail__timeline-title">Tijdlijn</div>
        {dossier.events.map((ev, i) => (
          <div key={i} className="signing-detail__event">
            <span className="signing-detail__event-type">{ev.type}</span>
            {ev.note && <span className="signing-detail__event-note">{ev.note}</span>}
            <span className="signing-detail__event-when">{new Date(ev.when).toLocaleString('nl-NL')}</span>
          </div>
        ))}
      </div>

      <div className="modal-card__actions">
        <button type="button" className="pill-btn" onClick={onBack}>
          Terug
        </button>
        <button type="button" className="icon-btn icon-btn--chrome icon-btn--danger" onClick={onDelete} title="Dossier verwijderen">
          <IconTrash size={14} />
        </button>
      </div>
    </>
  )
}

function CertView({
  cert,
  busy,
  name,
  org,
  onName,
  onOrg,
  onCreate,
  onImport,
  onBack
}: {
  cert: { exists: boolean; subject?: string; validTo?: number; isSelfSigned?: boolean }
  busy: boolean
  name: string
  org: string
  onName: (v: string) => void
  onOrg: (v: string) => void
  onCreate: () => void
  onImport: () => void
  onBack: () => void
}): JSX.Element {
  return (
    <>
      <div className="smart-card__intro">
        Voor digitale (PAdES) ondertekening is een certificaat nodig. Gratis: maak een zelf-ondertekend certificaat aan
        (PDF-lezers tonen dan &quot;onbekende uitgever&quot;). Voor een vertrouwde handtekening importeert u later een
        AATL/gekwalificeerd .p12-certificaat.
      </div>

      {cert.exists ? (
        <div className="signing-cert__status">
          <strong>Actief certificaat:</strong> {cert.subject || 'onbekend'}
          {cert.validTo ? ` · geldig t/m ${new Date(cert.validTo).toLocaleDateString('nl-NL')}` : ''}
          {cert.isSelfSigned ? ' · zelf-ondertekend' : ' · vertrouwd'}
        </div>
      ) : (
        <div className="signing-cert__status signing-cert__status--none">Nog geen certificaat ingesteld.</div>
      )}

      <div className="templates-edit__grid">
        <label className="templates-edit__field">
          <span>Naam op certificaat</span>
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="bv. O. Visser AA" />
        </label>
        <label className="templates-edit__field">
          <span>Organisatie (optioneel)</span>
          <input value={org} onChange={(e) => onOrg(e.target.value)} placeholder="Otto Visser Accountants" />
        </label>
      </div>

      <div className="modal-card__actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <button type="button" className="pill-btn pill-btn--primary" disabled={busy} onClick={onCreate}>
          {busy ? 'Bezig…' : 'Zelf-ondertekend certificaat aanmaken'}
        </button>
        <button type="button" className="pill-btn" onClick={onImport}>
          .p12/.pfx importeren…
        </button>
        <button type="button" className="pill-btn" onClick={onBack}>
          Terug
        </button>
      </div>
    </>
  )
}
