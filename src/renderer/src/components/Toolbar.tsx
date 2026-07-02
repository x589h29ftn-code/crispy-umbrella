import { useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { exportActivePdf, exportAllZip } from '../lib/exportActions'
import {
  IconClose,
  IconFolderOpen,
  IconLock,
  IconMinus,
  IconMoon,
  IconPlus,
  IconRedo,
  IconSignature,
  IconSun,
  IconUndo
} from './icons'

interface Props {
  zoomPct: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

function readImageFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('Kon afbeelding niet laden'))
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export default function Toolbar({ zoomPct, onZoomIn, onZoomOut, onZoomReset }: Props): JSX.Element {
  const groups = useStudioStore((s) => s.groups)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const importFiles = useStudioStore((s) => s.importFiles)
  const signatureAsset = useStudioStore((s) => s.signatureAsset)
  const setSignatureAsset = useStudioStore((s) => s.setSignatureAsset)
  const theme = useStudioStore((s) => s.theme)
  const toggleTheme = useStudioStore((s) => s.toggleTheme)
  const canUndo = useStudioStore((s) => s.past.length > 0)
  const canRedo = useStudioStore((s) => s.future.length > 0)
  const undo = useStudioStore((s) => s.undo)
  const redo = useStudioStore((s) => s.redo)
  const busyExport = useStudioStore((s) => s.busyExport)
  const exportPassword = useStudioStore((s) => s.exportPassword)
  const setExportPassword = useStudioStore((s) => s.setExportPassword)
  const [showPasswordField, setShowPasswordField] = useState(false)
  const signatureInputRef = useRef<HTMLInputElement>(null)

  const pageTotal = groups.reduce((n, g) => n + g.pages.length, 0)
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]

  async function handleOpen(): Promise<void> {
    const files = await window.api.openPdfs()
    if (files.length) await importFiles(files)
  }

  async function handleSignatureFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { dataUrl, width, height } = await readImageFile(file)
      setSignatureAsset({
        dataUrl,
        mimeType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        naturalWidth: width,
        naturalHeight: height
      })
    } catch {
      useStudioStore.getState().addToast('error', 'Kon de handtekening-afbeelding niet laden')
    }
  }

  return (
    <div className="toolbar">
      <div className="toolbar__summary">
        {groups.length === 0
          ? 'Geen documenten'
          : `${groups.length} ${groups.length === 1 ? 'document' : 'documenten'} · ${pageTotal} ${
              pageTotal === 1 ? 'pagina' : "pagina's"
            }`}
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className="pill-btn pill-btn--icon"
          disabled={!canUndo}
          onClick={undo}
          title="Ongedaan maken (Ctrl+Z)"
        >
          <IconUndo size={15} />
        </button>
        <button
          type="button"
          className="pill-btn pill-btn--icon"
          disabled={!canRedo}
          onClick={redo}
          title="Opnieuw (Ctrl+Y)"
        >
          <IconRedo size={15} />
        </button>
      </div>

      <div className="toolbar__zoom">
        <button type="button" className="pill-btn pill-btn--icon" onClick={onZoomOut} title="Uitzoomen">
          <IconMinus size={14} />
        </button>
        <button type="button" className="toolbar__zoom-pct" onClick={onZoomReset} title="Zoom herstellen (100%)">
          {zoomPct}%
        </button>
        <button type="button" className="pill-btn pill-btn--icon" onClick={onZoomIn} title="Inzoomen">
          <IconPlus size={14} />
        </button>
      </div>

      <div className="toolbar__actions">
        <button
          type="button"
          className="pill-btn pill-btn--icon"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
        >
          {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        <div className="toolbar__divider" />

        <div className="toolbar__group">
          <input
            ref={signatureInputRef}
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={(e) => void handleSignatureFile(e)}
          />
          <button
            type="button"
            className={`pill-btn${signatureAsset ? ' pill-btn--active' : ''}`}
            onClick={() => signatureInputRef.current?.click()}
            title="Laad een afbeelding van je handtekening om op pagina's te plaatsen"
          >
            <IconSignature size={14} /> {signatureAsset ? 'Handtekening geladen' : 'Handtekening'}
          </button>
          {signatureAsset && (
            <button
              type="button"
              className="icon-btn icon-btn--chrome icon-btn--danger"
              title="Handtekening wissen"
              onClick={() => setSignatureAsset(null)}
            >
              <IconClose size={13} />
            </button>
          )}

          <div className="toolbar__password">
            <button
              type="button"
              className={`pill-btn${exportPassword ? ' pill-btn--active' : ''}`}
              onClick={() => setShowPasswordField((v) => !v)}
              title="Wachtwoord instellen voor geëxporteerde PDF's"
            >
              <IconLock size={14} /> Wachtwoord
            </button>
            {showPasswordField && (
              <input
                autoFocus
                type="password"
                className="toolbar__password-input"
                placeholder="Wachtwoord voor export"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
              />
            )}
          </div>
        </div>

        <div className="toolbar__divider" />

        <div className="toolbar__group">
          <button type="button" className="pill-btn" onClick={() => void handleOpen()} title="Openen (Ctrl+O)">
            <IconFolderOpen size={14} /> Openen
          </button>
          <button
            type="button"
            className="pill-btn"
            disabled={!activeGroup || busyExport !== null}
            onClick={() => void exportActivePdf()}
          >
            {busyExport === 'pdf' ? 'Bezig…' : 'Exporteer PDF'}
          </button>
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            disabled={!groups.length || busyExport !== null}
            onClick={() => void exportAllZip()}
            title="Exporteer alles als zip (Ctrl+E)"
          >
            {busyExport === 'zip' ? 'Bezig…' : 'Exporteer zip'}
          </button>
        </div>
      </div>
    </div>
  )
}
