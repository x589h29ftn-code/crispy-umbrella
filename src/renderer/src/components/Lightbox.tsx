import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getPageVisualSize,
  getSignatureVisualBox,
  renderThumbnail,
  visualPointToContentPoint,
  visualRectToSignaturePlacement,
  type SignatureVisualBox
} from '../lib/pdfEngine'
import { useStudioStore } from '../store'
import type { SignaturePlacement } from '../types'
import { IconChevronLeft, IconChevronRight, IconClose, IconRotate } from './icons'
import LightboxFilmstrip from './LightboxFilmstrip'

const DEFAULT_SIGNATURE_WIDTH_PCT = 0.28

export default function Lightbox(): JSX.Element | null {
  const lightbox = useStudioStore((s) => s.lightbox)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const closeLightbox = useStudioStore((s) => s.closeLightbox)
  const stepLightbox = useStudioStore((s) => s.stepLightbox)
  const rotatePage = useStudioStore((s) => s.rotatePage)
  const signatureAsset = useStudioStore((s) => s.signatureAsset)
  const addSignaturePlacement = useStudioStore((s) => s.addSignaturePlacement)
  const updateSignaturePlacement = useStudioStore((s) => s.updateSignaturePlacement)
  const removeSignaturePlacement = useStudioStore((s) => s.removeSignaturePlacement)
  const [image, setImage] = useState<string | null>(null)
  const [boxes, setBoxes] = useState<Record<string, SignatureVisualBox>>({})
  const [pageVisualSize, setPageVisualSize] = useState<{ width: number; height: number } | null>(null)
  const stageImgRef = useRef<HTMLImageElement>(null)

  const context = useMemo(() => {
    if (!lightbox.pageId) return null
    for (const group of groups) {
      const idx = group.pages.findIndex((p) => p.id === lightbox.pageId)
      if (idx !== -1) return { group, page: group.pages[idx], indexInGroup: idx }
    }
    return null
  }, [lightbox.pageId, groups])

  const flatPosition = useMemo(() => {
    if (!lightbox.pageId) return null
    const flat = groups.flatMap((g) => g.pages)
    const idx = flat.findIndex((p) => p.id === lightbox.pageId)
    return idx === -1 ? null : { idx, total: flat.length }
  }, [lightbox.pageId, groups])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowRight') stepLightbox(1)
      if (e.key === 'ArrowLeft') stepLightbox(-1)
    }
    if (lightbox.open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox.open, closeLightbox, stepLightbox])

  useEffect(() => {
    let cancelled = false
    if (!context) {
      setImage(null)
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    const targetWidth = Math.round(Math.min(window.innerWidth * 0.8, 1400) * (window.devicePixelRatio || 1))
    renderThumbnail(source, context.page.sourcePageIndex, context.page.rotation, targetWidth).then((url) => {
      if (!cancelled) setImage(url)
    })
    getPageVisualSize(source, context.page.sourcePageIndex, context.page.rotation).then((size) => {
      if (!cancelled) setPageVisualSize(size)
    })
    return () => {
      cancelled = true
    }
  }, [context, sources])

  useEffect(() => {
    let cancelled = false
    if (!context) {
      setBoxes({})
      return
    }
    const source = sources.get(context.page.sourceId)
    if (!source) return
    Promise.all(
      context.page.signatures.map(async (s) => [
        s.id,
        await getSignatureVisualBox(source, context.page.sourcePageIndex, context.page.rotation, s)
      ] as const)
    ).then((entries) => {
      if (!cancelled) setBoxes(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [context, sources])

  if (!lightbox.open || !context) return null

  const source = sources.get(context.page.sourceId)
  const cssScale =
    pageVisualSize && stageImgRef.current ? stageImgRef.current.clientWidth / pageVisualSize.width : 1

  async function handleTrayDrop(e: React.DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    if (!signatureAsset || !source || !context || !stageImgRef.current || !pageVisualSize) return
    const rect = stageImgRef.current.getBoundingClientRect()
    const dropVisualX = (e.clientX - rect.left) / cssScale
    const dropVisualY = (e.clientY - rect.top) / cssScale
    const wPct = DEFAULT_SIGNATURE_WIDTH_PCT
    const aspect = signatureAsset.naturalHeight / signatureAsset.naturalWidth
    const hPct = (wPct * pageVisualSize.width * aspect) / pageVisualSize.height
    const xPct = dropVisualX / pageVisualSize.width - wPct / 2
    const yPct = dropVisualY / pageVisualSize.height - hPct / 2

    const placement = await visualRectToSignaturePlacement(
      source,
      context.page.sourcePageIndex,
      context.page.rotation,
      { xPct, yPct, wPct, hPct },
      signatureAsset.dataUrl
    )
    addSignaturePlacement(context.page.id, placement)
  }

  function startDrag(e: React.PointerEvent, placement: SignaturePlacement): void {
    e.preventDefault()
    e.stopPropagation()
    if (!source || !context) return
    const pageId = context.page.id
    const sourcePageIndex = context.page.sourcePageIndex
    const deltaRotation = context.page.rotation
    const startClientX = e.clientX
    const startClientY = e.clientY
    const box = boxes[placement.id]
    if (!box) return
    const startPivotVisualX = box.pivotX
    const startPivotVisualY = box.pivotY

    function onMove(ev: PointerEvent): void {
      const dx = (ev.clientX - startClientX) / cssScale
      const dy = (ev.clientY - startClientY) / cssScale
      void visualPointToContentPoint(
        source!,
        sourcePageIndex,
        deltaRotation,
        startPivotVisualX + dx,
        startPivotVisualY + dy
      ).then(({ x, y }) => updateSignaturePlacement(pageId, placement.id, { x, y }))
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function startResize(e: React.PointerEvent, placement: SignaturePlacement, box: SignatureVisualBox): void {
    e.preventDefault()
    e.stopPropagation()
    if (!context) return
    const pageId = context.page.id
    const startClientX = e.clientX
    const startClientY = e.clientY
    const theta = (box.rotateDeg * Math.PI) / 180
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    const startWidth = placement.width
    const startHeight = placement.height

    function onMove(ev: PointerEvent): void {
      const dxScreen = (ev.clientX - startClientX) / cssScale
      const dyScreen = (ev.clientY - startClientY) / cssScale
      const dxLocal = cosT * dxScreen + sinT * dyScreen
      const dyLocal = -sinT * dxScreen + cosT * dyScreen
      const width = Math.max(20, startWidth + dxLocal)
      const height = Math.max(20, startHeight + dyLocal)
      updateSignaturePlacement(pageId, placement.id, { width, height })
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="lightbox" onClick={closeLightbox}>
      <div className="lightbox__topbar" onClick={(e) => e.stopPropagation()}>
        <span>{context.group.name}</span>
        {flatPosition && (
          <span className="lightbox__count">
            {flatPosition.idx + 1} / {flatPosition.total}
          </span>
        )}
        <div className="lightbox__spacer" />
        {signatureAsset && (
          <div className="lightbox__tray" title="Sleep naar de pagina om te plaatsen">
            <img
              src={signatureAsset.dataUrl}
              alt="Handtekening"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', 'signature')}
            />
            <span>Sleep om te plaatsen</span>
          </div>
        )}
        <button type="button" className="icon-btn" onClick={() => rotatePage(context.page.id)} title="Roteer">
          <IconRotate size={14} />
        </button>
        <button type="button" className="icon-btn" onClick={closeLightbox} title="Sluiten (Esc)">
          <IconClose size={14} />
        </button>
      </div>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--prev"
        disabled={!flatPosition || flatPosition.idx === 0}
        onClick={(e) => {
          e.stopPropagation()
          stepLightbox(-1)
        }}
        aria-label="Vorige pagina"
      >
        <IconChevronLeft size={22} />
      </button>

      <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {image ? (
          <div
            key={context.page.id}
            className="lightbox__page-wrap lightbox__page-wrap--enter"
            onDragOver={(e) => {
              if (signatureAsset) e.preventDefault()
            }}
            onDrop={(e) => void handleTrayDrop(e)}
          >
            <img ref={stageImgRef} src={image} alt={context.group.name} draggable={false} />
            {context.page.signatures.map((placement) => {
              const box = boxes[placement.id]
              if (!box) return null
              return (
                <div
                  key={placement.id}
                  className="signature-overlay"
                  style={{
                    left: box.pivotX * cssScale,
                    top: (box.pivotY - box.height) * cssScale,
                    width: box.width * cssScale,
                    height: box.height * cssScale,
                    transform: `rotate(${box.rotateDeg}deg)`
                  }}
                  onPointerDown={(e) => startDrag(e, placement)}
                >
                  <img src={placement.imageDataUrl} alt="Handtekening" draggable={false} />
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger signature-overlay__remove"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSignaturePlacement(context.page.id, placement.id)
                    }}
                  >
                    <IconClose size={11} />
                  </button>
                  <div
                    className="signature-overlay__resize"
                    onPointerDown={(e) => startResize(e, placement, box)}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="lightbox__loading" />
        )}
      </div>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--next"
        disabled={!flatPosition || flatPosition.idx === flatPosition.total - 1}
        onClick={(e) => {
          e.stopPropagation()
          stepLightbox(1)
        }}
        aria-label="Volgende pagina"
      >
        <IconChevronRight size={22} />
      </button>

      <LightboxFilmstrip />
    </div>
  )
}
