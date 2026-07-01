import { IconPlus } from './icons'

interface Props {
  label: string
  onClick: () => void
  onFilesDropped?: (files: FileList) => void
  compact?: boolean
}

export default function AddTile({ label, onClick, onFilesDropped, compact }: Props): JSX.Element {
  return (
    <div
      className={`add-tile${compact ? ' add-tile--compact' : ''}`}
      onClick={onClick}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        onFilesDropped?.(e.dataTransfer.files)
      }}
    >
      <span className="add-tile__plus">
        <IconPlus size={20} />
      </span>
      <span>{label}</span>
    </div>
  )
}
