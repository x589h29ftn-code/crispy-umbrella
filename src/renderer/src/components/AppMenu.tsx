import { useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { useClickOutside } from '../hooks/useClickOutside'
import {
  exportActivePdf,
  exportAllZip,
  mailActivePdf,
  saveActiveToOneDrive,
  saveActiveToSource
} from '../lib/exportActions'
import {
  IconArchive,
  IconBookmark,
  IconCloud,
  IconCompare,
  IconComment,
  IconCompress,
  IconDownload,
  IconExpand,
  IconFile,
  IconFolderOpen,
  IconForm,
  IconGridView,
  IconKeyboard,
  IconMail,
  IconMarkdown,
  IconMenu,
  IconMoon,
  IconPrinter,
  IconRemarkable,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkles,
  IconStamp,
  IconSun,
  IconTrash
} from './icons'

/**
 * Adobe-achtig menu linksboven: bundelt alle bestand-, deel- en
 * gereedschapsacties in één keurige uitklap. Roept dezelfde handlers aan als de
 * knoppen in de zijbalk.
 */
export default function AppMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [recents, setRecents] = useState<{ path: string; name: string }[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)
  useClickOutside(wrapRef, open, () => setOpen(false))

  const groups = useStudioStore((s) => s.groups)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const busyExport = useStudioStore((s) => s.busyExport)
  const theme = useStudioStore((s) => s.theme)
  const toggleTheme = useStudioStore((s) => s.toggleTheme)
  const importFiles = useStudioStore((s) => s.importFiles)
  const setActiveEditorTab = useStudioStore((s) => s.setActiveEditorTab)
  const addToast = useStudioStore((s) => s.addToast)
  const setSearchOpen = useStudioStore((s) => s.setSearchOpen)
  const setCommentsPanelOpen = useStudioStore((s) => s.setCommentsPanelOpen)
  const setBookmarksPanelOpen = useStudioStore((s) => s.setBookmarksPanelOpen)
  const openCompare = useStudioStore((s) => s.openCompare)
  const setPrivacyScanOpen = useStudioStore((s) => s.setPrivacyScanOpen)
  const setSmartDialogOpen = useStudioStore((s) => s.setSmartDialogOpen)
  const setTemplatesDialogOpen = useStudioStore((s) => s.setTemplatesDialogOpen)
  const setSigningDialogOpen = useStudioStore((s) => s.setSigningDialogOpen)
  const setPreferencesOpen = useStudioStore((s) => s.setPreferencesOpen)
  const setShortcutsOpen = useStudioStore((s) => s.setShortcutsOpen)
  const setTrashPanelOpen = useStudioStore((s) => s.setTrashPanelOpen)

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]
  const hasDoc = !!activeGroup
  const busy = busyExport !== null

  async function toggle(): Promise<void> {
    const next = !open
    setOpen(next)
    if (next) {
      try {
        setRecents((await window.api.getRecentFiles()).slice(0, 6))
      } catch {
        setRecents([])
      }
    }
  }

  function run(fn: () => void): void {
    setOpen(false)
    fn()
  }

  async function openFiles(): Promise<void> {
    const files = await window.api.openPdfs()
    if (files.length) await importFiles(files)
  }

  async function combineFiles(): Promise<void> {
    const files = await window.api.openPdfs()
    if (!files.length) return
    await importFiles(files)
    setActiveEditorTab(null)
    addToast('info', 'Sleep in het Overzicht documenten op elkaar om ze samen te voegen')
  }

  function goSplit(): void {
    if (!groups.length) {
      addToast('info', 'Open eerst een document')
      return
    }
    setActiveEditorTab(null)
    addToast('info', 'Sleep in het Overzicht een pagina naar een lege plek om te splitsen')
  }

  return (
    <div className="sidebar__flyout-wrap app-menu" ref={wrapRef}>
      <button
        type="button"
        className={`app-menu__btn${open ? ' app-menu__btn--active' : ''}`}
        onClick={() => void toggle()}
        title="Menu"
      >
        <IconMenu size={16} />
        <span className="app-menu__btn-label">Menu</span>
      </button>

      {open && (
        <div className="dropdown-menu sidebar__flyout app-menu__panel" onClick={(e) => e.stopPropagation()}>
          <div className="app-menu__section">Bestand</div>
          <button type="button" className="app-menu__item" onClick={() => run(() => void openFiles())}>
            <IconFolderOpen size={15} />
            <span>Openen…</span>
            <span className="app-menu__key">Ctrl+O</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => void combineFiles())}>
            <IconFile size={15} />
            <span>Bestanden combineren…</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() => run(goSplit)}
          >
            <IconGridView size={15} />
            <span>Document splitsen…</span>
          </button>

          {recents.length > 0 && (
            <>
              <div className="app-menu__subsection">Recent geopend</div>
              {recents.map((r) => (
                <button
                  key={r.path}
                  type="button"
                  className="app-menu__item app-menu__item--recent"
                  title={r.path}
                  onClick={() =>
                    run(() =>
                      void window.api.openRecentFile(r.path).then((res) => {
                        if ('error' in res && res.error) addToast('error', res.error)
                        else if (!('error' in res)) void importFiles([res])
                      })
                    )
                  }
                >
                  <IconFile size={15} />
                  <span className="app-menu__recent-name">{r.name}</span>
                </button>
              ))}
            </>
          )}

          <div className="app-menu__divider" />
          <div className="app-menu__section">Opslaan &amp; afdrukken</div>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc || busy}
            onClick={() => run(() => void saveActiveToSource())}
          >
            <IconDownload size={15} />
            <span>Opslaan</span>
            <span className="app-menu__key">Ctrl+S</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc || busy}
            onClick={() => run(() => void exportActivePdf())}
          >
            <IconDownload size={15} />
            <span>Opslaan als PDF…</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!groups.length || busy}
            onClick={() => run(() => void exportAllZip())}
          >
            <IconArchive size={15} />
            <span>Alles exporteren (zip)</span>
            <span className="app-menu__key">Ctrl+E</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc || busy}
            onClick={() => run(() => void saveActiveToOneDrive())}
          >
            <IconCloud size={15} />
            <span>Opslaan in OneDrive</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() => run(() => void import('../lib/printActions').then((m) => m.printActiveGroup()))}
          >
            <IconPrinter size={15} />
            <span>Afdrukken…</span>
            <span className="app-menu__key">Ctrl+P</span>
          </button>

          <div className="app-menu__divider" />
          <div className="app-menu__section">Delen &amp; ondertekenen</div>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc || busy}
            onClick={() => run(() => void mailActivePdf())}
          >
            <IconMail size={15} />
            <span>Mailen als bijlage</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() =>
              run(() =>
                activeGroup &&
                void import('../lib/detachWindow').then((m) => m.openDocumentInNewWindow(activeGroup.id))
              )
            }
          >
            <IconExpand size={15} />
            <span>In los venster openen</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() =>
              run(() => void import('../lib/remarkableActions').then((m) => m.shareActiveToRemarkable()))
            }
          >
            <IconRemarkable size={15} />
            <span>Delen met reMarkable</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => setSigningDialogOpen(true))}>
            <IconStamp size={15} />
            <span>Ondertekenen…</span>
          </button>

          <div className="app-menu__divider" />
          <div className="app-menu__section">Gereedschap</div>
          <button type="button" className="app-menu__item" onClick={() => run(() => setTemplatesDialogOpen(true))}>
            <IconForm size={15} />
            <span>Sjablonen…</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!groups.length}
            onClick={() => run(() => openCompare())}
          >
            <IconCompare size={15} />
            <span>Vergelijken</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() => run(() => setPrivacyScanOpen(true))}
          >
            <IconShield size={15} />
            <span>Privacy-scan (AVG)</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() => run(() => setSmartDialogOpen(true))}
          >
            <IconSparkles size={15} />
            <span>Slimme documenten</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() => run(() => setSmartDialogOpen(true, 'markdown'))}
          >
            <IconMarkdown size={15} />
            <span>Exporteren als Markdown…</span>
          </button>
          <button
            type="button"
            className="app-menu__item"
            disabled={!hasDoc}
            onClick={() => run(() => setSmartDialogOpen(true, 'compress'))}
          >
            <IconCompress size={15} />
            <span>Comprimeren (kleiner maken)…</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => setSearchOpen(true))}>
            <IconSearch size={15} />
            <span>Zoeken</span>
            <span className="app-menu__key">Ctrl+F</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => setCommentsPanelOpen(true))}>
            <IconComment size={15} />
            <span>Opmerkingen</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => setBookmarksPanelOpen(true))}>
            <IconBookmark size={15} />
            <span>Bladwijzers</span>
          </button>

          <div className="app-menu__divider" />
          <div className="app-menu__section">Instellingen</div>
          <button type="button" className="app-menu__item" onClick={() => run(() => setPreferencesOpen(true))}>
            <IconSettings size={15} />
            <span>Voorkeuren…</span>
            <span className="app-menu__key">Ctrl+K</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => setShortcutsOpen(true))}>
            <IconKeyboard size={15} />
            <span>Sneltoetsen</span>
            <span className="app-menu__key">?</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => toggleTheme())}>
            {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
            <span>{theme === 'dark' ? 'Licht thema' : 'Donker thema'}</span>
          </button>
          <button type="button" className="app-menu__item" onClick={() => run(() => setTrashPanelOpen(true))}>
            <IconTrash size={15} />
            <span>Prullenbak</span>
          </button>
        </div>
      )}
    </div>
  )
}
