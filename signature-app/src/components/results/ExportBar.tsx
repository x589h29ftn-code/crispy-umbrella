import { useState } from 'react'
import type { GeneratedSignature, GenerationParams, SignatureStyle } from '../../types'
import { renderSignature } from '../../engine/compose'
import { ensureStyleAssets } from '../../engine/fontManager'
import {
  clipboardSupported,
  copyPng,
  downloadPng,
  downloadSvg,
  INK,
  safeFilename
} from '../../engine/export'

interface Props {
  signature: GeneratedSignature
  style: SignatureStyle
  params: GenerationParams
  onPractice: () => void
  onRemove: () => void
}

export function ExportBar({ signature, style, params, onPractice, onRemove }: Props) {
  const [copied, setCopied] = useState(false)
  const ink = signature.ink ?? INK

  const withRender = async (fn: (render: NonNullable<ReturnType<typeof renderSignature>>) => void | Promise<void>) => {
    await ensureStyleAssets(style)
    const render = renderSignature(style, params, signature.text, signature.seed)
    if (render) await fn(render)
  }

  return (
    <div className="export-bar">
      <button
        className="btn-small"
        title="PNG met transparante achtergrond (voor e-handtekening)"
        onClick={() => withRender((r) => downloadPng(r, safeFilename(signature.text, '.png'), undefined, ink))}
      >
        PNG
      </button>
      <button
        className="btn-small"
        title="PNG met witte achtergrond"
        onClick={() =>
          withRender((r) => downloadPng(r, safeFilename(signature.text, '-wit.png'), '#ffffff', ink))
        }
      >
        PNG wit
      </button>
      <button
        className="btn-small"
        title="SVG (vector, oneindig schaalbaar)"
        onClick={() => withRender((r) => downloadSvg(r, safeFilename(signature.text, '.svg'), ink))}
      >
        SVG
      </button>
      {clipboardSupported() && (
        <button
          className="btn-small"
          title="Kopieer naar klembord"
          onClick={() =>
            withRender(async (r) => {
              await copyPng(r, ink)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
          }
        >
          {copied ? 'Gekopieerd ✓' : 'Kopiëren'}
        </button>
      )}
      <button className="btn-small btn-accent" title="Printbaar oefenblad om je handtekening te leren" onClick={onPractice}>
        Oefenblad
      </button>
      <button className="btn-small btn-danger" title="Verwijderen uit selectie" onClick={onRemove}>
        Verwijderen
      </button>
    </div>
  )
}
