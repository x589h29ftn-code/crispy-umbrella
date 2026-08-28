import { useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import AppMenu from './AppMenu'
import { useClickOutside } from '../hooks/useClickOutside'
import { useAnchoredFlyout } from '../hooks/useAnchoredFlyout'
import { mergeRefs } from '../lib/mergeRefs'
import { exportActivePdf, exportAllZip, mailActivePdf, saveActiveToOneDrive } from '../lib/exportActions'
import {
  IconArchive,
  IconCheck,
  IconCloud,
  IconCompare,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconBookmark,
  IconComment,
  IconDownload,
  IconExpand,
  IconFolderOpen,
  IconForm,
  IconLock,
  IconMail,
  IconMinus,
  IconPen,
  IconMoon,
  IconPlus,
  IconPrinter,
  IconRemarkable,
  IconRedo,
  IconSearch,
  IconShield,
  IconSignature,
  IconStamp,
  IconSparkles,
  IconSun,
  IconSettings,
  IconKeyboard,
  IconTrash,
  IconUndo
} from './icons'

interface Props {
  zoomPct: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onZoomTo: (scale: number) => void
}

const SIDEBAR_STORAGE_KEY = 'pdf-studio-sidebar-collapsed'

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

export default function Toolbar({ zoomPct, onZoomIn, onZoomOut, onZoomReset, onZoomTo }: Props): JSX.Element {
  const groups = useStudioStore((s) => s.groups)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const importFiles = useStudioStore((s) => s.importFiles)
  const signatureAssets = useStudioStore((s) => s.signatureAssets)
  const activeSignatureId = useStudioStore((s) => s.activeSignatureId)
  const addSignatureAsset = useStudioStore((s) => s.addSignatureAsset)
  const removeSignatureAsset = useStudioStore((s) => s.removeSignatureAsset)
  const setActiveSignature = useStudioStore((s) => s.setActiveSignature)
  const theme = useStudioStore((s) => s.theme)
  const toggleTheme = useStudioStore((s) => s.toggleTheme)
  const canUndo = useStudioStore((s) => s.past.length > 0)
  const canRedo = useStudioStore((s) => s.future.length > 0)
  const undo = useStudioStore((s) => s.undo)
  const redo = useStudioStore((s) => s.redo)
  const busyExport = useStudioStore((s) => s.busyExport)
  const searchOpen = useStudioStore((s) => s.searchOpen)
  const setSearchOpen = useStudioStore((s) => s.setSearchOpen)
  const commentsPanelOpen = useStudioStore((s) => s.commentsPanelOpen)
  const setCommentsPanelOpen = useStudioStore((s) => s.setCommentsPanelOpen)
  const bookmarksPanelOpen = useStudioStore((s) => s.bookmarksPanelOpen)
  const setBookmarksPanelOpen = useStudioStore((s) => s.setBookmarksPanelOpen)
  const openCommentCount = useStudioStore((s) =>
    s.groups.reduce((n, g) => n + g.pages.reduce((m, p) => m + p.comments.filter((c) => !c.resolved).length, 0), 0)
  )
  const exportPassword = useStudioStore((s) => s.exportPassword)
  const setExportPassword = useStudioStore((s) => s.setExportPassword)
  const exportPermissions = useStudioStore((s) => s.exportPermissions)
  const setExportPermissions = useStudioStore((s) => s.setExportPermissions)
  const setDrawSignatureOpen = useStudioStore((s) => s.setDrawSignatureOpen)
  const openCompare = useStudioStore((s) => s.openCompare)
  const setPrivacyScanOpen = useStudioStore((s) => s.setPrivacyScanOpen)
  const setSmartDialogOpen = useStudioStore((s) => s.setSmartDialogOpen)
  const setTemplatesDialogOpen = useStudioStore((s) => s.setTemplatesDialogOpen)
  const setSigningDialogOpen = useStudioStore((s) => s.setSigningDialogOpen)
  const setShortcutsOpen = useStudioStore((s) => s.setShortcutsOpen)
  const setPreferencesOpen = useStudioStore((s) => s.setPreferencesOpen)
  const setTrashPanelOpen = useStudioStore((s) => s.setTrashPanelOpen)
  const setToolbarHidden = useStudioStore((s) => s.setToolbarHidden)
  const trashCount = useStudioStore((s) => s.trash.length)
  const fullToolbar = useStudioStore((s) => s.fullToolbar)
  // In een leestabblad hoort de zoomrij bij het document, niet bij het overzicht;
  // anders lijkt de balk kapot zodra je met Ctrl+scrollen inzoomt.
  const activeEditorTab = useStudioStore((s) => s.activeEditorTab)
  const editorZoom = useStudioStore((s) => s.editorZoom)
  const setEditorZoom = useStudioStore((s) => s.setEditorZoom)
  const readingZoom = activeEditorTab !== null
  const shownZoomPct = readingZoom ? Math.round(editorZoom * 100) : zoomPct
  const zoomOut = (): void => (readingZoom ? setEditorZoom((z) => z / 1.2) : onZoomOut())
  const zoomIn = (): void => (readingZoom ? setEditorZoom((z) => z * 1.2) : onZoomIn())
  const zoomReset = (): void => (readingZoom ? setEditorZoom(1) : onZoomReset())
  const zoomTo = (scale: number): void => (readingZoom ? setEditorZoom(scale) : onZoomTo(scale))
  const [showPasswordField, setShowPasswordField] = useState(false)
  const [sigMenuOpen, setSigMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1')
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const sigMenuRef = useRef<HTMLDivElement>(null)
  const passwordRef = useRef<HTMLDivElement>(null)

  useClickOutside(sigMenuRef, sigMenuOpen, () => setSigMenuOpen(false))
  useClickOutside(passwordRef, showPasswordField, () => setShowPasswordField(false))

  // De uitklapmenu's hangen in het schuifbare deel van de zijbalk en worden
  // daarom ten opzichte van het venster geplaatst.
  const sigFlyout = useAnchoredFlyout(sigMenuOpen)
  const passwordFlyout = useAnchoredFlyout(showPasswordField)
  const sigWrapRef = useMemo(() => mergeRefs(sigMenuRef, sigFlyout.anchorRef), [sigFlyout.anchorRef])
  const passwordWrapRef = useMemo(() => mergeRefs(passwordRef, passwordFlyout.anchorRef), [passwordFlyout.anchorRef])

  const pageTotal = groups.reduce((n, g) => n + g.pages.length, 0)
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]

  function toggleCollapsed(): void {
    setCollapsed((v) => {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, v ? '0' : '1')
      return !v
    })
  }

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
      addSignatureAsset({
        id: nanoid(),
        name: file.name.replace(/\.(png|jpe?g)$/i, ''),
        dataUrl,
        mimeType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        naturalWidth: width,
        naturalHeight: height
      })
    } catch {
      useStudioStore.getState().addToast('error', 'Kon de handtekening-afbeelding niet laden')
    }
  }

  const summary =
    groups.length === 0
      ? 'Geen documenten'
      : `${groups.length} ${groups.length === 1 ? 'document' : 'documenten'} · ${pageTotal} ${
          pageTotal === 1 ? 'pagina' : "pagina's"
        }`

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__top">
        <AppMenu />
        {!collapsed && (
          <button
            type="button"
            className="icon-btn icon-btn--chrome sidebar__collapse"
            onClick={() => setToolbarHidden(true)}
            title="Werkbalk verbergen (meer documentruimte)"
          >
            <IconClose size={14} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn icon-btn--chrome sidebar__collapse"
          onClick={toggleCollapsed}
          title={collapsed ? 'Menu uitklappen' : 'Menu inklappen'}
        >
          {collapsed ? <IconChevronRight size={15} /> : <IconChevronLeft size={15} />}
        </button>
      </div>

      {!collapsed && <div className="sidebar__summary">{summary}</div>}

      <div className="sidebar__row">
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

      <div className="sidebar__row">
        <button
          type="button"
          className="pill-btn pill-btn--icon"
          onClick={zoomOut}
          title={readingZoom ? 'Uitzoomen in het document' : 'Uitzoomen in het overzicht'}
        >
          <IconMinus size={14} />
        </button>
        {!collapsed && (
          <button
            type="button"
            className="toolbar__zoom-pct"
            onClick={zoomReset}
            title={readingZoom ? 'Zoom van het document herstellen' : 'Zoom van het overzicht herstellen (100%)'}
          >
            {shownZoomPct}%
          </button>
        )}
        <button
          type="button"
          className="pill-btn pill-btn--icon"
          onClick={zoomIn}
          title={readingZoom ? 'Inzoomen in het document' : 'Inzoomen in het overzicht'}
        >
          <IconPlus size={14} />
        </button>
      </div>

      {!collapsed && (
        <input
          type="range"
          className="sidebar__zoom-slider"
          min={25}
          max={500}
          step={5}
          value={Math.min(500, Math.max(25, shownZoomPct))}
          title={readingZoom ? 'Zoom van het document' : 'Zoom van het overzicht'}
          onChange={(e) => zoomTo(Number(e.target.value) / 100)}
        />
      )}

      {/* Alles hieronder schuift mee, zodat de zijbalk ook in een klein venster
          volledig bereikbaar blijft; exporteren en Voorkeuren staan vast onderaan. */}
      <div className="sidebar__scroll">
        <SidebarSection title="Bestand" collapsed={collapsed}>
          <button type="button" className="sidebar-btn tone-blue" onClick={() => void handleOpen()} title="Openen (Ctrl+O)">
            <IconFolderOpen size={15} />
            <span className="sidebar-btn__label">Openen</span>
          </button>
          {fullToolbar && (
            <button
              type="button"
              className="sidebar-btn tone-slate"
              disabled={!activeGroup}
              onClick={() => void import('../lib/printActions').then((m) => m.printActiveGroup())}
              title="Druk het actieve document af (Ctrl+P)"
            >
              <IconPrinter size={15} />
              <span className="sidebar-btn__label">Afdrukken</span>
            </button>
          )}
        </SidebarSection>

        <SidebarSection title="Bekijken" collapsed={collapsed}>
          <button
            type="button"
            className={`sidebar-btn tone-slate${searchOpen ? ' sidebar-btn--active' : ''}`}
            onClick={() => setSearchOpen(!searchOpen)}
            title="Zoeken in alle documenten (Ctrl+F)"
          >
            <IconSearch size={15} />
            <span className="sidebar-btn__label">Zoeken</span>
          </button>

          <button
            type="button"
            className={`sidebar-btn tone-amber${commentsPanelOpen ? ' sidebar-btn--active' : ''}`}
            onClick={() => setCommentsPanelOpen(!commentsPanelOpen)}
            title="Tijdlijn van alle opmerkingen"
          >
            <IconComment size={15} />
            <span className="sidebar-btn__label">Opmerkingen</span>
            {openCommentCount > 0 && <span className="sidebar-btn__badge">{openCommentCount}</span>}
          </button>

          <button
            type="button"
            className={`sidebar-btn tone-teal${bookmarksPanelOpen ? ' sidebar-btn--active' : ''}`}
            onClick={() => setBookmarksPanelOpen(!bookmarksPanelOpen)}
            title="Bladwijzers / inhoudsopgave van de documenten"
          >
            <IconBookmark size={15} />
            <span className="sidebar-btn__label">Bladwijzers</span>
          </button>

          {/* Vergelijken is dagelijks werk (concept naast definitief), dus altijd in beeld. */}
          <button
            type="button"
            className="sidebar-btn tone-violet"
            disabled={groups.length < 1}
            onClick={openCompare}
            title="Twee documenten (of versies) naast elkaar vergelijken"
          >
            <IconCompare size={15} />
            <span className="sidebar-btn__label">Vergelijken</span>
          </button>
        </SidebarSection>

        <SidebarSection title="Documenten" collapsed={collapsed}>
          <button
            type="button"
            className="sidebar-btn tone-violet"
            disabled={!activeGroup}
            onClick={() => setSmartDialogOpen(true)}
            title="Slimme documenten: ordenen (hernoemen, sorteren, splitsen, dossier), opschonen (lege pagina's, scans, comprimeren) en eruit halen (Markdown, Word, Excel, CSV)"
          >
            <IconSparkles size={15} />
            <span className="sidebar-btn__label">Slim</span>
          </button>

          <button
            type="button"
            className="sidebar-btn tone-blue"
            onClick={() => setTemplatesDialogOpen(true)}
            title="Documentsjablonen: Word-sjablonen met {variabelen} invullen en genereren naar Word of PDF"
          >
            <IconForm size={15} />
            <span className="sidebar-btn__label">Sjablonen</span>
          </button>

          <button
            type="button"
            className="sidebar-btn tone-green"
            onClick={() => setSigningDialogOpen(true)}
            title="Ondertekenen: zelf tekenen of een tweede partij laten tekenen, verzenden en herinneren"
          >
            <IconStamp size={15} />
            <span className="sidebar-btn__label">Ondertekenen</span>
          </button>

          {fullToolbar && (
            <button
              type="button"
              className="sidebar-btn tone-red"
              disabled={!activeGroup}
              onClick={() => setPrivacyScanOpen(true)}
              title="Privacy-scan (AVG): vind BSN, IBAN, e-mail en telefoon om te redigeren"
            >
              <IconShield size={15} />
              <span className="sidebar-btn__label">Privacy-scan</span>
            </button>
          )}

          <div className="sidebar__flyout-wrap" ref={sigWrapRef}>
            <input
              ref={signatureInputRef}
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: 'none' }}
              onChange={(e) => void handleSignatureFile(e)}
            />
            <button
              type="button"
              className={`sidebar-btn${signatureAssets.length ? ' sidebar-btn--active' : ''}`}
              onClick={() => setSigMenuOpen((v) => !v)}
              title="Handtekeningen laden, tekenen en beheren"
            >
              <IconSignature size={15} />
              <span className="sidebar-btn__label">
                {signatureAssets.length > 1 ? 'Handtekeningen' : 'Handtekening'}
              </span>
              {signatureAssets.length > 0 && <span className="sidebar-btn__badge">{signatureAssets.length}</span>}
            </button>
            {sigMenuOpen && (
              <div
                ref={sigFlyout.flyoutRef}
                style={sigFlyout.style}
                className="dropdown-menu sidebar__flyout sidebar__flyout--anchored signature-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="signature-menu__hint">Actieve handtekening sleep je in het volledig scherm op de pagina.</div>
                {signatureAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`signature-menu__item${asset.id === activeSignatureId ? ' signature-menu__item--active' : ''}`}
                    onClick={() => setActiveSignature(asset.id)}
                    title="Klik om deze handtekening actief te maken"
                  >
                    <img src={asset.dataUrl} alt={asset.name} draggable={false} />
                    <span className="signature-menu__name">{asset.name}</span>
                    {asset.id === activeSignatureId && <IconCheck size={13} className="dropdown-menu__check" />}
                    <button
                      type="button"
                      className="icon-btn icon-btn--chrome icon-btn--danger"
                      title="Handtekening verwijderen"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeSignatureAsset(asset.id)
                      }}
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="dropdown-menu__item"
                  onClick={() => signatureInputRef.current?.click()}
                >
                  <IconPlus size={14} />
                  Afbeelding laden…
                </button>
                <button
                  type="button"
                  className="dropdown-menu__item"
                  onClick={() => {
                    setSigMenuOpen(false)
                    setDrawSignatureOpen(true)
                  }}
                >
                  <IconPen size={14} />
                  Handtekening tekenen…
                </button>
              </div>
            )}
          </div>

          {fullToolbar && (
            <div className="sidebar__flyout-wrap" ref={passwordWrapRef}>
              <button
                type="button"
                className={`sidebar-btn${exportPassword ? ' sidebar-btn--active' : ''}`}
                onClick={() => setShowPasswordField((v) => !v)}
                title="Wachtwoord instellen voor geëxporteerde PDF's"
              >
                <IconLock size={15} />
                <span className="sidebar-btn__label">Wachtwoord</span>
              </button>
              {showPasswordField && (
                <div
                  ref={passwordFlyout.flyoutRef}
                  style={passwordFlyout.style}
                  className="dropdown-menu sidebar__flyout sidebar__flyout--anchored sidebar__password-flyout"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    type="password"
                    className="sidebar__password-input"
                    placeholder="Wachtwoord voor export"
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') setShowPasswordField(false)
                    }}
                  />
                  <div className="sidebar__password-perms">
                    <div className="sidebar__password-perms-title">Rechten voor de ontvanger</div>
                    {([
                      ['printing', 'Afdrukken toestaan'],
                      ['copying', 'Tekst kopiëren toestaan'],
                      ['modifying', 'Bewerken toestaan']
                    ] as const).map(([key, label]) => (
                      <label key={key} className="sidebar__password-perm">
                        <input
                          type="checkbox"
                          checked={exportPermissions[key]}
                          onChange={(e) => setExportPermissions({ [key]: e.target.checked })}
                        />
                        {label}
                      </label>
                    ))}
                    <div className="sidebar__password-hint">
                      Beperkingen worden bij export met encryptie afgedwongen (ook zonder wachtwoord).
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </SidebarSection>

        {fullToolbar && (
          <SidebarSection title="Delen" collapsed={collapsed}>
            <button
              type="button"
              className="sidebar-btn tone-teal"
              disabled={!activeGroup}
              onClick={() => void import('../lib/remarkableActions').then((m) => m.shareActiveToRemarkable())}
              title="Deel het actieve document met je reMarkable-cloud (map &quot;PDF Studio&quot;)"
            >
              <IconRemarkable size={15} />
              <span className="sidebar-btn__label">Deel met reMarkable</span>
            </button>
            <button
              type="button"
              className="sidebar-btn tone-teal"
              disabled={!activeGroup}
              onClick={() =>
                activeGroup &&
                void import('../lib/detachWindow').then((m) => m.openDocumentInNewWindow(activeGroup.id))
              }
              title="Open het actieve document in een eigen venster"
            >
              <IconExpand size={15} />
              <span className="sidebar-btn__label">Los venster</span>
            </button>
            <button
              type="button"
              className="sidebar-btn tone-teal"
              disabled={!activeGroup || busyExport !== null}
              onClick={() => void saveActiveToOneDrive()}
              title="Sla het actieve document op in je OneDrive-map (synct automatisch)"
            >
              <IconCloud size={15} />
              <span className="sidebar-btn__label">Opslaan in OneDrive</span>
            </button>
            <button
              type="button"
              className="sidebar-btn tone-teal"
              disabled={!activeGroup || busyExport !== null}
              onClick={() => void mailActivePdf()}
              title="Open een nieuw Outlook-bericht met het actieve document als bijlage"
            >
              <IconMail size={15} />
              <span className="sidebar-btn__label">Mail als bijlage</span>
            </button>
          </SidebarSection>
        )}

        <SidebarSection title="Extra" collapsed={collapsed}>
          <button
            type="button"
            className="sidebar-btn tone-red"
            onClick={() => setTrashPanelOpen(true)}
            title="Prullenbak: verwijderde pagina's terughalen"
          >
            <IconTrash size={15} />
            <span className="sidebar-btn__label">Prullenbak{trashCount > 0 ? ` (${trashCount})` : ''}</span>
          </button>
          {fullToolbar && (
            <button
              type="button"
              className="sidebar-btn tone-slate"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
            >
              {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
              <span className="sidebar-btn__label">{theme === 'dark' ? 'Licht thema' : 'Donker thema'}</span>
            </button>
          )}
          {fullToolbar && (
            <button
              type="button"
              className="sidebar-btn tone-slate"
              onClick={() => setShortcutsOpen(true)}
              title="Sneltoetsen-overzicht (?)"
            >
              <IconKeyboard size={15} />
              <span className="sidebar-btn__label">Sneltoetsen</span>
            </button>
          )}
        </SidebarSection>

        {/* Kort houden: bij een venster van 768 px hoog werd een langere tekst
            middenin de zin afgekapt. De uitleg staat in de tooltip. */}
        {!fullToolbar && !collapsed && (
          <p
            className="sidebar__hint"
            title="Liever alles in de zijbalk? Zet “Volledige werkbalk” aan bij Voorkeuren."
          >
            Meer acties in <strong>Menu</strong> linksboven.
          </p>
        )}
      </div>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar-btn tone-blue"
          disabled={!activeGroup || busyExport !== null}
          onClick={() => void exportActivePdf()}
          title="Exporteer het actieve document als PDF"
        >
          <IconDownload size={15} />
          <span className="sidebar-btn__label">{busyExport === 'pdf' ? 'Bezig…' : 'Exporteer PDF'}</span>
        </button>
        <button
          type="button"
          className="sidebar-btn sidebar-btn--primary tone-blue"
          disabled={!groups.length || busyExport !== null}
          onClick={() => void exportAllZip()}
          title="Exporteer alles als zip (Ctrl+E)"
        >
          <IconArchive size={15} />
          <span className="sidebar-btn__label">{busyExport === 'zip' ? 'Bezig…' : 'Exporteer zip'}</span>
        </button>
        <button type="button" className="sidebar-btn tone-slate" onClick={() => setPreferencesOpen(true)} title="Voorkeuren">
          <IconSettings size={15} />
          <span className="sidebar-btn__label">Voorkeuren</span>
        </button>
      </div>
    </aside>
  )
}

/** Groepje zijbalkknoppen met een kopje; ingeklapt blijft alleen een streepje over. */
function SidebarSection({
  title,
  collapsed,
  children
}: {
  title: string
  collapsed: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="sidebar__section">
      {collapsed ? <div className="sidebar__divider" /> : <div className="sidebar__section-title">{title}</div>}
      {children}
    </div>
  )
}
