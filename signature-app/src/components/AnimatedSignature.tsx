import { useEffect, useId, useMemo, useState } from 'react'
import type { GenerationParams, SignatureStyle } from '../types'
import { ensureStyleAssets, styleAssetsReady } from '../engine/fontManager'
import { renderSignature } from '../engine/compose'

interface Props {
  style: SignatureStyle
  params: GenerationParams
  text: string
  seed: number
  /** Blijft herhalen (landingspagina); zonder loop speelt hij één keer af. */
  loop?: boolean
  className?: string
}

const PEN_SPEED = 320 // eenheden per seconde (bij fontSize 100)
const STEP_PAUSE = 0.18
const LOOP_PAUSE = 1.6

/** Handtekening die zichzelf schrijft. Penlijn-stijlen worden onthuld langs de
 *  echte pen-route (via een geanimeerd masker over de inkt); font-stijlen faden
 *  per tekenstap in. */
export function AnimatedSignature({ style, params, text, seed, loop = false, className }: Props) {
  const maskBase = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [ready, setReady] = useState(() => styleAssetsReady(style))
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (styleAssetsReady(style)) {
      setReady(true)
      return
    }
    let live = true
    ensureStyleAssets(style).then(
      () => live && setReady(true),
      () => undefined
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style.fontId, style.engine])

  const render = useMemo(
    () => (ready ? renderSignature(style, params, text, seed) : null),
    [ready, style, params, text, seed]
  )

  // Tijdlijn: duur per stap evenredig met de afgelegde pen-route
  const timeline = useMemo(() => {
    const steps = render?.steps ?? []
    let t = 0.2
    return steps.map((step) => {
      const dur = step.guide ? Math.max(0.35, step.guide.len / PEN_SPEED) : 0.7
      const item = { delay: t, dur }
      t += dur + STEP_PAUSE
      return item
    })
  }, [render])

  const totalDur = timeline.length
    ? timeline[timeline.length - 1].delay + timeline[timeline.length - 1].dur
    : 0

  useEffect(() => {
    if (!loop || !totalDur) return
    const interval = setInterval(() => setRun((r) => r + 1), (totalDur + LOOP_PAUSE) * 1000)
    return () => clearInterval(interval)
  }, [loop, totalDur])

  if (!render) return <div className={`sig-skeleton ${className ?? ''}`} aria-hidden="true" />

  const { x, y, w, h } = render.viewBox
  const steps = render.steps ?? []

  return (
    <svg
      key={run}
      className={className}
      viewBox={`${x} ${y} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Handtekening wordt geschreven: ${text}`}
    >
      <defs>
        {steps.map((step, i) =>
          step.guide ? (
            <mask id={`${maskBase}-${i}`} key={i} maskUnits="userSpaceOnUse" x={x} y={y} width={w} height={h}>
              <path
                d={step.guide.d}
                fill="none"
                stroke="#fff"
                strokeWidth={step.guide.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={1}
                style={{
                  strokeDashoffset: 1,
                  animation: `sig-draw ${timeline[i].dur}s ease-in-out ${timeline[i].delay}s forwards`
                }}
              />
            </mask>
          ) : null
        )}
      </defs>
      {steps.map((step, i) => (
        <g
          key={i}
          mask={step.guide ? `url(#${maskBase}-${i})` : undefined}
          style={
            step.guide
              ? undefined
              : { opacity: 0, animation: `sig-fade ${timeline[i].dur}s ease ${timeline[i].delay}s forwards` }
          }
        >
          {step.paths.map((p, pi) => (
            <path
              key={pi}
              d={p.d}
              fill={p.fill}
              stroke={p.stroke}
              strokeWidth={p.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
      ))}
    </svg>
  )
}
