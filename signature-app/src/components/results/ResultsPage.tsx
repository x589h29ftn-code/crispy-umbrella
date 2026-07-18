import { useMemo, useState } from 'react'
import type { GeneratedSignature, GenerationParams, SignatureTweaks } from '../../types'
import { useAppStore } from '../../store'
import { getStyle } from '../../data/collections'
import { deriveParams } from '../../engine/suggest'
import { INK } from '../../engine/export'
import { SignaturePreview } from '../SignaturePreview'
import { ExportBar } from './ExportBar'
import { PracticeSheet } from './PracticeSheet'

const NEUTRAL_TWEAKS: SignatureTweaks = { slant: 0, thickness: 1, flourish: 1, size: 1 }

const INKS = [
  { value: INK, label: 'Donker' },
  { value: '#000000', label: 'Zwart' },
  { value: '#1b3a8f', label: 'Pennenblauw' }
]

/** Past de fijnafstemming van één handtekening toe op de basisparameters. */
function tweakedParams(base: GenerationParams, sig: GeneratedSignature): GenerationParams {
  const t = sig.tweaks
  if (!t) return base
  return {
    ...base,
    slantDeg: base.slantDeg + t.slant,
    strokeScale: base.strokeScale * t.thickness,
    flourishIntensity: Math.min(1.5, base.flourishIntensity * t.flourish),
    sizeScale: base.sizeScale * t.size
  }
}

function TuningPanel({ signature }: { signature: GeneratedSignature }) {
  const updateSignature = useAppStore((s) => s.updateSignature)
  const tweaks = signature.tweaks ?? NEUTRAL_TWEAKS
  const ink = signature.ink ?? INK

  const setTweak = (key: keyof SignatureTweaks, value: number) =>
    updateSignature(signature.id, { tweaks: { ...tweaks, [key]: value } })

  const slider = (
    label: string,
    key: keyof SignatureTweaks,
    min: number,
    max: number,
    step: number
  ) => (
    <label className="tune-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={tweaks[key]}
        onChange={(e) => setTweak(key, Number(e.target.value))}
      />
    </label>
  )

  return (
    <details className="tune-panel">
      <summary>Fijnafstemmen</summary>
      {slider('Schuinte', 'slant', -6, 6, 0.5)}
      {slider('Dikte', 'thickness', 0.6, 1.6, 0.05)}
      {slider('Zwier', 'flourish', 0.3, 1.5, 0.05)}
      {slider('Formaat', 'size', 0.8, 1.3, 0.025)}
      <div className="tune-row">
        <span>Inktkleur</span>
        <span className="ink-swatches">
          {INKS.map((option) => (
            <button
              key={option.value}
              className={`ink-swatch ${ink === option.value ? 'selected' : ''}`}
              style={{ background: option.value }}
              title={option.label}
              aria-label={`Inktkleur ${option.label}`}
              onClick={() => updateSignature(signature.id, { ink: option.value })}
            />
          ))}
        </span>
      </div>
      <button
        className="btn-ghost tune-reset"
        onClick={() => updateSignature(signature.id, { tweaks: undefined, ink: undefined })}
      >
        Herstel standaard
      </button>
    </details>
  )
}

export function ResultsPage() {
  const answers = useAppStore((s) => s.answers)
  const selected = useAppStore((s) => s.selected)
  const removeSignature = useAppStore((s) => s.removeSignature)
  const setPhase = useAppStore((s) => s.setPhase)
  const reset = useAppStore((s) => s.reset)

  const params = useMemo(() => deriveParams(answers), [answers])
  const [practiceFor, setPracticeFor] = useState<GeneratedSignature | null>(null)

  // Verwijzing op id zodat het oefenblad live fijnafstemming volgt
  const practiceSig = practiceFor ? selected.find((s) => s.id === practiceFor.id) ?? null : null

  return (
    <div className="results-page">
      <header className="page-header">
        <button className="btn-ghost" onClick={() => setPhase('collections')}>← Collecties</button>
        <div className="page-header-info">
          <h1>Jouw handtekeningen</h1>
          <p>
            Stel bij met de schuifjes, download als PNG of SVG voor digitaal gebruik, of print het
            oefenblad om hem met de hand te leren schrijven.
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
            const sigParams = tweakedParams(params, sig)
            return (
              <article key={sig.id} className="result-card">
                <div className="result-paper" style={{ color: sig.ink ?? INK }}>
                  <SignaturePreview
                    style={style}
                    params={sigParams}
                    text={sig.text}
                    seed={sig.seed}
                    className="result-sig"
                  />
                </div>
                <div className="result-meta">
                  <span className="result-label">{style.label}</span>
                  <span className="result-text">{sig.text}</span>
                </div>
                <TuningPanel signature={sig} />
                <ExportBar
                  signature={sig}
                  style={style}
                  params={sigParams}
                  onPractice={() => setPracticeFor(sig)}
                  onRemove={() => removeSignature(sig.id)}
                />
              </article>
            )
          })}
        </div>
      )}

      {practiceSig && (
        <PracticeSheet
          signature={practiceSig}
          params={tweakedParams(params, practiceSig)}
          onClose={() => setPracticeFor(null)}
        />
      )}
    </div>
  )
}
