// PDF-tekenhulpfuncties, server-side. Geport uit de desktop-app
// (src/renderer/src/lib/signing.ts) — puur @cantoo/pdf-lib, zonder de
// desktop-specifieke opslag/IPC. Alleen wat het portaal echt nodig heeft.

/** Tekenvak in PDF-punten met pivot linksonder (pdf-lib-conventie). */
export interface SignPlacement {
  page: number
  x: number
  y: number
  width: number
  height: number
}

function b64ToBytes(b64: string): Uint8Array {
  return Buffer.from(b64, 'base64')
}

/**
 * Tekent een handtekening-afbeelding (data-URL: PNG of JPEG) in de PDF op het
 * opgegeven tekenvak (PDF-punten, pivot linksonder). Geeft nieuwe PDF-bytes.
 */
export async function stampSignatureImage(
  pdfBytes: Uint8Array,
  placement: SignPlacement,
  imageDataUrl: string
): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.load(Uint8Array.from(pdfBytes), { ignoreEncryption: true })
  const pages = doc.getPages()
  const page = pages[placement.page] ?? pages[0]
  const isJpg = /^data:image\/jpe?g/i.test(imageDataUrl)
  const bytes = b64ToBytes(imageDataUrl.split(',')[1] ?? '')
  const img = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
  page.drawImage(img, {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height
  })
  return doc.save()
}

/**
 * Rekent een rechthoek op de gerenderde voorbeeld-afbeelding (pixels, pivot
 * linksboven) om naar PDF-punten (pivot linksonder). Geport uit de desktop-app.
 */
export function pixelRectToPlacement(
  rectPx: { left: number; top: number; width: number; height: number },
  preview: { pdfWidth: number; pdfHeight: number; pxWidth: number; pxHeight: number },
  page: number
): SignPlacement {
  const sx = preview.pdfWidth / preview.pxWidth
  const sy = preview.pdfHeight / preview.pxHeight
  return {
    page,
    x: rectPx.left * sx,
    y: preview.pdfHeight - (rectPx.top + rectPx.height) * sy,
    width: rectPx.width * sx,
    height: rectPx.height * sy
  }
}

/** Geeft de afmetingen (PDF-punten) van elke pagina — voor coördinaatomrekening. */
export async function pageSizes(pdfBytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.load(Uint8Array.from(pdfBytes), { ignoreEncryption: true })
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize()
    return { width, height }
  })
}
