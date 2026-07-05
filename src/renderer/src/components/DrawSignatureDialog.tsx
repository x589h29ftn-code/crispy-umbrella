import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import { IconClose } from './icons'

const PEN_COLORS = ['#111827', '#1d4ed8', '#b91c1c']

/**
 * Teken een handtekening met de muis/trackpad; bij opslaan wordt hij als
 * transparante PNG een handtekening-asset (bijgesneden op de inkt).
 */
export default function DrawSignatureDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.drawSignatureOpen)
  const setOpen = useStudioStore((s) => s.setDrawSignatureOpen)
  const addSignatureAsset = useStudioStore((s) => s.addSignatureAsset)
  const setActiveSignature = useStudioStore((s) => s.setActiveSignature)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const [color, setColor] = useState(PEN_COLORS[0])
  const [dirty, setDirty] = useState(false)
  const colorRef = useRef(color)
  colorRef.current = color

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = 620 * dpr
    canvas.height = 220 * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.clearRect(0, 0, 620, 220)
    setDirty(false)
  }, [open])

  if (!open) return null

  function pos(e: React.PointerEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * 620, y: ((e.clientY - rect.top) / rect.height) * 220 }
  }

  function down(e: React.PointerEvent): void {
    drawingRef.current = true
    lastRef.current = pos(e)
    canvasRef.current!.setPointerCapture(e.pointerId)
  }
  function move(e: React.PointerEvent): void {
    if (!drawingRef.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e)
    ctx.strokeStyle = colorRef.current
    ctx.beginPath()
    ctx.moveTo(lastRef.current!.x, lastRef.current!.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
    if (!dirty) setDirty(true)
  }
  function up(): void {
    drawingRef.current = false
    lastRef.current = null
  }

  function clear(): void {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setDirty(false)
  }

  /** Bijsnijden op de niet-transparante pixels en als PNG-asset opslaan. */
  function save(): void {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < minX) return
    const pad = 8
    minX = Math.max(0, minX - pad)
    minY = Math.max(0, minY - pad)
    maxX = Math.min(width - 1, maxX + pad)
    maxY = Math.min(height - 1, maxY + pad)
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h)
    const dataUrl = out.toDataURL('image/png')
    const id = nanoid()
    addSignatureAsset({
      id,
      name: 'Getekende handtekening',
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: w,
      naturalHeight: h
    })
    setActiveSignature(id)
    setOpen(false)
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card draw-signature-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn icon-btn--chrome draw-signature-card__close" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
        <h3>Handtekening tekenen</h3>
        <div className="draw-signature-card__swatches">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`editbar__swatch${color === c ? ' editbar__swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <canvas
          ref={canvasRef}
          className="draw-signature-card__canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        <div className="modal-card__actions">
          <button type="button" className="pill-btn" onClick={clear}>
            Wissen
          </button>
          <button type="button" className="pill-btn pill-btn--primary" disabled={!dirty} onClick={save}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  )
}
