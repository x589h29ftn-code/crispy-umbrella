import { useEffect, useMemo, useState } from 'react'
import type { GenerationParams, SignatureStyle } from '../types'
import { ensureFont, getLoadedFont } from '../engine/fontManager'
import { renderSignature } from '../engine/compose'

interface Props {
  style: SignatureStyle
  params: GenerationParams
  text: string
  seed: number
  /** 'solid' = normale weergave; 'dashed' = alleen gestippelde contour (oefenblad). */
  mode?: 'solid' | 'dashed'
  className?: string
}

/** Rendert één handtekening als SVG; laadt het font on-demand met skeleton. */
export function SignaturePreview({ style, params, text, seed, mode = 'solid', className }: Props) {
  const [fontReady, setFontReady] = useState(() => !!getLoadedFont(style.fontId))

  useEffect(() => {
    if (getLoadedFont(style.fontId)) {
      setFontReady(true)
      return
    }
    let live = true
    setFontReady(false)
    ensureFont(style.fontId).then(
      () => live && setFontReady(true),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [style.fontId])

  const render = useMemo(
    () => (fontReady ? renderSignature(style, params, text, seed) : null),
    [fontReady, style, params, text, seed]
  )

  if (!render) return <div className={`sig-skeleton ${className ?? ''}`} aria-hidden="true" />

  const { x, y, w, h } = render.viewBox
  return (
    <svg
      className={className}
      viewBox={`${x} ${y} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Handtekening: ${text}`}
    >
      {render.paths.map((p, i) => {
        const dashed = mode === 'dashed'
        return (
          <path
            key={i}
            d={p.d}
            fill={dashed ? 'none' : p.fill}
            stroke={dashed ? 'currentColor' : p.stroke}
            strokeWidth={dashed ? Math.max(1.2, (p.strokeWidth ?? 1) * 0.8) : p.strokeWidth}
            strokeDasharray={dashed ? '4 3' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}
