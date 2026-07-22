'use client'

import { useEffect, useRef, useState } from 'react'

const FONTS = [
  { label: 'Sierlijk', css: '44px "Segoe Script", "Brush Script MT", "Comic Sans MS", cursive' },
  { label: 'Klassiek', css: 'italic 40px "Georgia", "Times New Roman", serif' },
  { label: 'Modern', css: '40px "Segoe UI", system-ui, sans-serif' }
]

/** Typt een naam en rendert die als handtekening-afbeelding (transparante PNG). */
export function TypeSignature({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const [text, setText] = useState('')
  const [fontIdx, setFontIdx] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const w = 520
    const h = 120
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!text.trim()) {
      onChange(null)
      return
    }
    ctx.fillStyle = '#111827'
    ctx.font = FONTS[fontIdx].css
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 12, h / 2, w - 24)
    onChange(canvas.toDataURL('image/png'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fontIdx])

  return (
    <div className="space-y-3">
      <input
        className="input"
        placeholder="Typ uw volledige naam"
        value={text}
        maxLength={60}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        {FONTS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFontIdx(i)}
            className={i === fontIdx ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
          >
            {f.label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-dashed border-slate-300 bg-white"
        style={{ aspectRatio: '520 / 120' }}
      />
    </div>
  )
}
