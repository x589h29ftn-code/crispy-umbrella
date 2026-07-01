import { useState } from 'react'
import { useStudioStore } from '../store'
import { exportAllToZip, exportGroupToPdf } from '../lib/pdfEngine'

interface Props {
  zoomPct: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

export default function Toolbar({ zoomPct, onZoomIn, onZoomOut, onZoomReset }: Props): JSX.Element {
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const importFiles = useStudioStore((s) => s.importFiles)
  const [busy, setBusy] = useState<string | null>(null)

  const pageTotal = groups.reduce((n, g) => n + g.pages.length, 0)
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]

  async function handleOpen(): Promise<void> {
    const files = await window.api.openPdfs()
    if (files.length) await importFiles(files)
  }

  async function handleExportPdf(): Promise<void> {
    if (!activeGroup) return
    setBusy('pdf')
    try {
      const bytes = await exportGroupToPdf(activeGroup, sources)
      await window.api.savePdf(`${activeGroup.name}.pdf`, bytes)
    } finally {
      setBusy(null)
    }
  }

  async function handleExportZip(): Promise<void> {
    if (!groups.length) return
    setBusy('zip')
    try {
      const bytes = await exportAllToZip(groups, sources)
      await window.api.saveZip('PDF-Studio-export.zip', bytes)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="toolbar">
      <div className="toolbar__summary">
        {groups.length === 0
          ? 'Geen documenten'
          : `${groups.length} ${groups.length === 1 ? 'document' : "documenten"} · ${pageTotal} ${
              pageTotal === 1 ? 'pagina' : "pagina's"
            }`}
      </div>

      <div className="toolbar__zoom">
        <button type="button" className="pill-btn" onClick={onZoomOut} title="Uitzoomen">
          −
        </button>
        <button type="button" className="toolbar__zoom-pct" onClick={onZoomReset} title="Zoom herstellen (100%)">
          {zoomPct}%
        </button>
        <button type="button" className="pill-btn" onClick={onZoomIn} title="Inzoomen">
          +
        </button>
      </div>

      <div className="toolbar__actions">
        <button type="button" className="pill-btn" onClick={() => void handleOpen()}>
          Openen
        </button>
        <button
          type="button"
          className="pill-btn"
          disabled={!activeGroup || busy !== null}
          onClick={() => void handleExportPdf()}
        >
          {busy === 'pdf' ? 'Bezig…' : 'Exporteer PDF'}
        </button>
        <button
          type="button"
          className="pill-btn pill-btn--primary"
          disabled={!groups.length || busy !== null}
          onClick={() => void handleExportZip()}
        >
          {busy === 'zip' ? 'Bezig…' : 'Exporteer zip'}
        </button>
      </div>
    </div>
  )
}
