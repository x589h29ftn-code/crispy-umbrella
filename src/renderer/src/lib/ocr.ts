import { getPdfJsDocument } from './pdfEngine'
import { setOcr, type OcrPageData } from './ocrStore'
import type { SourceFile } from '../types'

const OCR_TARGET_WIDTH = 1600

export function ocrAvailable(): boolean {
  return typeof window.api.ocrRecognize === 'function'
}

/**
 * Renders a page to a PNG, recognizes it in the main process (tesseract.js,
 * Dutch) and stores the result — text for searching plus word positions in
 * content space so exports can carry an invisible, selectable text layer.
 */
export async function ocrPage(source: SourceFile, pageIndex: number, deltaRotation: number): Promise<OcrPageData> {
  const doc = await getPdfJsDocument(source)
  const page = await doc.getPage(pageIndex + 1)
  const totalRotation = (page.rotate + deltaRotation) % 360
  const base = page.getViewport({ scale: 1, rotation: totalRotation })
  const scale = Math.min(4, OCR_TARGET_WIDTH / base.width)
  const viewport = page.getViewport({ scale, rotation: totalRotation })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  await page.render({ canvasContext: ctx, viewport }).promise

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('Kon pagina niet naar afbeelding omzetten')
  const png = new Uint8Array(await blob.arrayBuffer())

  const result = await window.api.ocrRecognize(png)

  const words = result.words
    .filter((word) => word.text.trim().length > 0)
    .map((word) => {
      // Pixel bbox -> visual units -> content space; anchor at the bottom-left.
      const visualX = word.x0 / scale
      const visualBottom = word.y1 / scale
      const [x, y] = base.convertToPdfPoint(visualX, visualBottom)
      const size = Math.max(2, ((word.y1 - word.y0) / scale) * 0.85)
      return { text: word.text.trim(), x, y, size }
    })

  const data: OcrPageData = { text: result.text, words }
  setOcr(source.id, pageIndex, data)
  return data
}
