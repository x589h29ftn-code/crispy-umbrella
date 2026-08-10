import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import { IconFile, IconForm, IconGridView, IconFolderOpen, IconStamp, IconUpload } from './icons'

interface Props {
  onBrowse: () => void
  onFilesDropped: (files: FileList) => void
}

interface RecentEntry {
  path: string
  name: string
  openedAt?: number
}

/** "Vandaag", "Gisteren" of een korte datum — genoeg om een bestand te herkennen. */
function whenLabel(openedAt?: number): string {
  if (!openedAt) return ''
  const day = new Date(openedAt)
  const today = new Date()
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(today) - startOfDay(day)) / 86_400_000)
  if (days <= 0) return 'Vandaag'
  if (days === 1) return 'Gisteren'
  if (days < 7) return `${days} dagen geleden`
  return day.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Map van een bestand, zodat gelijknamige bestanden uit elkaar te houden zijn. */
function folderOf(path: string): string {
  const parts = path.split(/[\\/]/)
  parts.pop()
  return parts.join('\\') || path
}

/**
 * Startscherm: wat je hier ziet is het eerste na het opstarten, want de app
 * begint standaard leeg. Naast de sleepzone staan de veelgebruikte acties en de
 * bestanden waar je het laatst aan werkte.
 */
export default function EmptyState({ onBrowse, onFilesDropped }: Props): JSX.Element {
  const [hover, setHover] = useState(false)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const importFiles = useStudioStore((s) => s.importFiles)
  const addToast = useStudioStore((s) => s.addToast)
  const setTemplatesDialogOpen = useStudioStore((s) => s.setTemplatesDialogOpen)
  const setSigningDialogOpen = useStudioStore((s) => s.setSigningDialogOpen)
  const setPreferencesOpen = useStudioStore((s) => s.setPreferencesOpen)
  const restoreLastSession = useStudioStore((s) => s.restoreLastSession)

  useEffect(() => {
    if (typeof window.api.getRecentFiles !== 'function') return
    window.api
      .getRecentFiles()
      .then(setRecent)
      .catch(() => undefined)
  }, [])

  async function openRecent(path: string, name: string): Promise<void> {
    const result = await window.api.openRecentFile(path)
    if ('error' in result && result.error) {
      addToast('error', `"${name}" kon niet worden geopend — ${result.error.toLowerCase()}`)
      setRecent((list) => list.filter((r) => r.path !== path))
      return
    }
    const file = result as { name: string; data: Uint8Array }
    await importFiles([{ name: file.name, data: file.data }])
  }

  async function openAndCombine(): Promise<void> {
    const files = await window.api.openPdfs()
    if (!files.length) return
    await importFiles(files)
    useStudioStore.getState().setActiveEditorTab(null)
    addToast('info', 'Sleep in het Overzicht documenten op elkaar om ze samen te voegen')
  }

  return (
    <div
      className={`home${hover ? ' home--drop' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault()
        // Zonder dit verwerkt het canvas eronder dezelfde drop nog een keer.
        e.stopPropagation()
        setHover(false)
        if (e.dataTransfer.types.includes('Files')) onFilesDropped(e.dataTransfer.files)
      }}
    >
      <div className="home__inner">
        <button type="button" className="home__drop" onClick={onBrowse}>
          <span className="home__drop-icon">
            <IconUpload size={26} />
          </span>
          <span className="home__drop-title">Zet bestanden hier neer</span>
          <span className="home__drop-hint">
            of klik om te bladeren — PDF, Word, Excel, PowerPoint en afbeeldingen (jpg, png)
          </span>
        </button>

        <div className="home__actions">
          <button type="button" className="home__action" onClick={onBrowse}>
            <IconFolderOpen size={17} />
            <span className="home__action-label">Openen</span>
            <span className="home__action-hint">Ctrl+O</span>
          </button>
          <button type="button" className="home__action" onClick={() => void openAndCombine()}>
            <IconGridView size={17} />
            <span className="home__action-label">Combineren of splitsen</span>
            <span className="home__action-hint">In het Overzicht</span>
          </button>
          <button type="button" className="home__action" onClick={() => setTemplatesDialogOpen(true)}>
            <IconForm size={17} />
            <span className="home__action-label">Sjablonen</span>
            <span className="home__action-hint">Word met {'{variabelen}'}</span>
          </button>
          <button type="button" className="home__action" onClick={() => setSigningDialogOpen(true)}>
            <IconStamp size={17} />
            <span className="home__action-label">Ondertekenen</span>
            <span className="home__action-hint">Zelf of tweede partij</span>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="home__recent">
            <div className="home__recent-title">Recent geopend</div>
            <div className="home__recent-list">
              {recent.slice(0, 6).map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="home__recent-item"
                  title={entry.path}
                  onClick={() => void openRecent(entry.path, entry.name)}
                >
                  <IconFile size={14} />
                  <span className="home__recent-name">{entry.name}</span>
                  <span className="home__recent-folder">{folderOf(entry.path)}</span>
                  <span className="home__recent-when">{whenLabel(entry.openedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!restoreLastSession && (
          <p className="home__note">
            De app start bewust leeg.{' '}
            <button type="button" className="home__link" onClick={() => setPreferencesOpen(true)}>
              Vorige sessie voortaan herstellen?
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
