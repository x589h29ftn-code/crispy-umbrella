import { useState } from 'react'
import { IconUpload } from './icons'

interface Props {
  onBrowse: () => void
  onFilesDropped: (files: FileList) => void
}

export default function EmptyState({ onBrowse, onFilesDropped }: Props): JSX.Element {
  const [hover, setHover] = useState(false)

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
    </div>
  )
}
