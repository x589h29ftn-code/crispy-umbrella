import { QUESTIONS } from '../../data/questions'
import { useAppStore } from '../../store'
import { QuestionCard } from './QuestionCard'

export function Wizard() {
  const currentStep = useAppStore((s) => s.currentStep)
  const setStep = useAppStore((s) => s.setStep)
  const setPhase = useAppStore((s) => s.setPhase)

  const step = Math.min(currentStep, QUESTIONS.length - 1)
  const question = QUESTIONS[step]
  const progress = (step / QUESTIONS.length) * 100

  const goBack = () => {
    if (step === 0) setPhase('landing')
    else setStep(step - 1)
  }

  const goNext = () => {
    if (step === QUESTIONS.length - 1) setPhase('collections')
    else setStep(step + 1)
  }

  return (
    <div className="wizard">
      <div className="wizard-progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
        <div className="wizard-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <header className="wizard-header">
        <button className="btn-ghost" onClick={goBack}>← Terug</button>
        <span className="wizard-count">Vraag {step + 1} van {QUESTIONS.length}</span>
      </header>
      <main className="wizard-main">
        <QuestionCard key={question.key} question={question} onNext={goNext} />
      </main>
    </div>
  )
}
