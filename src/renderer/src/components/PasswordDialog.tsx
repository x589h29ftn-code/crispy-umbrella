import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import { IconLock } from './icons'

export default function PasswordDialog(): JSX.Element | null {
  const request = useStudioStore((s) => s.passwordRequest)
  const submitPassword = useStudioStore((s) => s.submitPassword)
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue('')
  }, [request])

  if (!request) return null

  return (
    <div className="modal-overlay">
      <form
        className="modal-card"
        onSubmit={(e) => {
          e.preventDefault()
          if (value) submitPassword(value)
        }}
      >
        <div className="modal-card__icon">
          <IconLock size={22} />
        </div>
        <h3>Beveiligde PDF</h3>
        <p>
          "{request.fileName}" is met een wachtwoord beveiligd.
          {request.attempt > 1 && (
            <>
              <br />
              <span className="modal-card__error">Onjuist wachtwoord, probeer opnieuw.</span>
            </>
          )}
        </p>
        <input
          autoFocus
          type="password"
          placeholder="Wachtwoord"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') submitPassword(null)
          }}
        />
        <div className="modal-card__actions">
          <button type="button" className="pill-btn" onClick={() => submitPassword(null)}>
            Overslaan
          </button>
          <button type="submit" className="pill-btn pill-btn--primary" disabled={!value}>
            Ontgrendelen
          </button>
        </div>
      </form>
    </div>
  )
}
