import { useEffect, useMemo, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStudioStore } from '../store'
import { usePanZoom } from '../hooks/usePanZoom'
import { mergeRefs } from '../lib/mergeRefs'
import GroupRow from './GroupRow'
import AddTile from './AddTile'
import EmptyState from './EmptyState'

interface Props {
  onScaleChange: (scale: number) => void
  registerZoomControls: (controls: { zoomBy: (f: number) => void; zoomTo: (s: number) => void }) => void
}

export default function Canvas({ onScaleChange, registerZoomControls }: Props): JSX.Element {
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const importFiles = useStudioStore((s) => s.importFiles)
  const canvasDropActive = useStudioStore((s) => s.dropTarget?.type === 'canvas')
  const [scalePct, setScalePct] = useState(100)

  const handleScaleChange = useMemo(
    () => (scale: number) => {
      setScalePct(Math.round(scale * 100))
      useStudioStore.getState().setCanvasScale(scale)
      onScaleChange(scale)
    },
    [onScaleChange]
  )

  const { viewportRef, contentRef, zoomBy, zoomTo } = usePanZoom(handleScaleChange)
  const [animateRef] = useAutoAnimate<HTMLDivElement>({ duration: 180, easing: 'ease-out' })
  const contentNodeRef = useMemo(() => mergeRefs(contentRef, animateRef), [contentRef, animateRef])

  useEffect(() => {
    registerZoomControls({ zoomBy, zoomTo })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pickAndAddDocuments(): Promise<void> {
    const files = await window.api.openPdfs()
    if (files.length) await importFiles(files)
  }

  async function addDroppedDocuments(fileList: FileList): Promise<void> {
    const files = await Promise.all(
      Array.from(fileList)
        .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
        .map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))
    )
    if (files.length) await importFiles(files)
  }

  return (
    <div
      className={`canvas-viewport${canvasDropActive ? ' canvas-viewport--drop' : ''}`}
      ref={viewportRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        void addDroppedDocuments(e.dataTransfer.files)
      }}
    >
      <div className="canvas-content" ref={contentNodeRef}>
        {groups.map((group, i) => (
          <GroupRow
            key={group.id}
            group={group}
            index={i}
            isLast={i === groups.length - 1}
            sources={sources}
            isActive={group.id === activeGroupId}
          />
        ))}
        {groups.length > 0 && (
          <AddTile
            label="Document toevoegen"
            compact
            onClick={() => void pickAndAddDocuments()}
            onFilesDropped={addDroppedDocuments}
          />
        )}
      </div>

      {groups.length === 0 && (
        <EmptyState onBrowse={() => void pickAndAddDocuments()} onFilesDropped={addDroppedDocuments} />
      )}

      {Math.abs(scalePct - 100) > 1 && (
        <button type="button" className="zoom-reset-btn" onClick={() => zoomTo(1)} title="Terug naar origineel formaat">
          {scalePct}% · Origineel
        </button>
      )}
    </div>
  )
}
