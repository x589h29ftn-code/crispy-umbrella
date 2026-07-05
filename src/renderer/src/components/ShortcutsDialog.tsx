import { useEffect } from 'react'
import { useStudioStore } from '../store'
import { IconClose } from './icons'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Algemeen',
    items: [
      ['Ctrl + O', 'Bestanden openen'],
      ['Ctrl + S', 'Actief document opslaan'],
      ['Ctrl + E', 'Alles exporteren als zip'],
      ['Ctrl + P', 'Afdrukken'],
      ['Ctrl + F', 'Zoeken in alle documenten'],
      ['?', 'Dit sneltoetsen-overzicht']
    ]
  },
  {
    title: 'Bewerken',
    items: [
      ['Ctrl + Z', 'Ongedaan maken'],
      ['Ctrl + Y', 'Opnieuw'],
      ['Ctrl + D', "Geselecteerde pagina's dupliceren"],
      ['R', 'Geselecteerde pagina draaien'],
      ['Delete', "Geselecteerde pagina's verwijderen"],
      ['Esc', 'Selectie opheffen / sluiten']
    ]
  }
]

/** Overzicht van alle sneltoetsen; te openen via de knop of de '?'-toets. */
export default function ShortcutsDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.shortcutsOpen)
  const setOpen = useStudioStore((s) => s.setShortcutsOpen)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card shortcuts-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <h3>Sneltoetsen</h3>
          <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten (Esc)" onClick={() => setOpen(false)}>
            <IconClose size={14} />
          </button>
        </div>
        <div className="shortcuts-grid">
          {GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <h4>{group.title}</h4>
              {group.items.map(([keys, label]) => (
                <div key={keys} className="shortcuts-row">
                  <span className="shortcuts-keys">
                    {keys.split(' + ').map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                  <span className="shortcuts-label">{label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
