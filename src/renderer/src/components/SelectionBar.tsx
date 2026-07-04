import { useStudioStore } from '../store'
import { IconClose, IconDuplicate, IconFilePlus, IconRotateLeft, IconRotateRight, IconTrash } from './icons'

export default function SelectionBar(): JSX.Element | null {
  const selectionCount = useStudioStore((s) => s.selectedPageIds.size)
  const lightboxOpen = useStudioStore((s) => s.lightbox.open)
  const rotatePages = useStudioStore((s) => s.rotatePages)
  const duplicatePages = useStudioStore((s) => s.duplicatePages)
  const deletePages = useStudioStore((s) => s.deletePages)
  const createGroupWithPages = useStudioStore((s) => s.createGroupWithPages)
  const clearSelection = useStudioStore((s) => s.clearSelection)

  if (selectionCount === 0 || lightboxOpen) return null

  const selectedIds = (): string[] => [...useStudioStore.getState().selectedPageIds]

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
