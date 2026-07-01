import { useState } from 'react'
import { useStudioStore } from '../store'
import type { DocGroup, SourceFile } from '../types'
import PageThumb from './PageThumb'
import AddTile from './AddTile'

interface Props {
  group: DocGroup
  index: number
  sources: Map<string, SourceFile>
  isActive: boolean
}

interface Slot {
  index: number
  edge: 'before' | 'after'
}

export default function GroupRow({ group, index, sources, isActive }: Props): JSX.Element {
  const [slot, setSlot] = useState<Slot | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)

  const movePage = useStudioStore((s) => s.movePage)
  const addPagesToGroup = useStudioStore((s) => s.addPagesToGroup)
  const renameGroup = useStudioStore((s) => s.renameGroup)
  const removeGroup = useStudioStore((s) => s.removeGroup)
  const reorderGroups = useStudioStore((s) => s.reorderGroups)
  const setActiveGroup = useStudioStore((s) => s.setActiveGroup)
  const setDragGroupId = useStudioStore((s) => s.setDragGroupId)
  const dragGroupId = useStudioStore((s) => s.dragGroupId)

  const targetIndex = (): number => {
    if (!slot) return group.pages.length
    return slot.edge === 'before' ? slot.index : slot.index + 1
  }

  async function pickAndAddPages(): Promise<void> {
    const files = await window.api.openPdfs()
    if (files.length) await addPagesToGroup(group.id, files)
  }

  async function addDroppedFiles(fileList: FileList): Promise<void> {
    const files = await Promise.all(
      Array.from(fileList)
        .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
        .map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))
    )
    if (files.length) await addPagesToGroup(group.id, files)
  }

  return (
    <section
      className={`group-row${isActive ? ' group-row--active' : ''}${dragGroupId === group.id ? ' group-row--dragging' : ''}`}
      onClick={() => setActiveGroup(group.id)}
      onDragOver={(e) => {
        if (dragGroupId && dragGroupId !== group.id) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!dragGroupId || dragGroupId === group.id) return
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        const before = e.clientY - rect.top < rect.height / 2
        reorderGroups(dragGroupId, before ? index : index + 1)
      }}
    >
      <header
        className="group-row__header"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', group.id)
          setDragGroupId(group.id)
        }}
        onDragEnd={() => setDragGroupId(null)}
      >
        <span className="group-row__number">{String(index + 1).padStart(2, '0')}</span>
        {editing ? (
          <input
            autoFocus
            className="group-row__name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              renameGroup(group.id, draft)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraft(group.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className="group-row__name"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setDraft(group.name)
              setEditing(true)
            }}
          >
            {group.name}
          </span>
        )}
        <span className="group-row__count">
          {group.pages.length} {group.pages.length === 1 ? 'pagina' : "pagina's"}
        </span>
        <button
          type="button"
          className="icon-btn icon-btn--danger group-row__remove"
          title="Verwijder document"
          onClick={(e) => {
            e.stopPropagation()
            removeGroup(group.id)
          }}
        >
          ✕
        </button>
      </header>

      <div
        className="group-row__pages"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            return
          }
          e.preventDefault()
          if (!slot) setSlot({ index: group.pages.length - 1, edge: 'after' })
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setSlot(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.dataTransfer.types.includes('Files')) {
            void addDroppedFiles(e.dataTransfer.files)
            setSlot(null)
            return
          }
          const pageId = e.dataTransfer.getData('text/plain')
          if (pageId) movePage(pageId, group.id, targetIndex())
          setSlot(null)
        }}
      >
        {group.pages.map((page, i) => (
          <div key={page.id} className="group-row__slot">
            {slot && slot.index === i && slot.edge === 'before' && <div className="drop-indicator" />}
            <PageThumb
              page={page}
              source={sources.get(page.sourceId)}
              index={i}
              onDragOverSlot={(idx, edge) => setSlot({ index: idx, edge })}
            />
            {slot && slot.index === i && slot.edge === 'after' && <div className="drop-indicator" />}
          </div>
        ))}
        <AddTile label="Pagina toevoegen" onClick={() => void pickAndAddPages()} onFilesDropped={addDroppedFiles} />
      </div>
    </section>
  )
}
