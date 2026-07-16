import { useMemo } from 'react'
import type { Collection, GenerationParams, SignatureStyle } from '../../types'
import { useAppStore } from '../../store'
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

  const text = useMemo(() => pickVariant(style, answers), [style, answers])
  const id = `${style.id}::${text}`
  const isSelected = selected.some((sig) => sig.id === id)
  const seed = hashString(id)

  return (
    <button
      className={`style-card ${isSelected ? 'selected' : ''}`}
      style={{ background: collection.cardBackground, color: collection.cardInk }}
      onClick={() => toggleStyle(style.id, text)}
      aria-pressed={isSelected}
    >
      <SignaturePreview style={style} params={params} text={text} seed={seed} className="style-card-sig" />
      <span className="style-card-label">{style.label}</span>
      {isSelected && <span className="style-card-check" aria-hidden="true">✓</span>}
    </button>
  )
}
