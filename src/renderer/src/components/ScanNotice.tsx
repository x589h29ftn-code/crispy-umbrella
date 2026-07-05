import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import { groupHasText, ocrAvailable, ocrGroup } from '../lib/ocrActions'
import type { DocGroup } from '../types'

/**
 * Waarschuwt duidelijk wanneer een document geen tekstlaag heeft (gescand) en
 * biedt aan om ter plekke tekstherkenning (OCR) uit te voeren. Verschijnt boven
 * functies die tekst nodig hebben (tabellen, gegevens, sorteren, vergelijken,
 * privacy-scan). Rendert niets zodra er tekst is.
 */
export default function ScanNotice({ group }: { group: DocGroup | undefined }): JSX.Element | null {
  const sources = useStudioStore((s) => s.sources)
  const addToast = useStudioStore((s) => s.addToast)
  const [hasText, setHasText] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setHasText(null)
    if (!group) return
    groupHasText(group, sources)
      .then((t) => !cancelled && setHasText(t))
      .catch(() => !cancelled && setHasText(true))
    return () => {
      cancelled = true
    }
  }, [group, sources])

  if (!group || hasText === null || hasText) return null

  async function runOcr(): Promise<void> {
    if (!group || busy) return
    setBusy({ done: 0, total: group.pages.length })
    const n = await ocrGroup(group, sources, (done, total) => setBusy({ done, total }))
    setBusy(null)
    if (n > 0) {
      addToast('success', `Tekst herkend op ${n} pagina('s) — je kunt nu verder`)
      setHasText(await groupHasText(group, sources).catch(() => true))
    } else {
      addToast('info', 'Geen pagina’s gevonden om te herkennen')
    }
  }

  return (
    <div className="scan-notice">
      <span className="scan-notice__icon">⚠️</span>
      <div className="scan-notice__body">
        <strong>Dit document lijkt gescand (geen tekstlaag).</strong>
        <span>
          Deze functie werkt op tekst. Voer eerst <em>tekstherkenning (OCR)</em> uit — daarna zijn de tekst,
          tabellen en cijfers beschikbaar.
        </span>
      </div>
      {ocrAvailable() ? (
        <button type="button" className="pill-btn pill-btn--primary" disabled={Boolean(busy)} onClick={() => void runOcr()}>
          {busy ? `Bezig… ${busy.done}/${busy.total}` : 'Nu OCR uitvoeren'}
        </button>
      ) : (
        <span className="scan-notice__hint">OCR is alleen in de desktop-app beschikbaar</span>
      )}
    </div>
  )
}
