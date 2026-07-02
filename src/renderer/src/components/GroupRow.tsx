import { useRef, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useStudioStore } from '../store'
import { useClickOutside } from '../hooks/useClickOutside'
import { usePressDrag } from '../hooks/usePressDrag'
import { beginGroupDrag, cancelDrag, finishDrag, updateDrag } from '../lib/dragController'
import type { DocGroup, SourceFile } from '../types'
import PageThumb from './PageThumb'
import AddTile from './AddTile'
import { IconCalendar, IconCheck, IconClose, IconGrip, IconHash, IconMore, IconPlus, IconStamp } from './icons'

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
  const [menuView, setMenuView] = useState<'closed' | 'menu' | 'watermark' | 'date'>('closed')
  const [watermarkDraft, setWatermarkDraft] = useState(group.watermark?.text ?? '')
  const [dateDraft, setDateDraft] = useState(group.documentDate ?? '')
  const menuRef = useRef<HTMLDivElement>(null)
  const [animatePagesRef] = useAutoAnimate<HTMLDivElement>({ duration: 160, easing: 'ease-out' })

  function closeMenu(): void {
    setMenuView('closed')
  }

  useClickOutside(menuRef, menuView !== 'closed', closeMenu)

  const addPagesToGroup = useStudioStore((s) => s.addPagesToGroup)
  const insertBlankPage = useStudioStore((s) => s.insertBlankPage)
  const renameGroup = useStudioStore((s) => s.renameGroup)
  const removeGroup = useStudioStore((s) => s.removeGroup)
  const setActiveGroup = useStudioStore((s) => s.setActiveGroup)
  const dragGroupId = useStudioStore((s) => s.dragGroupId)
  const setGroupWatermark = useStudioStore((s) => s.setGroupWatermark)
  const toggleGroupPageNumbers = useStudioStore((s) => s.toggleGroupPageNumbers)
  const setGroupDocumentDate = useStudioStore((s) => s.setGroupDocumentDate)

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
        .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
        .map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))
    )
    if (files.length) await addPagesToGroup(group.id, files)
  }

  return (
    <section
      className={`group-row${isActive ? ' group-row--active' : ''}${dragGroupId === group.id ? ' group-row--dragging' : ''}${dropBefore ? ' group-row--drop-before' : ''}${dropAfter ? ' group-row--drop-after' : ''}`}
      data-group-id={group.id}
      data-group-index={index}
      onClick={() => setActiveGroup(group.id)}
    >
      <header className="group-row__header" {...headerDrag}>
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
        {group.documentDate && (
          <span className="group-row__date" title="Documentdatum bij export">
            <IconCalendar size={11} /> {formatDutchDate(group.documentDate)}
          </span>
        )}
        <div className="group-row__menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`icon-btn icon-btn--chrome${menuView !== 'closed' ? ' icon-btn--active' : ''}`}
            title="Meer opties"
            onClick={(e) => {
              e.stopPropagation()
              setMenuView((v) => (v === 'closed' ? 'menu' : 'closed'))
            }}
          >
            <IconMore size={14} />
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
              {menuView === 'menu' && (
                <>
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
        <AddTile label="Pagina toevoegen" onClick={() => void pickAndAddPages()} onFilesDropped={addDroppedFiles} />
      </div>
    </section>
  )
}
