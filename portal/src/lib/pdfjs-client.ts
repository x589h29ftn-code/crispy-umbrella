'use client'

// Client-side pdf.js-helper. De worker wordt same-origin geladen (public/),
// zodat de strikte CSP (worker-src 'self') hem toestaat.
import * as pdfjsLib from 'pdfjs-dist'

let configured = false
function ensureWorker() {
  if (configured) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  configured = true
}

export interface LoadedPdf {
  numPages: number
  getPage: (n: number) => Promise<pdfjsLib.PDFPageProxy>
}

export async function loadPdf(data: ArrayBuffer): Promise<LoadedPdf> {
  ensureWorker()
  const doc = await pdfjsLib.getDocument({ data }).promise
  return {
    numPages: doc.numPages,
    getPage: (n: number) => doc.getPage(n)
  }
}

/** Rendert een pagina op een canvas bij de gegeven schaal. Geeft de afmetingen. */
export async function renderPage(
  page: pdfjsLib.PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<{ pxWidth: number; pxHeight: number; pdfWidth: number; pdfHeight: number }> {
  const viewport = page.getViewport({ scale })
  const base = page.getViewport({ scale: 1 })
  const ctx = canvas.getContext('2d')!
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return {
    pxWidth: canvas.width,
    pxHeight: canvas.height,
    pdfWidth: base.width,
    pdfHeight: base.height
  }
}
