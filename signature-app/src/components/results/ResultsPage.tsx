import { useMemo, useState } from 'react'
import type { GeneratedSignature } from '../../types'
import { useAppStore } from '../../store'
import { getStyle } from '../../data/collections'
import { deriveParams } from '../../engine/suggest'
import { SignaturePreview } from '../SignaturePreview'
import { ExportBar } from './ExportBar'
import { PracticeSheet } from './PracticeSheet'

export function ResultsPage() {
  const answers = useAppStore((s) => s.answers)
  const selected = useAppStore((s) => s.selected)
  const removeSignature = useAppStore((s) => s.removeSignature)
  const setPhase = useAppStore((s) => s.setPhase)
  const reset = useAppStore((s) => s.reset)

  const params = useMemo(() => deriveParams(answers), [answers])
  const [practiceFor, setPracticeFor] = useState<GeneratedSignature | null>(null)

  return (
    <div className="results-page">
      <header className="page-header">
        <button className="btn-ghost" onClick={() => setPhase('collections')}>← Collecties</button>
        <div className="page-header-info">
          <h1>Jouw handtekeningen</h1>
          <p>
            Download je handtekening als PNG of SVG voor digitaal gebruik, of print het oefenblad
            om hem met de hand te leren schrijven.
          </p>
        </div>
        <button
          className="btn-ghost"
          onClick={() => {
            if (confirm('Opnieuw beginnen? Je antwoorden en selectie worden gewist.')) reset()
          }}
        >
          Opnieuw beginnen
        </button>
      </header>

      {selected.length === 0 ? (
        <div className="empty-state">
          <p>Je hebt nog geen handtekeningen gekozen.</p>
          <button className="btn-primary" onClick={() => setPhase('collections')}>
            Kies je stijlen →
          </button>
        </div>
      ) : (
        <div className="results-grid">
          {selected.map((sig) => {
            const style = getStyle(sig.styleId)
            if (!style) return null
            return (
              <article key={sig.id} className="result-card">
                <div className="result-paper">
                  <SignaturePreview
                    style={style}
                    params={params}
                    text={sig.text}
                    seed={sig.seed}
                    className="result-sig"
                  />
                </div>
                <div className="result-meta">
                  <span className="result-label">{style.label}</span>
                  <span className="result-text">{sig.text}</span>
                </div>
                <ExportBar
                  signature={sig}
                  style={style}
                  params={params}
                  onPractice={() => setPracticeFor(sig)}
                  onRemove={() => removeSignature(sig.id)}
                />
              </article>
            )
          })}
        </div>
      )}

      {practiceFor && (
        <PracticeSheet signature={practiceFor} params={params} onClose={() => setPracticeFor(null)} />
      )}
    </div>
  )
}
