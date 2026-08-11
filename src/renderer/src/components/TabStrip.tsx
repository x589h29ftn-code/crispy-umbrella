import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import { IconClose, IconGridView } from './icons'

/**
 * Browser-style tab strip: the Overzicht (canvas) is the first tab; every
 * document opened for editing gets its own tab. Closing a tab never removes
 * the document — it just leaves the editor. Tabbladen zijn te slepen om ze
 * op de gewenste volgorde te zetten.
 */
export default function TabStrip(): JSX.Element | null {
  const groups = useStudioStore((s) => s.groups)
  const editorTabs = useStudioStore((s) => s.editorTabs)
  const activeEditorTab = useStudioStore((s) => s.activeEditorTab)
  const setActiveEditorTab = useStudioStore((s) => s.setActiveEditorTab)
  const closeEditorTab = useStudioStore((s) => s.closeEditorTab)
  const moveEditorTab = useStudioStore((s) => s.moveEditorTab)

  /** Tabblad dat gesleept wordt, en de plek waar het zou landen. */
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ index: number; after: boolean } | null>(null)

  // Documents can disappear (verwijderd/samengevoegd); prune their tabs.
  useEffect(() => {
    for (const id of editorTabs) {
      if (!groups.some((g) => g.id === id)) closeEditorTab(id)
    }
  }, [groups, editorTabs, closeEditorTab])

  const tabs = editorTabs
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))

  if (tabs.length === 0) return null

  function resetDrag(): void {
    setDragId(null)
    setDropAt(null)
  }

  /** Links of rechts van het midden losgelaten? Dat bepaalt de nieuwe plek. */
  function edgeOf(e: React.DragEvent, index: number): { index: number; after: boolean } {
    const rect = e.currentTarget.getBoundingClientRect()
    return { index, after: e.clientX > rect.left + rect.width / 2 }
  }

  return (
    <div className="tab-strip">
      <button
        type="button"
        className={`tab-strip__tab tab-strip__tab--home${activeEditorTab === null ? ' tab-strip__tab--active' : ''}`}
        onClick={() => setActiveEditorTab(null)}
        title="Overzicht: samenvoegen, splitsen en pagina's verplaatsen"
      >
        <IconGridView size={13} />
        Overzicht
      </button>
      {tabs.map((group, index) => {
        const dropBefore = dropAt?.index === index && !dropAt.after
        const dropAfter = dropAt?.index === index && dropAt.after
        return (
          <div
            key={group.id}
            draggable
            className={`tab-strip__tab${activeEditorTab === group.id ? ' tab-strip__tab--active' : ''}${
              dragId === group.id ? ' tab-strip__tab--dragging' : ''
            }${dropBefore ? ' tab-strip__tab--drop-before' : ''}${dropAfter ? ' tab-strip__tab--drop-after' : ''}`}
            onClick={() => setActiveEditorTab(group.id)}
            onAuxClick={(e) => {
              // Middelklik sluit het tabblad, zoals in een browser.
              if (e.button === 1) {
                e.preventDefault()
                closeEditorTab(group.id)
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              // Zonder inhoud start het slepen in sommige gevallen niet.
              e.dataTransfer.setData('text/plain', group.name)
              setDragId(group.id)
            }}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropAt(edgeOf(e, index))
            }}
            onDragLeave={(e) => {
              // Bij het binnengaan van een kind-element vuurt ook een dragleave;
              // zonder deze controle knippert de markering weg.
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setDropAt((current) => (current?.index === index ? null : current))
            }}
            onDrop={(e) => {
              if (!dragId) return
              e.preventDefault()
              const { after } = edgeOf(e, index)
              const from = tabs.findIndex((t) => t.id === dragId)
              // Doelindex ná het weghalen van het gesleepte tabblad.
              let target = index + (after ? 1 : 0)
              if (from >= 0 && from < target) target -= 1
              moveEditorTab(dragId, target)
              resetDrag()
            }}
            onDragEnd={resetDrag}
            title={`${group.name} — sleep om de volgorde te wijzigen, middelklik sluit dit tabblad`}
          >
            <span className="tab-strip__name">{group.name}</span>
            <button
              type="button"
              className="icon-btn icon-btn--chrome tab-strip__close"
              title="Tabblad sluiten (document blijft in het overzicht)"
              onClick={(e) => {
                e.stopPropagation()
                closeEditorTab(group.id)
              }}
            >
              <IconClose size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
