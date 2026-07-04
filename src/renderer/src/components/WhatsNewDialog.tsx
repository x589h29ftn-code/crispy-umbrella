import { useEffect, useState } from 'react'
import { APP_CHANGELOG } from '../lib/changelog'
import { IconCheck } from './icons'

const SEEN_VERSION_KEY = 'pdf-studio-seen-version'

/**
 * Eénmalige "Wat is nieuw"-dialoog na een update: verschijnt wanneer de
 * app-versie hoger is dan de laatst geziene versie, daarna nooit meer.
 * Bij de allereerste start wordt alleen de versie onthouden.
 */
export default function WhatsNewDialog(): JSX.Element | null {
  const [entry, setEntry] = useState<{ version: string; items: string[] } | null>(null)

  useEffect(() => {
    if (typeof window.api.getAppVersion !== 'function') return
    window.api
      .getAppVersion()
      .then((version) => {
        const seen = window.localStorage.getItem(SEEN_VERSION_KEY)
        if (!seen) {
          window.localStorage.setItem(SEEN_VERSION_KEY, version)
          return
        }
        if (seen === version) return
        const match = APP_CHANGELOG.find((e) => e.version === version)
        if (match) setEntry(match)
        else window.localStorage.setItem(SEEN_VERSION_KEY, version)
      })
      .catch(() => undefined)
  }, [])

  if (!entry) return null

  function close(): void {
    window.localStorage.setItem(SEEN_VERSION_KEY, entry!.version)
    setEntry(null)
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-card whatsnew-card" onClick={(e) => e.stopPropagation()}>
        <h3>Wat is nieuw in versie {entry.version}</h3>
        <ul className="whatsnew-list">
          {entry.items.map((item, i) => (
            <li key={i}>
              <IconCheck size={13} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="modal-card__actions">
          <button type="button" className="pill-btn pill-btn--primary" onClick={close}>
            Aan de slag
          </button>
        </div>
      </div>
    </div>
  )
}
