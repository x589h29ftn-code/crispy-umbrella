import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'

/**
 * Update-melding: zodra een nieuwe versie op de achtergrond is gedownload
 * verschijnt onderin een balk met een herstart-knop; de update wordt anders
 * gewoon bij de volgende start geïnstalleerd.
 */
export default function UpdateBanner(): JSX.Element | null {
  const addToast = useStudioStore((s) => s.addToast)
  const [downloaded, setDownloaded] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window.api.onUpdateEvent !== 'function') return
    return window.api.onUpdateEvent((event) => {
      if (event.type === 'available' && event.version) {
        addToast('info', `Nieuwe versie ${event.version} wordt op de achtergrond gedownload…`)
      } else if (event.type === 'downloaded') {
        setDownloaded(event.version ?? '')
      }
    })
  }, [addToast])

  if (downloaded === null) return null

  return (
    <div className="update-banner">
      <span>
        Versie {downloaded} staat klaar — wordt bij de volgende start geïnstalleerd.
      </span>
      <button type="button" className="pill-btn pill-btn--primary" onClick={() => void window.api.installUpdate()}>
        Nu opnieuw starten
      </button>
      <button type="button" className="pill-btn" onClick={() => setDownloaded(null)}>
        Later
      </button>
    </div>
  )
}
