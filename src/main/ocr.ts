import { app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { createWorker, type Worker } from 'tesseract.js'

/**
 * OCR runs in the main process (plain Node): tesseract.js reads its language
 * data straight from disk here, which sidesteps every file://-fetch and
 * bundler complication a renderer-side worker would hit, and keeps the heavy
 * recognition work off the UI thread.
 */

export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  confidence: number
}

export interface OcrPageResult {
  text: string
  words: OcrWord[]
}

function langDir(): string {
  // Dutch traineddata ships with the app (electron-builder extraResources);
  // in dev it is read directly from node_modules.
  return is.dev || !app.isPackaged
    ? join(app.getAppPath(), 'node_modules/@tesseract.js-data/nld/4.0.0_best_int')
    : join(process.resourcesPath, 'tessdata')
}

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('nld', 1, {
      langPath: langDir(),
      gzip: true,
      cacheMethod: 'none'
    })
  }
  return workerPromise
}

export async function recognizePng(png: Uint8Array): Promise<OcrPageResult> {
  const worker = await getWorker()
  const { data } = await worker.recognize(Buffer.from(png), {}, { text: true, blocks: true })
  const words: OcrWord[] = (data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)
    .filter((word) => word.text.trim().length > 0)
    .map((word) => ({
      text: word.text,
      x0: word.bbox.x0,
      y0: word.bbox.y0,
      x1: word.bbox.x1,
      y1: word.bbox.y1,
      confidence: word.confidence
    }))
  return { text: data.text ?? '', words }
}

export async function disposeOcrWorker(): Promise<void> {
  if (!workerPromise) return
  const worker = await workerPromise.catch(() => null)
  workerPromise = null
  await worker?.terminate().catch(() => undefined)
}
