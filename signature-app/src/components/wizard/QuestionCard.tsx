import { useState } from 'react'
import type { Question } from '../../data/questions'
import type { WizardAnswers } from '../../types'
import { useAppStore } from '../../store'
import { NamePartsInput } from './NamePartsInput'

interface Props {
  question: Question
  onNext: () => void
}

export function QuestionCard({ question, onNext }: Props) {
  const answers = useAppStore((s) => s.answers)
  const answerQuestion = useAppStore((s) => s.answerQuestion)
  const current = answers[question.key]
  const [textValue, setTextValue] = useState<string>(
    question.type === 'text' && typeof current === 'string' ? current : ''
  )
  const [sliderValue, setSliderValue] = useState<number>(
    question.type === 'slider' && typeof current === 'number' ? current : 3
  )

  const submitText = () => {
    const value = textValue.trim()
    if (!value) return
    answerQuestion(question.key, value as never)
    // Naamvarianten resetten als de naam wijzigt, zodat vraag 2 verse chips toont
    if (question.key === 'fullName' && value !== current) {
      answerQuestion('nameVariants', [] as never)
    }
    onNext()
  }

  const choose = (value: WizardAnswers[keyof WizardAnswers]) => {
    answerQuestion(question.key, value as never)
    onNext()
  }

  return (
    <div className="question-card">
      <h1 className="question-title">{question.title}</h1>
      {question.subtitle && <p className="question-subtitle">{question.subtitle}</p>}

      {question.type === 'text' && (
        <form
          className="question-text"
          onSubmit={(e) => {
            e.preventDefault()
            submitText()
          }}
        >
          <input
            autoFocus
            type="text"
            value={textValue}
            placeholder={question.placeholder}
            onChange={(e) => setTextValue(e.target.value)}
            maxLength={60}
          />
          <button type="submit" className="btn-primary" disabled={!textValue.trim()}>
            Verder →
          </button>
        </form>
      )}

      {question.type === 'nameParts' && <NamePartsInput onNext={onNext} />}

      {question.type === 'choice' && (
        <div className="question-choices">
          {question.options?.map((opt) => (
            <button
              key={String(opt.value)}
              className={`choice-btn ${current === opt.value ? 'selected' : ''}`}
              onClick={() => choose(opt.value as never)}
            >
              <span className="choice-label">{opt.label}</span>
              {opt.hint && <span className="choice-hint">{opt.hint}</span>}
            </button>
          ))}
        </div>
      )}

      {question.type === 'slider' && (
        <div className="question-slider">
          <div className="slider-labels">
            <span>{question.sliderLabels?.[0]}</span>
            <span>{question.sliderLabels?.[1]}</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={sliderValue}
            onChange={(e) => setSliderValue(Number(e.target.value))}
          />
          <div className="slider-value">{sliderValue}</div>
          <button
            className="btn-primary"
            onClick={() => {
              answerQuestion(question.key, sliderValue as never)
              onNext()
            }}
          >
            Verder →
          </button>
        </div>
      )}
    </div>
  )
}
