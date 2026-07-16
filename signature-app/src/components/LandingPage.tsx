import { useAppStore } from '../store'
import { STYLES } from '../data/collections'
import { DEFAULT_PARAMS } from '../engine/compose'
import { hashString } from '../engine/random'
import { SignaturePreview } from './SignaturePreview'

const DEMOS: { styleId: string; text: string }[] = [
  { styleId: 'elegant-1', text: 'H. Ramaekers' },
  { styleId: 'zakelijk-3', text: 'T. Fenlon' },
  { styleId: 'abstract-1', text: 'Daisy Olivier' }
]

export function LandingPage() {
  const setPhase = useAppStore((s) => s.setPhase)
  const setStep = useAppStore((s) => s.setStep)
  const answers = useAppStore((s) => s.answers)
  const hasProgress = !!answers.fullName

  const start = () => {
    setStep(0)
    setPhase('wizard')
  }

  return (
    <div className="landing">
      <header className="landing-hero">
        <p className="landing-brand">✍️ Handtekening Studio</p>
        <h1>Ontwerp je perfecte handtekening</h1>
        <p className="landing-sub">
          Beantwoord een korte vragenlijst, kies je favoriete stijlen uit onze collecties en
          gebruik je nieuwe handtekening direct — digitaal én op papier.
        </p>
        <div className="landing-cta">
          <button className="btn-primary btn-large" onClick={start}>
            Maak je handtekening →
          </button>
          {hasProgress && (
            <button className="btn-ghost" onClick={() => setPhase('wizard')}>
              Ga verder waar je was
            </button>
          )}
        </div>
      </header>

      <section className="landing-demos">
        {DEMOS.map(({ styleId, text }) => {
          const style = STYLES.find((s) => s.id === styleId)
          if (!style) return null
          return (
            <div className="landing-demo-card" key={styleId}>
              <SignaturePreview
                style={style}
                params={DEFAULT_PARAMS}
                text={text}
                seed={hashString(`${styleId}::${text}`)}
                className="landing-demo-sig"
              />
            </div>
          )
        })}
      </section>

      <section className="landing-steps">
        <div className="landing-step">
          <span className="landing-step-nr">01</span>
          <h3>Vertel over jezelf</h3>
          <p>14 korte vragen over je naam, schrijfhand en smaak — klaar in 2 minuten.</p>
        </div>
        <div className="landing-step">
          <span className="landing-step-nr">02</span>
          <h3>Kies je stijlen</h3>
          <p>Bekijk je naam in tientallen handtekening-stijlen, verdeeld over 6 collecties.</p>
        </div>
        <div className="landing-step">
          <span className="landing-step-nr">03</span>
          <h3>Gebruik & oefen</h3>
          <p>Download als PNG/SVG voor digitaal ondertekenen en leer hem schrijven met het oefenblad.</p>
        </div>
      </section>

      <footer className="landing-footer">
        Gratis · zonder account · alles blijft op je eigen apparaat
      </footer>
    </div>
  )
}
