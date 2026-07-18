import { useEffect, useMemo, useState } from 'react'
import type { GeneratedSignature, GenerationParams, SignatureRender } from '../../types'
import { getStyle } from '../../data/collections'
import { ensureStyleAssets, styleAssetsReady } from '../../engine/fontManager'
import { renderSignature } from '../../engine/compose'
import { SignaturePreview } from '../SignaturePreview'
import { AnimatedSignature } from '../AnimatedSignature'

interface Props {
  signature: GeneratedSignature
  params: GenerationParams
  onClose: () => void
}

/** Eén opbouw-paneel: eerdere stappen in grijs, de nieuwe streek in inkt,
 *  met een groene startstip + richtingspijl waar de pen neerkomt. */
function StepPanel({ render, index }: { render: SignatureRender; index: number }) {
  const steps = render.steps ?? []
  const step = steps[index]
  const { x, y, w, h } = render.viewBox
  const marker = useMemo(() => {
    if (!step.start) return null
    const r = Math.max(w, h) * 0.018
    let arrow = null
    if (step.dir) {
      const len = Math.hypot(step.dir[0], step.dir[1]) || 1
      const ux = step.dir[0] / len
      const uy = step.dir[1] / len
      const ax = step.start[0] + ux * r * 4
      const ay = step.start[1] + uy * r * 4
      // Pijlpunt: driehoekje in de beginrichting
      const px = -uy * r
      const py = ux * r
      arrow = (
        <>
          <line x1={step.start[0]} y1={step.start[1]} x2={ax} y2={ay} stroke="#1e6f46" strokeWidth={r * 0.6} strokeLinecap="round" />
          <polygon
            points={`${ax + ux * r * 2},${ay + uy * r * 2} ${ax + px},${ay + py} ${ax - px},${ay - py}`}
            fill="#1e6f46"
          />
        </>
      )
    }
    return (
      <>
        <circle cx={step.start[0]} cy={step.start[1]} r={r * 1.4} fill="#1e6f46" />
        {arrow}
      </>
    )
  }, [step, w, h])

  return (
    <figure className="practice-panel">
      <svg viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={step.label}>
        <g color="#c3beb2">
          {steps.slice(0, index).flatMap((s, si) =>
            s.paths.map((p, pi) => (
              <path key={`${si}-${pi}`} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            ))
          )}
        </g>
        <g color="#1a1a2e">
          {step.paths.map((p, pi) => (
            <path key={pi} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
        {marker}
      </svg>
      <figcaption>
        <span className="practice-panel-nr">{index + 1}</span> {step.label}
      </figcaption>
    </figure>
  )
}

/** Printbaar oefenblad (A4): eerst de logische teken-opbouw (streek voor
 *  streek, met startpunt en richting), daarna overtrekken in vervagende
 *  stappen en lege oefenregels. */
export function PracticeSheet({ signature, params, onClose }: Props) {
  const style = getStyle(signature.styleId)
  const [ready, setReady] = useState(() => (style ? styleAssetsReady(style) : false))
  const [replay, setReplay] = useState(0)

  useEffect(() => {
    if (!style || styleAssetsReady(style)) return
    let live = true
    ensureStyleAssets(style).then(
      () => live && setReady(true),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [style])

  const render = useMemo(
    () => (style && ready ? renderSignature(style, params, signature.text, signature.seed) : null),
    [style, ready, params, signature]
  )

  if (!style) return null
  const steps = render?.steps ?? []

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
            Volg eerst de opbouw hieronder: de groene stip is waar je pen neerkomt, het pijltje de
            beginrichting. Schrijf elke streek in één vloeiende beweging en til de pen alleen op
            tussen de stappen. Oefen daarna met overtrekken en sluit af uit het hoofd — tien
            minuten per dag is genoeg.
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

        {render && steps.length > 0 && (
          <section className="practice-section">
            <h2 className="practice-step">Stap 1 · Zo bouw je hem op</h2>
            <div className="practice-build">
              {steps.map((_, i) => (
                <StepPanel key={i} render={render} index={i} />
              ))}
            </div>
            <div className="practice-animation">
              <AnimatedSignature
                key={replay}
                style={style}
                params={params}
                text={signature.text}
                seed={signature.seed}
              />
              <button className="btn-small" onClick={() => setReplay((r) => r + 1)}>
                ▶ Bekijk het tempo
              </button>
            </div>
          </section>
        )}

        <section className="practice-section">
          <h2 className="practice-step">Stap 2 · Overtrekken</h2>
          {row('solid', 0.55, 'trace-1')}
          {row('solid', 0.55, 'trace-2')}
        </section>

        <section className="practice-section">
          <h2 className="practice-step">Stap 3 · Bijna zelf</h2>
          {row('solid', 0.28, 'faint-1')}
          {row('solid', 0.28, 'faint-2')}
        </section>

        <section className="practice-section">
          <h2 className="practice-step">Stap 4 · Alleen de contour</h2>
          {row('dashed', 0.45, 'dash-1')}
        </section>

        <section className="practice-section">
          <h2 className="practice-step">Stap 5 · Uit het hoofd</h2>
          <div className="practice-row practice-empty" />
          <div className="practice-row practice-empty" />
          <div className="practice-row practice-empty" />
        </section>

        <footer className="practice-footer">Handtekening Studio · stijl: {style.label}</footer>
      </div>
    </div>
  )
}
