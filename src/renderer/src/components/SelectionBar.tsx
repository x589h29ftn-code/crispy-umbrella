import { useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { useClickOutside } from '../hooks/useClickOutside'
import { exportPagesAsSeparateFiles } from '../lib/exportActions'
import {
  IconClose,
  IconDownload,
  IconDuplicate,
  IconFilePlus,
  IconMerge,
  IconRotateLeft,
  IconRotateRight,
  IconTrash
} from './icons'

export default function SelectionBar(): JSX.Element | null {
  const selectionCount = useStudioStore((s) => s.selectedPageIds.size)
  const groups = useStudioStore((s) => s.groups)
  const movePages = useStudioStore((s) => s.movePages)
  const addToast = useStudioStore((s) => s.addToast)
  const [moveOpen, setMoveOpen] = useState(false)
  const moveRef = useRef<HTMLDivElement>(null)
  useClickOutside(moveRef, moveOpen, () => setMoveOpen(false))
  const lightboxOpen = useStudioStore((s) => s.lightbox.open)
  const rotatePages = useStudioStore((s) => s.rotatePages)
  const duplicatePages = useStudioStore((s) => s.duplicatePages)
  const deletePages = useStudioStore((s) => s.deletePages)
  const createGroupWithPages = useStudioStore((s) => s.createGroupWithPages)
  const clearSelection = useStudioStore((s) => s.clearSelection)

  if (selectionCount === 0 || lightboxOpen) return null

  const selectedIds = (): string[] => [...useStudioStore.getState().selectedPageIds]

  // Zit de selectie helemaal in één document, dan is dat document geen doel.
  const selected = useStudioStore.getState().selectedPageIds
  const sourceGroups = groups.filter((g) => g.pages.some((p) => selected.has(p.id)))
  const moveTargets = sourceGroups.length === 1 ? groups.filter((g) => g.id !== sourceGroups[0].id) : groups

  function moveTo(groupId: string, name: string): void {
    const ids = selectedIds()
    const target = groups.find((g) => g.id === groupId)
    setMoveOpen(false)
    movePages(ids, groupId, target?.pages.length ?? 0)
    addToast('success', `${ids.length} ${ids.length === 1 ? 'pagina' : "pagina's"} verplaatst naar "${name}"`)
  }

  return (
    <div className="selection-bar">
      <span className="selection-bar__count">
        {selectionCount} {selectionCount === 1 ? 'pagina' : "pagina's"} geselecteerd
      </span>
      <div className="selection-bar__divider" />
      <button
        type="button"
        className="pill-btn pill-btn--icon"
        title="Roteer linksom"
        onClick={() => rotatePages(selectedIds(), -90)}
      >
        <IconRotateLeft size={15} />
      </button>
      <button
        type="button"
        className="pill-btn pill-btn--icon"
        title="Roteer rechtsom (R)"
        onClick={() => rotatePages(selectedIds(), 90)}
      >
        <IconRotateRight size={15} />
      </button>
      <button
        type="button"
        className="pill-btn pill-btn--icon"
        title="Dupliceer (Ctrl+D)"
        onClick={() => duplicatePages(selectedIds())}
      >
        <IconDuplicate size={15} />
      </button>
      <button
        type="button"
        className="pill-btn"
        title="Splitsen: verplaats de geselecteerde pagina's naar een nieuw document"
        onClick={() => createGroupWithPages(selectedIds())}
      >
        <IconFilePlus size={15} /> Nieuw document
      </button>
      <div className="selection-bar__menu-wrap" ref={moveRef}>
        <button
          type="button"
          className="pill-btn"
          disabled={moveTargets.length === 0}
          title="Verplaats de geselecteerde pagina's naar een ander document (samenvoegen). Slepen kan ook."
          onClick={() => setMoveOpen((v) => !v)}
        >
          <IconMerge size={15} /> Naar document…
        </button>
        {moveOpen && (
          <div className="dropdown-menu selection-bar__menu" onClick={(e) => e.stopPropagation()}>
            <div className="dropdown-menu__label">Verplaatsen naar</div>
            {moveTargets.map((g) => (
              <button
                key={g.id}
                type="button"
                className="dropdown-menu__item"
                onClick={() => moveTo(g.id, g.name)}
              >
                <IconMerge size={14} />
                <span className="dropdown-menu__ellipsis">{g.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="pill-btn"
        title="Exporteer elke geselecteerde pagina als apart PDF-bestand (in één zip)"
        onClick={() => void exportPagesAsSeparateFiles(selectedIds())}
      >
        <IconDownload size={15} /> Losse bestanden
      </button>
      <button
        type="button"
        className="pill-btn pill-btn--icon selection-bar__danger"
        title="Verwijder (Delete)"
        onClick={() => deletePages(selectedIds())}
      >
        <IconTrash size={15} />
      </button>
      <div className="selection-bar__divider" />
      <button
        type="button"
        className="pill-btn pill-btn--icon"
        title="Selectie wissen (Esc)"
        onClick={clearSelection}
      >
        <IconClose size={14} />
      </button>
    </div>
  )
}
