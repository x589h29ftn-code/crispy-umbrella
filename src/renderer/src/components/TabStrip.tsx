import { useEffect } from 'react'
import { useStudioStore } from '../store'
import { IconClose, IconGridView } from './icons'

/**
 * Browser-style tab strip: the Overzicht (canvas) is the first tab; every
 * document opened for editing gets its own tab. Closing a tab never removes
 * the document — it just leaves the editor.
 */
export default function TabStrip(): JSX.Element | null {
  const groups = useStudioStore((s) => s.groups)
  const editorTabs = useStudioStore((s) => s.editorTabs)
  const activeEditorTab = useStudioStore((s) => s.activeEditorTab)
  const setActiveEditorTab = useStudioStore((s) => s.setActiveEditorTab)
  const closeEditorTab = useStudioStore((s) => s.closeEditorTab)

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
      {tabs.map((group) => (
        <div
          key={group.id}
          className={`tab-strip__tab${activeEditorTab === group.id ? ' tab-strip__tab--active' : ''}`}
          onClick={() => setActiveEditorTab(group.id)}
          onAuxClick={(e) => {
            // Middelklik sluit het tabblad, zoals in een browser.
            if (e.button === 1) {
              e.preventDefault()
              closeEditorTab(group.id)
            }
          }}
          title={`${group.name} — middelklik sluit dit tabblad`}
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
            <IconClose size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
