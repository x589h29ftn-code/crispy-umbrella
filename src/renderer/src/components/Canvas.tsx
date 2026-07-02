import { useEffect, useMemo } from 'react'
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
  const createGroupWithPages = useStudioStore((s) => s.createGroupWithPages)
  const reorderGroups = useStudioStore((s) => s.reorderGroups)

  const { viewportRef, contentRef, zoomBy, zoomTo } = usePanZoom(onScaleChange)
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
      className="canvas-viewport"
      ref={viewportRef}
      onDragOver={(e) => {
        const { dragPageIds, dragGroupId } = useStudioStore.getState()
        if (e.dataTransfer.types.includes('Files') || dragPageIds || dragGroupId) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) {
          void addDroppedDocuments(e.dataTransfer.files)
          return
        }
        const { dragPageIds, dragGroupId } = useStudioStore.getState()
        if (dragGroupId) {
          reorderGroups(dragGroupId, groups.length)
          return
        }
        const pageId = e.dataTransfer.getData('text/plain')
        const ids = dragPageIds ?? (pageId ? [pageId] : [])
        if (ids.length) createGroupWithPages(ids)
      }}
    >
      <div className="canvas-content" ref={contentNodeRef}>
        {groups.map((group, i) => (
          <GroupRow key={group.id} group={group} index={i} sources={sources} isActive={group.id === activeGroupId} />
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
    </div>
  )
}
