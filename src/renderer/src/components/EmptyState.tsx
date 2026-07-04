import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import { IconFile, IconUpload } from './icons'

interface Props {
  onBrowse: () => void
  onFilesDropped: (files: FileList) => void
}

export default function EmptyState({ onBrowse, onFilesDropped }: Props): JSX.Element {
  const [hover, setHover] = useState(false)
  const [recent, setRecent] = useState<{ path: string; name: string }[]>([])
  const importFiles = useStudioStore((s) => s.importFiles)
  const addToast = useStudioStore((s) => s.addToast)

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

  return (
    <div
      className={`empty-state${hover ? ' empty-state--hover' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault()
        setHover(false)
        if (e.dataTransfer.types.includes('Files')) onFilesDropped(e.dataTransfer.files)
      }}
    >
      <div className="empty-state__icon">
        <IconUpload size={28} />
      </div>
      <h2>Zet bestanden hier neer</h2>
      <p>Sleep een of meer PDF-bestanden hierheen om te beginnen</p>
      <button type="button" className="pill-btn" onClick={onBrowse}>
        Bladeren…
      </button>
      {recent.length > 0 && (
        <div className="empty-state__recent">
          <span className="empty-state__recent-title">Recent geopend</span>
          {recent.slice(0, 6).map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="empty-state__recent-item"
              title={entry.path}
              onClick={() => void openRecent(entry.path, entry.name)}
            >
              <IconFile size={13} />
              {entry.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
