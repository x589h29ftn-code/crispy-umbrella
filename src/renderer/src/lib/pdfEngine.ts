import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, degrees } from 'pdf-lib'
import type { DocGroup, PageRef, SourceFile } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PdfJsDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>

const jsDocCache = new Map<string, Promise<PdfJsDoc>>()
const libDocCache = new Map<string, Promise<PDFDocument>>()
const thumbCache = new Map<string, string>()

function cloneBytes(data: Uint8Array): Uint8Array {
  // pdf.js detaches/transfers the buffer it's given, so every consumer needs its own copy.
  return data.slice()
}

export function getPdfJsDocument(source: SourceFile): Promise<PdfJsDoc> {
  let cached = jsDocCache.get(source.id)
  if (!cached) {
    cached = pdfjsLib.getDocument({ data: cloneBytes(source.data) }).promise
    jsDocCache.set(source.id, cached)
  }
  return cached
}

export function getPdfLibDocument(source: SourceFile): Promise<PDFDocument> {
  let cached = libDocCache.get(source.id)
  if (!cached) {
    cached = PDFDocument.load(cloneBytes(source.data))
    libDocCache.set(source.id, cached)
  }
  return cached
}

export function forgetSource(sourceId: string): void {
  jsDocCache.delete(sourceId)
  libDocCache.delete(sourceId)
  for (const key of thumbCache.keys()) {
    if (key.startsWith(`${sourceId}::`)) thumbCache.delete(key)
  }
}

export async function loadSourceFile(name: string, data: Uint8Array, id: string): Promise<SourceFile> {
  const doc = await pdfjsLib.getDocument({ data: cloneBytes(data) }).promise
  const source: SourceFile = { id, name, data, pageCount: doc.numPages }
  jsDocCache.set(id, Promise.resolve(doc))
  return source
}

export async function renderThumbnail(
  source: SourceFile,
  pageIndex: number,
  rotation: number,
  targetWidth: number
): Promise<string> {
  const cacheKey = `${source.id}::${pageIndex}::${rotation}::${targetWidth}`
  const cached = thumbCache.get(cacheKey)
  if (cached) return cached

  const doc = await getPdfJsDocument(source)
  const page = await doc.getPage(pageIndex + 1)
  const baseViewport = page.getViewport({ scale: 1, rotation })
  const scale = targetWidth / baseViewport.width
  const viewport = page.getViewport({ scale, rotation })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  await page.render({ canvasContext: ctx, viewport }).promise
  const dataUrl = canvas.toDataURL('image/png')
  thumbCache.set(cacheKey, dataUrl)
  return dataUrl
}

async function buildPdf(source: { pages: PageRef[] }, sources: Map<string, SourceFile>): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const byDoc = new Map<string, number[]>()
  const order: { sourceId: string; localIndex: number; page: PageRef }[] = []

  source.pages.forEach((page) => {
    const list = byDoc.get(page.sourceId) ?? []
    list.push(page.sourcePageIndex)
    byDoc.set(page.sourceId, list)
    order.push({ sourceId: page.sourceId, localIndex: list.length - 1, page })
  })

  const copiedByDoc = new Map<string, Awaited<ReturnType<PDFDocument['copyPages']>>>()
  for (const [sourceId, indices] of byDoc) {
    const src = sources.get(sourceId)
    if (!src) continue
    const libDoc = await getPdfLibDocument(src)
    const copied = await out.copyPages(libDoc, indices)
    copiedByDoc.set(sourceId, copied)
  }

  for (const { sourceId, localIndex, page } of order) {
    const copied = copiedByDoc.get(sourceId)
    if (!copied) continue
    const copiedPage = copied[localIndex]
    const totalRotation = (copiedPage.getRotation().angle + page.rotation) % 360
    copiedPage.setRotation(degrees(totalRotation))
    out.addPage(copiedPage)
  }

  return out.save()
}

export async function exportGroupToPdf(group: DocGroup, sources: Map<string, SourceFile>): Promise<Uint8Array> {
  return buildPdf(group, sources)
}

export async function exportAllToZip(
  groups: DocGroup[],
  sources: Map<string, SourceFile>
): Promise<Uint8Array> {
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()

  for (const group of groups) {
    if (!group.pages.length) continue
    const bytes = await buildPdf(group, sources)
    let fileName = `${sanitizeFileName(group.name)}.pdf`
    let n = 2
    while (usedNames.has(fileName)) {
      fileName = `${sanitizeFileName(group.name)} (${n}).pdf`
      n += 1
    }
    usedNames.add(fileName)
    files[fileName] = bytes
  }

  return zipSync(files, { level: 6 })
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
}
