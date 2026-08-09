import { useEffect, useRef, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { isImportableFileName, useStudioStore } from '../store'
import { useClickOutside } from '../hooks/useClickOutside'
import { usePressDrag } from '../hooks/usePressDrag'
import { beginGroupDrag, cancelDrag, finishDrag, updateDrag } from '../lib/dragController'
import type { DocGroup, SourceFile } from '../types'
import PageThumb from './PageThumb'
import AddTile from './AddTile'
import {
  IconCalendar,
  IconCheck,
  IconClose,
  IconFolderOpen,
  IconGrip,
  IconHash,
  IconMerge,
  IconMore,
  IconPlus,
  IconScissors,
  IconStamp,
  IconTab
} from './icons'

interface Props {
  group: DocGroup
  index: number
  isLast: boolean
  sources: Map<string, SourceFile>
  isActive: boolean
}

function formatDutchDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day}-${month}-${year}`
}

export default function GroupRow({ group, index, isLast, sources, isActive }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const [menuView, setMenuView] = useState<'closed' | 'menu' | 'watermark' | 'date' | 'merge'>('closed')
  /** Er wordt een bestand boven deze kaart gesleept (dan voegen we het hier toe). */
  const [fileHover, setFileHover] = useState(false)
  const [watermarkDraft, setWatermarkDraft] = useState(group.watermark?.text ?? '')
  const [dateDraft, setDateDraft] = useState(group.documentDate ?? '')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const [animatePagesRef] = useAutoAnimate<HTMLDivElement>({ duration: 160, easing: 'ease-out' })

  function closeMenu(): void {
    setMenuView('closed')
  }

  useClickOutside(menuRef, menuView !== 'closed', closeMenu)
  useClickOutside(addMenuRef, addMenuOpen, () => setAddMenuOpen(false))

  const addPagesToGroup = useStudioStore((s) => s.addPagesToGroup)
  const insertBlankPage = useStudioStore((s) => s.insertBlankPage)
  const renameGroup = useStudioStore((s) => s.renameGroup)
  const removeGroup = useStudioStore((s) => s.removeGroup)
  const setActiveGroup = useStudioStore((s) => s.setActiveGroup)
  const dragGroupId = useStudioStore((s) => s.dragGroupId)
  const setGroupWatermark = useStudioStore((s) => s.setGroupWatermark)
  const toggleGroupPageNumbers = useStudioStore((s) => s.toggleGroupPageNumbers)
  const setGroupDocumentDate = useStudioStore((s) => s.setGroupDocumentDate)
  const openEditorTab = useStudioStore((s) => s.openEditorTab)
  const mergeGroupInto = useStudioStore((s) => s.mergeGroupInto)
  const setSmartDialogOpen = useStudioStore((s) => s.setSmartDialogOpen)
  const setActiveGroupStore = useStudioStore((s) => s.setActiveGroup)
  const otherGroups = useStudioStore((s) => s.groups.filter((g) => g.id !== group.id))

  // Encoded drop indicator position for this row: page index * 2 (+1 for the
  // "after" edge), or -1 when the drag isn't targeting this document.
  const dropSlot = useStudioStore((s) =>
    s.dropTarget?.type === 'slot' && s.dropTarget.groupId === group.id
      ? s.dropTarget.index * 2 + (s.dropTarget.edge === 'after' ? 1 : 0)
      : -1
  )
  const dropBefore = useStudioStore((s) => s.groupDropIndex === index)
  const dropAfter = useStudioStore((s) => isLast && s.groupDropIndex === index + 1)

  const headerDrag = usePressDrag({
    ignoreSelector: 'button, input, .dropdown-menu',
    onStart: (e) => {
      beginGroupDrag(group.id, group.name, e.clientX, e.clientY)
    },
    onMove: updateDrag,
    onEnd: finishDrag,
    onCancel: cancelDrag
  })

  async function pickAndAddPages(): Promise<void> {
    const files = await window.api.openPdfs()
    if (files.length) await addPagesToGroup(group.id, files)
  }

  async function addDroppedFiles(fileList: FileList): Promise<void> {
    const files = await Promise.all(
      Array.from(fileList)
        .filter((f) => isImportableFileName(f.name))
        .map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))
    )
    if (files.length) await addPagesToGroup(group.id, files)
  }

  // Eindigt het slepen buiten deze kaart (of wordt het afgebroken), dan moet de
  // markering hoe dan ook weg — een gemiste dragleave laat hem anders staan.
  useEffect(() => {
    if (!fileHover) return
    const clear = (): void => setFileHover(false)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [fileHover])

  /** Een bestand dat op déze kaart valt wordt aan dit document toegevoegd (samenvoegen). */
  function onFileDragOver(e: React.DragEvent): void {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setFileHover(true)
  }

  function onFileDrop(e: React.DragEvent): void {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setFileHover(false)
    void addDroppedFiles(e.dataTransfer.files)
  }

  return (
    <section
      className={`group-row${isActive ? ' group-row--active' : ''}${dragGroupId === group.id ? ' group-row--dragging' : ''}${dropBefore ? ' group-row--drop-before' : ''}${dropAfter ? ' group-row--drop-after' : ''}${fileHover ? ' group-row--file-drop' : ''}${dropSlot >= 0 ? ' group-row--page-drop' : ''}`}
      data-group-id={group.id}
      data-group-index={index}
      onClick={() => setActiveGroup(group.id)}
      onDragOver={onFileDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileHover(false)
      }}
      onDrop={onFileDrop}
    >
      {fileHover && (
        <div className="group-row__file-overlay">
          <span>Toevoegen aan “{group.name}”</span>
        </div>
      )}
      <header
        className="group-row__header"
        {...headerDrag}
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('.group-row__name, input, button, .dropdown-menu')) return
          openEditorTab(group.id)
        }}
        title="Dubbelklik om dit document in een tabblad te bewerken"
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
            className="icon-btn icon-btn--chrome group-row__action"
            title="Openen als tabblad om te bewerken"
            onClick={(e) => {
              e.stopPropagation()
              openEditorTab(group.id)
            }}
          >
            <IconTab size={16} />
          </button>
          <button
            type="button"
            className={`icon-btn icon-btn--chrome group-row__action${menuView === 'merge' ? ' icon-btn--active' : ''}`}
            disabled={otherGroups.length === 0}
            title={
              otherGroups.length
                ? 'Samenvoegen met een ander document'
                : 'Samenvoegen kan zodra er een tweede document is'
            }
            onClick={(e) => {
              e.stopPropagation()
              setMenuView((v) => (v === 'merge' ? 'closed' : 'merge'))
            }}
          >
            <IconMerge size={16} />
          </button>
          {group.documentDate ? (
            <button
              type="button"
              className="group-row__date"
              title="Documentdatum bij export — klik om aan te passen"
              onClick={(e) => {
                e.stopPropagation()
                setDateDraft(group.documentDate ?? '')
                setMenuView((v) => (v === 'date' ? 'closed' : 'date'))
              }}
            >
              <IconCalendar size={11} /> {formatDutchDate(group.documentDate)}
            </button>
          ) : (
            <button
              type="button"
              className={`icon-btn icon-btn--chrome group-row__action${menuView === 'date' ? ' icon-btn--active' : ''}`}
              title="Documentdatum instellen (aanmaak- en wijzigingsdatum bij export)"
              onClick={(e) => {
                e.stopPropagation()
                setDateDraft(group.documentDate ?? '')
                setMenuView((v) => (v === 'date' ? 'closed' : 'date'))
              }}
            >
              <IconCalendar size={16} />
            </button>
          )}
          <button
            type="button"
            className={`icon-btn icon-btn--chrome group-row__action${menuView === 'menu' || menuView === 'watermark' ? ' icon-btn--active' : ''}`}
            title="Meer opties"
            onClick={(e) => {
              e.stopPropagation()
              setMenuView((v) => (v === 'closed' ? 'menu' : 'closed'))
            }}
          >
            <IconMore size={16} />
          </button>
          {menuView !== 'closed' && (
            <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
              {menuView === 'watermark' && (
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
              )}
              {menuView === 'date' && (
                <div className="dropdown-menu__editor">
                  <label className="dropdown-menu__editor-label">
                    Documentdatum (aanmaak- en wijzigingsdatum van het PDF-bestand bij export)
                  </label>
                  <input autoFocus type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} />
                  <div className="dropdown-menu__editor-actions">
                    {group.documentDate && (
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          setGroupDocumentDate(group.id, null)
                          setDateDraft('')
                          closeMenu()
                        }}
                      >
                        Verwijderen
                      </button>
                    )}
                    <button
                      type="button"
                      className="pill-btn pill-btn--primary"
                      disabled={!dateDraft}
                      onClick={() => {
                        if (dateDraft) setGroupDocumentDate(group.id, dateDraft)
                        closeMenu()
                      }}
                    >
                      Toepassen
                    </button>
                  </div>
                </div>
              )}
              {menuView === 'merge' && (
                <>
                  <div className="dropdown-menu__label">Samenvoegen met…</div>
                  {otherGroups.map((other) => (
                    <button
                      key={other.id}
                      type="button"
                      className="dropdown-menu__item"
                      title={`Voeg de pagina's van "${group.name}" achter "${other.name}"`}
                      onClick={() => {
                        closeMenu()
                        mergeGroupInto(group.id, other.id)
                      }}
                    >
                      <IconMerge size={14} />
                      <span className="dropdown-menu__ellipsis">{other.name}</span>
                    </button>
                  ))}
                </>
              )}
              {menuView === 'menu' && (
                <>
                  <button
                    type="button"
                    className="dropdown-menu__item"
                    onClick={() => {
                      closeMenu()
                      setActiveGroupStore(group.id)
                      setSmartDialogOpen(true, 'split')
                    }}
                  >
                    <IconScissors size={14} />
                    Splitsen op inhoudsopgave…
                  </button>
                  <button type="button" className="dropdown-menu__item" onClick={() => setMenuView('watermark')}>
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
                  <button type="button" className="dropdown-menu__item" onClick={() => setMenuView('date')}>
                    <IconCalendar size={14} />
                    Documentdatum
                    {group.documentDate && <IconCheck size={13} className="dropdown-menu__check" />}
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
          <button
            type="button"
            className="icon-btn icon-btn--chrome icon-btn--danger group-row__action"
            title="Verwijder document uit het overzicht"
            onClick={(e) => {
              e.stopPropagation()
              removeGroup(group.id)
            }}
          >
            <IconClose size={15} />
          </button>
        </div>
      </header>

      <div
        className="group-row__pages"
        ref={animatePagesRef}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.stopPropagation()
          void addDroppedFiles(e.dataTransfer.files)
        }}
      >
        {group.pages.map((page, i) => (
          <div key={page.id} className="group-row__slot">
            {dropSlot === i * 2 && <div className="drop-indicator" />}
            <PageThumb page={page} source={sources.get(page.sourceId)} index={i} />
            {dropSlot === i * 2 + 1 && <div className="drop-indicator" />}
          </div>
        ))}
        <div className="add-tile-wrap" ref={addMenuRef}>
          <AddTile label="Pagina toevoegen" onClick={() => setAddMenuOpen((v) => !v)} onFilesDropped={addDroppedFiles} />
          {addMenuOpen && (
            <div className="dropdown-menu dropdown-menu--left" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="dropdown-menu__item"
                onClick={() => {
                  setAddMenuOpen(false)
                  void insertBlankPage(group.id)
                }}
              >
                <IconPlus size={14} />
                Lege pagina
              </button>
              <button
                type="button"
                className="dropdown-menu__item"
                onClick={() => {
                  setAddMenuOpen(false)
                  void pickAndAddPages()
                }}
              >
                <IconFolderOpen size={14} />
                Pagina's uit PDF-bestand…
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
