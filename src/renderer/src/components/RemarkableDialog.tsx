import { useEffect, useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { uploadActiveToRemarkable } from '../lib/remarkableActions'
import { IconClose } from './icons'

const CONNECT_URL = 'https://my.remarkable.com/device/desktop/connect'

/**
 * Eenmalig koppelen met reMarkable: de gebruiker haalt een code van 8 tekens
 * op via my.remarkable.com en voert die hier in. Na koppelen wordt het actieve
 * document meteen geüpload.
 */
export default function RemarkableDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.remarkableDialogOpen)
  const setOpen = useStudioStore((s) => s.setRemarkableDialogOpen)
  const addToast = useStudioStore((s) => s.addToast)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paired, setPaired] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setCode('')
      setError(null)
      setBusy(false)
      return
    }
    setPaired(false)
    if (typeof window.api.remarkableStatus === 'function') {
      window.api
        .remarkableStatus()
        .then((s) => setPaired(s.paired))
        .catch(() => undefined)
    }
    window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  if (!open) return null

  async function submit(): Promise<void> {
    if (busy || !code.trim()) return
    setBusy(true)
    setError(null)
    const result = await window.api.remarkablePair(code)
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'Koppelen is mislukt')
      return
    }
    setOpen(false)
    addToast('success', 'Gekoppeld met reMarkable')
    await uploadActiveToRemarkable()
  }

  async function unpair(): Promise<void> {
    await window.api.remarkableUnpair()
    setPaired(false)
    addToast('info', 'Koppeling met reMarkable verwijderd')
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card remarkable-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn icon-btn--chrome remarkable-card__close" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
        <h3>Delen met reMarkable</h3>
        {paired ? (
          <>
            <p>Je bent al gekoppeld met reMarkable. Documenten komen in de map "PDF Studio".</p>
            <div className="modal-card__actions">
              <button type="button" className="pill-btn" onClick={() => void unpair()}>
                Ontkoppelen
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                onClick={() => {
                  setOpen(false)
                  void uploadActiveToRemarkable()
                }}
              >
                Nu delen
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Koppel PDF Studio één keer aan je reMarkable-account. Open{' '}
              <a href={CONNECT_URL} target="_blank" rel="noreferrer">
                my.remarkable.com/device/desktop/connect
              </a>{' '}
              (log in), en typ de code van 8 tekens hieronder over.
            </p>
            <input
              ref={inputRef}
              type="text"
              className="remarkable-card__code"
              placeholder="bijv. apwngead"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
                if (e.key === 'Escape') setOpen(false)
              }}
            />
            {error && <span className="modal-card__error">{error}</span>}
            <div className="modal-card__actions">
              <button type="button" className="pill-btn" onClick={() => setOpen(false)}>
                Annuleren
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || code.length < 6}
                onClick={() => void submit()}
              >
                {busy ? 'Koppelen…' : 'Koppelen en delen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
