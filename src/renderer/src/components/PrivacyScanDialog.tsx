import { useEffect, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import {
  scanPageForSensitiveData,
  SENSITIVE_LABELS,
  SENSITIVE_KINDS,
  DEFAULT_SENSITIVE_KINDS,
  type SensitiveKind,
  type SensitiveMatch
} from '../lib/sensitiveData'
import { IconClose, IconShield } from './icons'

/**
 * Privacy-scan (AVG): doorzoekt het actieve document op BSN, IBAN, e-mail en
 * telefoonnummers, en laat je ze met één klik echt zwart lakken (redigeren).
 */
export default function PrivacyScanDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.privacyScanOpen)
  const setOpen = useStudioStore((s) => s.setPrivacyScanOpen)
  const groups = useStudioStore((s) => s.groups)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const sources = useStudioStore((s) => s.sources)
  const addAnnotation = useStudioStore((s) => s.addAnnotation)
  const markHistory = useStudioStore((s) => s.markHistory)
  const addToast = useStudioStore((s) => s.addToast)

  const [scanning, setScanning] = useState(false)
  const [matches, setMatches] = useState<SensitiveMatch[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [enabledKinds, setEnabledKinds] = useState<Set<SensitiveKind>>(new Set(DEFAULT_SENSITIVE_KINDS))

  useEffect(() => {
    if (!open) {
      setMatches([])
      setSelected(new Set())
      setEnabledKinds(new Set(DEFAULT_SENSITIVE_KINDS))
      return
    }
    const group = groups.find((g) => g.id === activeGroupId) ?? groups[0]
    if (!group) return
    let cancelled = false
    setScanning(true)
    ;(async () => {
      const found: SensitiveMatch[] = []
      for (let i = 0; i < group.pages.length; i += 1) {
        const page = group.pages[i]
        const source = sources.get(page.sourceId)
        if (!source) continue
        const pageMatches = await scanPageForSensitiveData(source, page, enabledKinds).catch(() => [])
        for (const m of pageMatches) found.push({ ...m, pageNumber: i + 1 })
      }
      if (cancelled) return
      // Dedupe identieke treffers (zelfde tekst + plek).
      const unique = new Map<string, SensitiveMatch>()
      for (const m of found) unique.set(m.id, m)
      const list = [...unique.values()]
      setMatches(list)
      setSelected(new Set(list.map((m) => m.id)))
      setScanning(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, groups, activeGroupId, sources, enabledKinds])

  if (!open) return null

  function toggleKind(kind: SensitiveKind): void {
    setEnabledKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function redactSelected(): void {
    const chosen = matches.filter((m) => selected.has(m.id))
    if (!chosen.length) return
    markHistory()
    for (const m of chosen) {
      addAnnotation(m.pageId, { id: nanoid(), type: 'redact', ...m.rect, fill: 'black' })
    }
    addToast('success', `${chosen.length} gevoelig(e) gegeven(s) zwart gelakt — verdwijnt écht bij export`)
    setOpen(false)
  }

  const byKind = new Map<SensitiveKind, SensitiveMatch[]>()
  for (const m of matches) {
    const list = byKind.get(m.kind) ?? []
    list.push(m)
    byKind.set(m.kind, list)
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card privacy-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn icon-btn--chrome privacy-card__close" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
        <h3>
          <IconShield size={16} /> Privacy-scan (AVG)
        </h3>
        <div className="privacy-card__kinds">
          <span className="privacy-card__kinds-label">Scannen op:</span>
          {SENSITIVE_KINDS.map((kind) => (
            <label key={kind} className={`privacy-chip${enabledKinds.has(kind) ? ' privacy-chip--on' : ''}`}>
              <input type="checkbox" checked={enabledKinds.has(kind)} onChange={() => toggleKind(kind)} />
              {SENSITIVE_LABELS[kind]}
            </label>
          ))}
        </div>
        {scanning ? (
          <p>Document wordt doorzocht op gevoelige gegevens…</p>
        ) : matches.length === 0 ? (
          <p>Geen gegevens gevonden voor de gekozen categorieën in dit document.</p>
        ) : (
          <>
            <p className="privacy-card__intro">
              {matches.length} mogelijk gevoelig(e) gegeven(s) gevonden. Vink aan wat je zwart wilt lakken; bij export
              verdwijnt de tekst écht uit het bestand.
            </p>
            <div className="privacy-card__list">
              {[...byKind.entries()].map(([kind, list]) => (
                <div key={kind} className="privacy-card__group">
                  <div className="privacy-card__group-title">
                    {SENSITIVE_LABELS[kind]} · {list.length}
                  </div>
                  {list.map((m) => (
                    <label key={m.id} className="privacy-card__item">
                      <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                      <span className="privacy-card__text">{m.text}</span>
                      <span className="privacy-card__page">p. {m.pageNumber}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="modal-card__actions">
              <button type="button" className="pill-btn" onClick={() => setOpen(false)}>
                Annuleren
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={selected.size === 0}
                onClick={redactSelected}
              >
                {selected.size} zwart lakken
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
