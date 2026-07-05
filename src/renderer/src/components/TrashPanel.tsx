import { useEffect } from 'react'
import { useStudioStore } from '../store'
import { IconClose, IconTrash } from './icons'

/** Prullenbak: verwijderde pagina's van deze sessie, met de optie ze terug te halen. */
export default function TrashPanel(): JSX.Element | null {
  const open = useStudioStore((s) => s.trashPanelOpen)
  const setOpen = useStudioStore((s) => s.setTrashPanelOpen)
  const trash = useStudioStore((s) => s.trash)
  const restore = useStudioStore((s) => s.restoreTrashedPages)
  const clearTrash = useStudioStore((s) => s.clearTrash)
  const addToast = useStudioStore((s) => s.addToast)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  function restoreOne(id: string): void {
    restore([id])
    addToast('success', 'Pagina teruggehaald')
  }

  function restoreAll(): void {
    if (!trash.length) return
    restore(trash.map((t) => t.id))
    addToast('success', `${trash.length} pagina('s) teruggehaald`)
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card trash-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <h3>Prullenbak</h3>
          <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten (Esc)" onClick={() => setOpen(false)}>
            <IconClose size={14} />
          </button>
        </div>

        {trash.length === 0 ? (
          <p className="trash-empty">
            De prullenbak is leeg. Verwijderde pagina's verschijnen hier en zijn deze sessie terug te halen.
          </p>
        ) : (
          <>
            <div className="trash-list">
              {trash.map((entry) => (
                <div key={entry.id} className="trash-row">
                  <IconTrash size={14} className="trash-row__icon" />
                  <span className="trash-row__name" title={entry.groupName}>
                    uit “{entry.groupName}”
                  </span>
                  <button type="button" className="pill-btn" onClick={() => restoreOne(entry.id)}>
                    Herstel
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-card__actions">
              <button type="button" className="pill-btn" onClick={() => clearTrash()}>
                Prullenbak legen
              </button>
              <button type="button" className="pill-btn pill-btn--primary" onClick={restoreAll}>
                Alles herstellen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
