export interface SourceFile {
  id: string
  name: string
  data: Uint8Array
  pageCount: number
}

export interface SignaturePlacement {
  id: string
  imageDataUrl: string
  /** PDF points, unrotated media-box space, bottom-left origin (pdf-lib convention). */
  x: number
  y: number
  width: number
  height: number
}

export interface PageRef {
  id: string
  sourceId: string
  sourcePageIndex: number
  rotation: 0 | 90 | 180 | 270
  signatures: SignaturePlacement[]
}

export interface Watermark {
  text: string
  opacity: number
}

export interface DocGroup {
  id: string
  name: string
  pages: PageRef[]
  watermark: Watermark | null
  pageNumbers: boolean
  /** ISO date (yyyy-mm-dd); written as the PDF's creation & modification date on export. */
  documentDate: string | null
}

export interface SignatureAsset {
  dataUrl: string
  mimeType: 'image/png' | 'image/jpeg'
  naturalWidth: number
  naturalHeight: number
}

export interface DropTarget {
  groupId: string
  index: number
}
