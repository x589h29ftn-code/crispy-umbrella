import { useState } from 'react'
import { suggestNameVariants } from '../../data/questions'
import { useAppStore } from '../../store'

interface Props {
  onNext: () => void
}

/** Vraag 2: kies naamvarianten via automatisch gegenereerde chips + vrij veld. */
export function NamePartsInput({ onNext }: Props) {
  const answers = useAppStore((s) => s.answers)
  const answerQuestion = useAppStore((s) => s.answerQuestion)
  const suggestions = suggestNameVariants(answers.fullName ?? '')
  const [selected, setSelected] = useState<string[]>(
    answers.nameVariants?.length ? answers.nameVariants : suggestions.slice(0, 2)
  )
  const [custom, setCustom] = useState('')

  const toggle = (variant: string) =>
    setSelected((cur) =>
      cur.includes(variant) ? cur.filter((v) => v !== variant) : [...cur, variant]
    )

  const addCustom = () => {
    const value = custom.trim()
    if (!value) return
    if (!selected.includes(value)) setSelected([...selected, value])
    setCustom('')
  }

  const allChips = [...suggestions, ...selected.filter((v) => !suggestions.includes(v))]

  return (
    <div className="name-parts">
      <div className="chips">
        {allChips.map((variant) => (
          <button
            key={variant}
            className={`chip ${selected.includes(variant) ? 'selected' : ''}`}
            onClick={() => toggle(variant)}
          >
            {variant}
          </button>
        ))}
      </div>
      <form
        className="chip-custom"
        onSubmit={(e) => {
          e.preventDefault()
          addCustom()
        }}
      >
        <input
          type="text"
          value={custom}
          placeholder="Eigen variant toevoegen…"
          onChange={(e) => setCustom(e.target.value)}
          maxLength={60}
        />
        <button type="submit" className="btn-ghost" disabled={!custom.trim()}>
          + Toevoegen
        </button>
      </form>
      <button
        className="btn-primary"
        disabled={selected.length === 0}
        onClick={() => {
          answerQuestion('nameVariants', selected as never)
          onNext()
        }}
      >
        Verder →
      </button>
    </div>
  )
}
