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

export type ShapeKind = 'arrow' | 'line' | 'rect' | 'ellipse'

export interface ShapeAnnotation {
  id: string
  type: 'shape'
  shape: ShapeKind
  /** Start- and endpoint (2 points) in content space, like ink strokes. */
  points: { x: number; y: number }[]
  color: string
  /** Stroke width in PDF points. */
  strokeWidth: number
}

export interface StampAnnotation {
  id: string
  type: 'stamp'
  /** Same bottom-left-pivot convention as highlights. */
  x: number
  y: number
  width: number
  height: number
  /** Main text, e.g. AKKOORD / CONCEPT / BETAALD / KOPIE. */
  label: string
  /** Sub line, e.g. date + name. */
  sub: string
  color: string
}

export type Annotation =
  | HighlightAnnotation
  | TextAnnotation
  | InkAnnotation
  | RedactAnnotation
  | ShapeAnnotation
  | StampAnnotation

export interface CommentReply {
  id: string
  text: string
  /** Epoch ms. */
  createdAt: number
  author?: string
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
  author?: string
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
