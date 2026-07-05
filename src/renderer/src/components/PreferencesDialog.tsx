import { useEffect } from 'react'
import { useStudioStore } from '../store'
import { IconClose } from './icons'

/** Voorkeuren: standaardinstellingen die tussen sessies bewaard blijven. */
export default function PreferencesDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.preferencesOpen)
  const setOpen = useStudioStore((s) => s.setPreferencesOpen)
  const theme = useStudioStore((s) => s.theme)
  const toggleTheme = useStudioStore((s) => s.toggleTheme)
  const authorName = useStudioStore((s) => s.authorName)
  const setAuthorName = useStudioStore((s) => s.setAuthorName)
  const editorViewMode = useStudioStore((s) => s.editorViewMode)
  const setEditorViewMode = useStudioStore((s) => s.setEditorViewMode)
  const readerNightMode = useStudioStore((s) => s.readerNightMode)
  const setReaderNightMode = useStudioStore((s) => s.setReaderNightMode)
  const flattenForms = useStudioStore((s) => s.flattenForms)
  const setFlattenForms = useStudioStore((s) => s.setFlattenForms)
  const cleanMetadata = useStudioStore((s) => s.cleanMetadata)
  const setCleanMetadata = useStudioStore((s) => s.setCleanMetadata)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const VIEW_LABELS: Record<'scroll' | 'spread' | 'single', string> = {
    scroll: 'Doorlopend',
    single: 'Eén pagina',
    spread: 'Twee pagina’s'
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card prefs-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <h3>Voorkeuren</h3>
          <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten (Esc)" onClick={() => setOpen(false)}>
            <IconClose size={14} />
          </button>
        </div>

        <div className="prefs-row">
          <div>
            <div className="prefs-row__title">Thema</div>
            <div className="prefs-row__hint">Licht of donker uiterlijk van de app.</div>
          </div>
          <button type="button" className="pill-btn" onClick={toggleTheme}>
            {theme === 'dark' ? 'Donker' : 'Licht'}
          </button>
        </div>

        <div className="prefs-row">
          <div>
            <div className="prefs-row__title">Naam voor opmerkingen</div>
            <div className="prefs-row__hint">Wordt bij nieuwe opmerkingen en in de export gezet.</div>
          </div>
          <input
            type="text"
            className="prefs-input"
            placeholder="Jouw naam"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
          />
        </div>

        <div className="prefs-row">
          <div>
            <div className="prefs-row__title">Standaard leesweergave</div>
            <div className="prefs-row__hint">Hoe een document in het leestabblad opent.</div>
          </div>
          <div className="prefs-segmented">
            {(['scroll', 'single', 'spread'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`pill-btn${editorViewMode === mode ? ' pill-btn--primary' : ''}`}
                onClick={() => setEditorViewMode(mode)}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <label className="prefs-check">
          <input type="checkbox" checked={readerNightMode} onChange={(e) => setReaderNightMode(e.target.checked)} />
          <span>
            <span className="prefs-row__title">Nachtmodus bij het lezen</span>
            <span className="prefs-row__hint">Keert paginakleuren om (niet in de export).</span>
          </span>
        </label>

        <label className="prefs-check">
          <input type="checkbox" checked={flattenForms} onChange={(e) => setFlattenForms(e.target.checked)} />
          <span>
            <span className="prefs-row__title">Formulieren platslaan bij export</span>
            <span className="prefs-row__hint">Ingevulde velden worden vaste inhoud.</span>
          </span>
        </label>

        <label className="prefs-check">
          <input type="checkbox" checked={cleanMetadata} onChange={(e) => setCleanMetadata(e.target.checked)} />
          <span>
            <span className="prefs-row__title">Metadata opschonen bij export</span>
            <span className="prefs-row__hint">Verwijdert auteur, maker, producer en verborgen XMP-data (AVG).</span>
          </span>
        </label>
      </div>
    </div>
  )
}
