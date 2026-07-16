import type { GeneratedSignature, GenerationParams } from '../../types'
import { getStyle } from '../../data/collections'
import { SignaturePreview } from '../SignaturePreview'

interface Props {
  signature: GeneratedSignature
  params: GenerationParams
  onClose: () => void
}

/** Printbaar oefenblad (A4): voorbeeld + overtrekrijen die steeds verder
 *  vervagen + lege oefenrijen. Zo leert de hand de handtekening stap voor stap. */
export function PracticeSheet({ signature, params, onClose }: Props) {
  const style = getStyle(signature.styleId)
  if (!style) return null

  const row = (mode: 'solid' | 'dashed', opacity: number, key: string) => (
    <div className="practice-row" key={key}>
      {[0, 1, 2].map((i) => (
        <span className="practice-cell" style={{ opacity }} key={i}>
          <SignaturePreview
            style={style}
            params={params}
            text={signature.text}
            seed={signature.seed}
            mode={mode}
            className="practice-sig"
          />
        </span>
      ))}
    </div>
  )

  return (
    <div className="practice-overlay" role="dialog" aria-label="Oefenblad">
      <div className="practice-actions">
        <button className="btn-primary" onClick={() => window.print()}>Afdrukken</button>
        <button className="btn-ghost" onClick={onClose}>Sluiten ✕</button>
      </div>

      <div className="practice-sheet">
        <header className="practice-header">
          <h1>Oefenblad · {signature.text}</h1>
          <p>
            Schrijf in één vloeiende beweging en til de pen zo min mogelijk op. Trek eerst de
            donkere voorbeelden over, daarna de lichtere en de stippellijnen, en schrijf tot slot
            uit het hoofd op de lege regels. Tip: tien minuten per dag is genoeg.
          </p>
        </header>

        <div className="practice-example">
          <SignaturePreview
            style={style}
            params={params}
            text={signature.text}
            seed={signature.seed}
            className="practice-sig-large"
          />
        </div>

        <h2 className="practice-step">Stap 1 · Overtrekken</h2>
        {row('solid', 0.55, 'trace-1')}
        {row('solid', 0.55, 'trace-2')}

        <h2 className="practice-step">Stap 2 · Bijna zelf</h2>
        {row('solid', 0.28, 'faint-1')}
        {row('solid', 0.28, 'faint-2')}

        <h2 className="practice-step">Stap 3 · Alleen de contour</h2>
        {row('dashed', 0.45, 'dash-1')}

        <h2 className="practice-step">Stap 4 · Uit het hoofd</h2>
        <div className="practice-row practice-empty" />
        <div className="practice-row practice-empty" />
        <div className="practice-row practice-empty" />

        <footer className="practice-footer">Handtekening Studio · stijl: {style.label}</footer>
      </div>
    </div>
  )
}
