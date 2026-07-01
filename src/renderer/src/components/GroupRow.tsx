import { useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { useClickOutside } from '../hooks/useClickOutside'
import type { DocGroup, SourceFile } from '../types'
import PageThumb from './PageThumb'
import AddTile from './AddTile'
import { IconCheck, IconClose, IconGrip, IconHash, IconMore, IconPlus, IconStamp } from './icons'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [showWatermarkEditor, setShowWatermarkEditor] = useState(false)
  const [watermarkDraft, setWatermarkDraft] = useState(group.watermark?.text ?? '')
  const menuRef = useRef<HTMLDivElement>(null)

  function closeMenu(): void {
    setMenuOpen(false)
    setShowWatermarkEditor(false)
  }

  useClickOutside(menuRef, menuOpen, closeMenu)

  const movePage = useStudioStore((s) => s.movePage)
  const addPagesToGroup = useStudioStore((s) => s.addPagesToGroup)
  const insertBlankPage = useStudioStore((s) => s.insertBlankPage)
  const renameGroup = useStudioStore((s) => s.renameGroup)
  const removeGroup = useStudioStore((s) => s.removeGroup)
  const reorderGroups = useStudioStore((s) => s.reorderGroups)
  const setActiveGroup = useStudioStore((s) => s.setActiveGroup)
  const setDragGroupId = useStudioStore((s) => s.setDragGroupId)
  const dragGroupId = useStudioStore((s) => s.dragGroupId)
  const setGroupWatermark = useStudioStore((s) => s.setGroupWatermark)
  const toggleGroupPageNumbers = useStudioStore((s) => s.toggleGroupPageNumbers)

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
        <IconGrip size={14} className="group-row__grip" />
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
        <div className="group-row__menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`icon-btn icon-btn--chrome${menuOpen ? ' icon-btn--active' : ''}`}
            title="Meer opties"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
              setShowWatermarkEditor(false)
            }}
          >
            <IconMore size={14} />
          </button>
          {menuOpen && (
            <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
              {showWatermarkEditor ? (
                <div className="dropdown-menu__editor">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Watermerktekst, bv. CONCEPT"
                    value={watermarkDraft}
                    onChange={(e) => setWatermarkDraft(e.target.value)}
                  />
                  <div className="dropdown-menu__editor-actions">
                    {group.watermark && (
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          setGroupWatermark(group.id, null)
                          setWatermarkDraft('')
                          closeMenu()
                        }}
                      >
                        Verwijderen
                      </button>
                    )}
                    <button
                      type="button"
                      className="pill-btn pill-btn--primary"
                      onClick={() => {
                        if (watermarkDraft.trim())
                          setGroupWatermark(group.id, { text: watermarkDraft.trim(), opacity: 0.25 })
                        closeMenu()
                      }}
                    >
                      Toepassen
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className="dropdown-menu__item" onClick={() => setShowWatermarkEditor(true)}>
                    <IconStamp size={14} />
                    Watermerk
                    {group.watermark && <IconCheck size={13} className="dropdown-menu__check" />}
                  </button>
                  <button
                    type="button"
                    className="dropdown-menu__item"
                    onClick={() => {
                      toggleGroupPageNumbers(group.id)
                      closeMenu()
                    }}
                  >
                    <IconHash size={14} />
                    Paginanummers
                    {group.pageNumbers && <IconCheck size={13} className="dropdown-menu__check" />}
                  </button>
                  <button
                    type="button"
                    className="dropdown-menu__item"
                    onClick={() => {
                      void insertBlankPage(group.id)
                      closeMenu()
                    }}
                  >
                    <IconPlus size={14} />
                    Lege pagina toevoegen
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="icon-btn icon-btn--chrome icon-btn--danger group-row__remove"
          title="Verwijder document"
          onClick={(e) => {
            e.stopPropagation()
            removeGroup(group.id)
          }}
        >
          <IconClose size={13} />
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
