import { useMemo } from 'react'
import type { Collection, GenerationParams, SignatureStyle } from '../../types'
import { signatureId, useAppStore } from '../../store'
import { pickVariant } from '../../engine/suggest'
import { hashString } from '../../engine/random'
import { SignaturePreview } from '../SignaturePreview'

interface Props {
  style: SignatureStyle
  collection: Collection
  params: GenerationParams
}

export function StyleCard({ style, collection, params }: Props) {
  const answers = useAppStore((s) => s.answers)
  const selected = useAppStore((s) => s.selected)
  const toggleStyle = useAppStore((s) => s.toggleStyle)
  const shuffleStyle = useAppStore((s) => s.shuffleStyle)
  const variant = useAppStore((s) => s.styleVariants[style.id] ?? 0)

  const text = useMemo(() => pickVariant(style, answers), [style, answers])
  const id = signatureId(style.id, text, variant)
  const isSelected = selected.some((sig) => sig.id === id)
  const seed = hashString(id)

  return (
    <div
      className={`style-card ${isSelected ? 'selected' : ''}`}
      style={{ background: collection.cardBackground, color: collection.cardInk }}
      onClick={() => toggleStyle(style.id, text, variant)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggleStyle(style.id, text, variant)
        }
      }}
      aria-pressed={isSelected}
    >
      <SignaturePreview style={style} params={params} text={text} seed={seed} className="style-card-sig" />
      <span className="style-card-label">{style.label}</span>
      <button
        className="style-card-shuffle"
        title="Nieuwe variatie"
        aria-label={`Nieuwe variatie van ${style.label}`}
        onClick={(e) => {
          e.stopPropagation()
          shuffleStyle(style.id)
        }}
      >
        ↻
      </button>
      {isSelected && <span className="style-card-check" aria-hidden="true">✓</span>}
    </div>
  )
}
