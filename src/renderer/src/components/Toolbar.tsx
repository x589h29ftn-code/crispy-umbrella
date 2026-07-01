import { useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { exportGroupToPdf } from '../lib/pdfEngine'
import { zipSync } from 'fflate'

interface Props {
  zoomPct: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
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
  const sources = useStudioStore((s) => s.sources)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const importFiles = useStudioStore((s) => s.importFiles)
  const signatureAsset = useStudioStore((s) => s.signatureAsset)
  const setSignatureAsset = useStudioStore((s) => s.setSignatureAsset)
  const [busy, setBusy] = useState<string | null>(null)
  const [showPasswordField, setShowPasswordField] = useState(false)
  const [password, setPassword] = useState('')
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
    const { dataUrl, width, height } = await readImageFile(file)
    setSignatureAsset({
      dataUrl,
      mimeType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      naturalWidth: width,
      naturalHeight: height
    })
  }

  async function maybeEncrypt(bytes: Uint8Array): Promise<Uint8Array> {
    if (!password.trim()) return bytes
    return window.api.encryptPdf(bytes, password.trim())
  }

  async function handleExportPdf(): Promise<void> {
    if (!activeGroup) return
    setBusy('pdf')
    try {
      const bytes = await maybeEncrypt(await exportGroupToPdf(activeGroup, sources))
      await window.api.savePdf(`${activeGroup.name}.pdf`, bytes)
    } finally {
      setBusy(null)
    }
  }

  async function handleExportZip(): Promise<void> {
    if (!groups.length) return
    setBusy('zip')
    try {
      const files: Record<string, Uint8Array> = {}
      const usedNames = new Set<string>()
      for (const group of groups) {
        if (!group.pages.length) continue
        const bytes = await maybeEncrypt(await exportGroupToPdf(group, sources))
        let fileName = `${sanitizeFileName(group.name)}.pdf`
        let n = 2
        while (usedNames.has(fileName)) {
          fileName = `${sanitizeFileName(group.name)} (${n}).pdf`
          n += 1
        }
        usedNames.add(fileName)
        files[fileName] = bytes
      }
      const zipBytes = zipSync(files, { level: 6 })
      await window.api.saveZip('PDF-Studio-export.zip', zipBytes)
    } finally {
      setBusy(null)
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
          {signatureAsset ? 'Handtekening geladen' : 'Handtekening'}
        </button>
        {signatureAsset && (
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            title="Handtekening wissen"
            onClick={() => setSignatureAsset(null)}
          >
            ✕
          </button>
        )}

        <div className="toolbar__password">
          <button
            type="button"
            className={`pill-btn${password ? ' pill-btn--active' : ''}`}
            onClick={() => setShowPasswordField((v) => !v)}
            title="Wachtwoord instellen voor geëxporteerde PDF's"
          >
            Wachtwoord
          </button>
          {showPasswordField && (
            <input
              type="password"
              className="toolbar__password-input"
              placeholder="Wachtwoord voor export"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </div>

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
