import { useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { renderDrawing, type DrawnStroke } from '../engine/draw'
import { downloadPng, downloadSvg, INK, toSvgString } from '../engine/export'

const INKS = [
  { value: INK, label: 'Donker' },
  { value: '#000000', label: 'Zwart' },
  { value: '#1b3a8f', label: 'Pennenblauw' }
]

/** Teken je bestaande handtekening met muis/touch/stylus; de engine schoont
 *  hem op met dezelfde pendynamiek als de generator. */
export function DrawPage() {
  const setPhase = useAppStore((s) => s.setPhase)
  const [strokes, setStrokes] = useState<DrawnStroke[]>([])
  const [penWidth, setPenWidth] = useState(5)
  const [smoothing, setSmoothing] = useState(0.6)
  const [ink, setInk] = useState<string>(INK)
  const active = useRef<DrawnStroke | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [, forceUpdate] = useState(0)

  const toLocal = (e: React.PointerEvent): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    active.current = { pts: [toLocal(e)], times: [e.timeStamp] }
    forceUpdate((n) => n + 1)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!active.current) return
    active.current.pts.push(toLocal(e))
    active.current.times.push(e.timeStamp)
    forceUpdate((n) => n + 1)
  }
  const onUp = () => {
    const finished = active.current
    active.current = null
    if (finished && finished.pts.length > 1) {
      setStrokes((cur) => [...cur, finished])
    }
  }

  const allStrokes = active.current ? [...strokes, active.current] : strokes
  const render = useMemo(
    () => renderDrawing(allStrokes, { penWidth, smoothing }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strokes, penWidth, smoothing, active.current?.pts.length]
  )

  return (
    <div className="draw-page">
      <header className="page-header">
        <button className="btn-ghost" onClick={() => setPhase('landing')}>← Terug</button>
        <div className="page-header-info">
          <h1>Teken je eigen handtekening</h1>
          <p>
            Zet je handtekening in het vak — met muis, vinger of pen. Wij strijken hem glad met
            echte pendynamiek en je downloadt hem als PNG of SVG.
          </p>
        </div>
      </header>

      <div className="draw-area-wrap">
        <svg
          ref={svgRef}
          className="draw-area"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <line x1="6%" y1="72%" x2="94%" y2="72%" className="draw-baseline" />
          {allStrokes.map((s, i) => (
            <polyline
              key={i}
              points={s.pts.map((p) => p.join(',')).join(' ')}
              fill="none"
              stroke="#9a9485"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        <p className="draw-hint">Ruwe invoer in grijs · hieronder het opgeschoonde resultaat</p>
      </div>

      <div className="draw-controls">
        <label className="tune-row">
          <span>Pendikte</span>
          <input type="range" min={2} max={10} step={0.5} value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} />
        </label>
        <label className="tune-row">
          <span>Gladheid</span>
          <input type="range" min={0} max={1} step={0.05} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} />
        </label>
        <div className="tune-row">
          <span>Inktkleur</span>
          <span className="ink-swatches">
            {INKS.map((option) => (
              <button
                key={option.value}
                className={`ink-swatch ${ink === option.value ? 'selected' : ''}`}
                style={{ background: option.value }}
                title={option.label}
                aria-label={`Inktkleur ${option.label}`}
                onClick={() => setInk(option.value)}
              />
            ))}
          </span>
        </div>
        <div className="draw-buttons">
          <button className="btn-small" disabled={!strokes.length} onClick={() => setStrokes((c) => c.slice(0, -1))}>
            ↶ Ongedaan maken
          </button>
          <button className="btn-small btn-danger" disabled={!strokes.length} onClick={() => setStrokes([])}>
            Wissen
          </button>
        </div>
      </div>

      <div className="draw-result">
        <h2>Opgeschoond resultaat</h2>
        {render ? (
          <>
            <div
              className="draw-preview"
              style={{ color: ink }}
              dangerouslySetInnerHTML={{ __html: toSvgString(render, 'currentColor') }}
            />
            <div className="export-bar">
              <button className="btn-small" onClick={() => downloadPng(render, 'handtekening-getekend.png', undefined, ink)}>
                PNG
              </button>
              <button className="btn-small" onClick={() => downloadPng(render, 'handtekening-getekend-wit.png', '#ffffff', ink)}>
                PNG wit
              </button>
              <button className="btn-small" onClick={() => downloadSvg(render, 'handtekening-getekend.svg', ink)}>
                SVG
              </button>
            </div>
          </>
        ) : (
          <p className="draw-empty">Nog niets getekend — zet je handtekening in het vak hierboven.</p>
        )}
      </div>
    </div>
  )
}
