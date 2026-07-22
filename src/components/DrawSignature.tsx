'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const PEN_COLORS = ['#111827', '#1d4ed8', '#b91c1c']
const W = 620
const H = 200

/**
 * Teken een handtekening met muis/trackpad/touch. Bij elke afgeronde streek
 * wordt de inkt bijgesneden tot een transparante PNG en via onChange gemeld.
 * Geport uit de desktop-app (DrawSignatureDialog) en herschreven zonder store.
 */
export function DrawSignature({
  onChange,
  className
}: {
  onChange: (dataUrl: string | null) => void
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [color, setColor] = useState(PEN_COLORS[0])
  const colorRef = useRef(color)
  colorRef.current = color
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.clearRect(0, 0, W, H)
  }, [])

  function pos(e: React.PointerEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H }
  }

  function down(e: React.PointerEvent) {
    drawing.current = true
    last.current = pos(e)
    canvasRef.current!.setPointerCapture(e.pointerId)
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e)
    ctx.strokeStyle = colorRef.current
    ctx.beginPath()
    ctx.moveTo(last.current!.x, last.current!.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (!dirty) setDirty(true)
  }
  function up() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    emit()
  }

  function clear() {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setDirty(false)
    onChange(null)
  }

  /** Bijsnijden op de niet-transparante pixels; emit als transparante PNG. */
  function emit() {
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
    if (maxX < minX) {
      onChange(null)
      return
    }
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
    onChange(out.toDataURL('image/png'))
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Kleur:</span>
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Kleur ${c}`}
            onClick={() => setColor(c)}
            className={cn('h-6 w-6 rounded-full ring-2 ring-offset-2', color === c ? 'ring-brand-400' : 'ring-transparent')}
            style={{ background: c }}
          />
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="w-full cursor-crosshair touch-none rounded-lg border border-dashed border-slate-300 bg-white"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <button type="button" className="btn-ghost text-sm" onClick={clear} disabled={!dirty}>
        Wissen
      </button>
    </div>
  )
}
