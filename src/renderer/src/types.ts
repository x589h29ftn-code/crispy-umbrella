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

export type AnnotationFont = 'helvetica' | 'times' | 'courier'

export interface HighlightAnnotation {
  id: string
  type: 'highlight'
  /** PDF points, unrotated media-box space, bottom-left origin (same convention as signatures). */
  x: number
  y: number
  width: number
  height: number
  color: string
  opacity: number
}

export interface TextAnnotation {
  id: string
  type: 'text'
  x: number
  y: number
  text: string
  font: AnnotationFont
  size: number
  bold: boolean
  italic: boolean
  color: string
}

export type Annotation = HighlightAnnotation | TextAnnotation

export interface PageRef {
  id: string
  sourceId: string
  sourcePageIndex: number
  rotation: 0 | 90 | 180 | 270
  signatures: SignaturePlacement[]
  annotations: Annotation[]
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
  id: string
  name: string
  dataUrl: string
  mimeType: 'image/png' | 'image/jpeg'
  naturalWidth: number
  naturalHeight: number
}

export interface DropTarget {
  groupId: string
  index: number
}
