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

export type AnnotationFont = 'arial' | 'opensans' | 'helvetica' | 'times' | 'courier'

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
  /** fill = marker (default); underline/strike are thin bars over the same box. */
  style?: 'fill' | 'underline' | 'strike'
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

export interface InkAnnotation {
  id: string
  type: 'ink'
  /** Freehand stroke, PDF points in unrotated media-box space (rotation-invariant). */
  points: { x: number; y: number }[]
  color: string
  /** Stroke width in PDF points. */
  strokeWidth: number
}

export interface RedactAnnotation {
  id: string
  type: 'redact'
  /** Same bottom-left-pivot convention as highlights. */
  x: number
  y: number
  width: number
  height: number
  /** 'black' = redaction bar; 'white' = cover box behind in-place text edits. */
  fill: 'black' | 'white'
}

export type Annotation = HighlightAnnotation | TextAnnotation | InkAnnotation | RedactAnnotation

export interface CommentReply {
  id: string
  text: string
  /** Epoch ms. */
  createdAt: number
}

export interface PageComment {
  id: string
  /** Anchor in PDF points, unrotated media-box space (like annotations). */
  x: number
  y: number
  text: string
  createdAt: number
  resolved: boolean
  replies: CommentReply[]
}

export interface PageRef {
  id: string
  sourceId: string
  sourcePageIndex: number
  rotation: 0 | 90 | 180 | 270
  signatures: SignaturePlacement[]
  annotations: Annotation[]
  comments: PageComment[]
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
