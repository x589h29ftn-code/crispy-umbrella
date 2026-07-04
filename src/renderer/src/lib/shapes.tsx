import type { ShapeKind } from '../types'

export interface Point {
  x: number
  y: number
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  arrow: 'Pijl',
  line: 'Lijn',
  rect: 'Rechthoek',
  ellipse: 'Ovaal'
}

export interface StampPreset {
  key: string
  label: string
  color: string
}

export const STAMP_PRESETS: StampPreset[] = [
  { key: 'akkoord', label: 'AKKOORD', color: '#15803d' },
  { key: 'concept', label: 'CONCEPT', color: '#64748b' },
  { key: 'betaald', label: 'BETAALD', color: '#1d4ed8' },
  { key: 'kopie', label: 'KOPIE', color: '#b91c1c' }
]

/** Sub line under a stamp: today's date, plus the configured name when set. */
export function buildStampSub(authorName: string): string {
  const d = new Date()
  const date = `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`
  const name = authorName.trim()
  return name ? `${date} · ${name}` : date
}

/** Length of the two arrow-head strokes for a given line width. */
export function arrowHeadLength(strokeWidth: number): number {
  return Math.max(9, strokeWidth * 3.5)
}

/** The two arrow-head endpoints for a line ending in `to` (works in both y-up and y-down frames). */
export function arrowHeadPoints(from: Point, to: Point, strokeWidth: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const head = arrowHeadLength(strokeWidth)
  const spread = (Math.PI * 5) / 6
  return [
    { x: to.x + Math.cos(angle + spread) * head, y: to.y + Math.sin(angle + spread) * head },
    { x: to.x + Math.cos(angle - spread) * head, y: to.y + Math.sin(angle - spread) * head }
  ]
}

/** Small toolbar icon showing what the shape kind looks like. */
export function ShapePreviewIcon({ kind, size = 15 }: { kind: ShapeKind; size?: number }): JSX.Element {
  const s = { stroke: 'currentColor', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {kind === 'arrow' && (
        <>
          <line x1={3} y1={13} x2={13} y2={3} {...s} />
          <polyline points="8,3 13,3 13,8" {...s} strokeLinejoin="round" />
        </>
      )}
      {kind === 'line' && <line x1={3} y1={13} x2={13} y2={3} {...s} />}
      {kind === 'rect' && <rect x={2.5} y={4} width={11} height={8} rx={1} {...s} strokeLinejoin="round" />}
      {kind === 'ellipse' && <ellipse cx={8} cy={8} rx={5.5} ry={4} {...s} />}
    </svg>
  )
}

/**
 * Visible SVG geometry of a shape between two (visual-space) points.
 * Shared by the lightbox, the tabbed editor and the page thumbnails.
 */
export function ShapeGeometry({
  shape,
  p1,
  p2,
  color,
  strokeWidth
}: {
  shape: ShapeKind
  p1: Point
  p2: Point
  color: string
  strokeWidth: number
}): JSX.Element {
  const stroke = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, fill: 'none' }
  if (shape === 'rect') {
    return (
      <rect
        x={Math.min(p1.x, p2.x)}
        y={Math.min(p1.y, p2.y)}
        width={Math.abs(p2.x - p1.x)}
        height={Math.abs(p2.y - p1.y)}
        {...stroke}
        strokeLinejoin="round"
      />
    )
  }
  if (shape === 'ellipse') {
    return (
      <ellipse
        cx={(p1.x + p2.x) / 2}
        cy={(p1.y + p2.y) / 2}
        rx={Math.abs(p2.x - p1.x) / 2}
        ry={Math.abs(p2.y - p1.y) / 2}
        {...stroke}
      />
    )
  }
  const head = shape === 'arrow' ? arrowHeadPoints(p1, p2, strokeWidth) : null
  return (
    <>
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} {...stroke} />
      {head && (
        <>
          <line x1={p2.x} y1={p2.y} x2={head[0].x} y2={head[0].y} {...stroke} />
          <line x1={p2.x} y1={p2.y} x2={head[1].x} y2={head[1].y} {...stroke} />
        </>
      )}
    </>
  )
}
