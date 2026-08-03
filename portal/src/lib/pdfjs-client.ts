'use client'

// Client-side pdf.js-helper. De worker wordt same-origin geladen (public/),
// zodat de strikte CSP (worker-src 'self') hem toestaat.
//
// pdfjs wordt LAZY geladen, binnen de functies, en niet met een statische import
// op moduleniveau. De reden is de ontwikkelserver.
//
// Next rendert clientcomponenten ook op de server. Met `import * as pdfjsLib
// from 'pdfjs-dist'` bovenaan wordt die module dus ook in Node uitgevoerd, en de
// ESM-hoofdingang van pdfjs-dist 4 is daar niet bruikbaar ("Please use the
// legacy build in Node.js environments"). Onder `next dev` levert dat geen nette
// fout op maar een module zonder bruikbare export: de importerende component
// wordt `undefined` en React meldt alleen "Element type is invalid". Alle drie de
// schermen met een documentvoorbeeld geven dan een 500 — velden plaatsen,
// ondertekenen door de cliënt, en ondertekenen vanuit kantoor.
//
// EERLIJK OVER DE OMVANG: in een schone productiebuild (`next build` +
// `next start`) deed de statische import het wél goed; daar bundelt webpack het
// anders. Dit was dus geen productiefout maar een ontwikkelfout — en die is net
// zo hinderlijk, want het zijn precies de schermen waar je aan werkt. Met een
// dynamische import werkt het in beide modi, en dat is één gedrag minder om te
// onthouden.
//
// `import type` hieronder verdwijnt bij het compileren en kost dus niets.

import type * as PdfjsNS from 'pdfjs-dist'

/** Eén keer laden en de worker instellen; daarna dezelfde belofte hergebruiken. */
let pdfjsPromise: Promise<typeof PdfjsNS> | null = null

function pdfjs(): Promise<typeof PdfjsNS> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      return mod
    })
  }
  return pdfjsPromise
}

export interface LoadedPdf {
  numPages: number
  getPage: (n: number) => Promise<PdfjsNS.PDFPageProxy>
}

export async function loadPdf(data: ArrayBuffer): Promise<LoadedPdf> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data }).promise
  return {
    numPages: doc.numPages,
    getPage: (n: number) => doc.getPage(n)
  }
}

/** Rendert een pagina op een canvas bij de gegeven schaal. Geeft de afmetingen. */
export async function renderPage(
  page: PdfjsNS.PDFPageProxy,
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
