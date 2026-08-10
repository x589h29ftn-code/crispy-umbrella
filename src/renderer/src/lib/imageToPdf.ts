/** Afbeeldingen die we naar een PDF-pagina kunnen omzetten. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] as const

export function isImageFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
}

/** Op een A4-pagina zetten (standaard) of de pagina precies om de foto heen. */
export type ImagePageMode = 'a4' | 'fit'

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 24

/** Decodeert een afbeelding naar PNG-bytes; nodig voor webp/gif/bmp. */
async function toPngBytes(data: Uint8Array, type: string): Promise<Uint8Array> {
  const blob = new Blob([data as unknown as BlobPart], { type })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas niet beschikbaar')
  // Witte ondergrond: doorzichtige PNG's/GIF's worden anders zwart in de PDF.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!out) throw new Error('afbeelding kon niet worden omgezet')
  return new Uint8Array(await out.arrayBuffer())
}

/**
 * Zet één of meer afbeeldingen om in één PDF: elke afbeelding een pagina.
 * Foto's van bonnen, een gescande verklaring of een schermafdruk kunnen zo
 * meteen in een dossier mee.
 */
export async function imagesToPdf(
  files: { name: string; data: Uint8Array }[],
  mode: ImagePageMode = 'a4'
): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    let image
    if (ext === 'png') {
      image = await doc.embedPng(file.data)
    } else if (ext === 'jpg' || ext === 'jpeg') {
      image = await doc.embedJpg(file.data)
    } else {
      image = await doc.embedPng(await toPngBytes(file.data, `image/${ext === 'bmp' ? 'bmp' : ext}`))
    }
    const landscape = image.width > image.height
    if (mode === 'fit') {
      // Pagina exact op de verhouding van de foto, langste zijde als een A4.
      const longest = A4.height
      const scale = longest / Math.max(image.width, image.height)
      const page = doc.addPage([image.width * scale, image.height * scale])
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
    } else {
      const size: [number, number] = landscape ? [A4.height, A4.width] : [A4.width, A4.height]
      const page = doc.addPage(size)
      const room = { width: size[0] - MARGIN * 2, height: size[1] - MARGIN * 2 }
      const scale = Math.min(room.width / image.width, room.height / image.height)
      const width = image.width * scale
      const height = image.height * scale
      page.drawImage(image, {
        x: (size[0] - width) / 2,
        y: (size[1] - height) / 2,
        width,
        height
      })
    }
  }
  return doc.save()
}
