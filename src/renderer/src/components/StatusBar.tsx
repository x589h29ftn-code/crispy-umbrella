import { useStudioStore } from '../store'

/**
 * Slanke statusbalk onderaan het hoofdvenster: toont het actieve document,
 * het aantal pagina's, de selectie en het zoomniveau in één oogopslag.
 */
export default function StatusBar(): JSX.Element | null {
  const groups = useStudioStore((s) => s.groups)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const activeEditorTab = useStudioStore((s) => s.activeEditorTab)
  const selectedCount = useStudioStore((s) => s.selectedPageIds.size)
  const canvasScale = useStudioStore((s) => s.canvasScale)
  const editorZoom = useStudioStore((s) => s.editorZoom)
  const presentationMode = useStudioStore((s) => s.presentationMode)

  if (presentationMode || !groups.length) return null

  const activeId = activeEditorTab ?? activeGroupId
  const active = groups.find((g) => g.id === activeId) ?? groups[0]
  const totalPages = groups.reduce((sum, g) => sum + g.pages.length, 0)

  return (
    <footer className="statusbar" aria-label="Statusbalk">
      <span className="statusbar__item statusbar__item--name" title={active?.name}>
        {active?.name ?? '—'}
      </span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">
        {active ? `${active.pages.length} pagina${active.pages.length === 1 ? '' : "'s"}` : '—'}
      </span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">
        {groups.length} document{groups.length === 1 ? '' : 'en'} · {totalPages} pagina{totalPages === 1 ? '' : "'s"} totaal
      </span>
      {selectedCount > 0 && (
        <>
          <span className="statusbar__sep" />
          <span className="statusbar__item statusbar__item--accent">{selectedCount} geselecteerd</span>
        </>
      )}
      <span className="statusbar__spacer" />
      <span className="statusbar__item" title={activeEditorTab ? 'Zoom van het document' : 'Zoom van het overzicht'}>
        {Math.round((activeEditorTab ? editorZoom : canvasScale) * 100)}%
      </span>
    </footer>
  )
}
