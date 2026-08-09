import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import Canvas from './components/Canvas'
import Toasts from './components/Toasts'
import PasswordDialog from './components/PasswordDialog'
import SelectionBar from './components/SelectionBar'
import WhatsNewDialog from './components/WhatsNewDialog'
import UpdateBanner from './components/UpdateBanner'
import TabStrip from './components/TabStrip'
import StatusBar from './components/StatusBar'
import ShortcutsDialog from './components/ShortcutsDialog'
import PreferencesDialog from './components/PreferencesDialog'
import TrashPanel from './components/TrashPanel'
import ImportProgress from './components/ImportProgress'
import { IconPanelLeft } from './components/icons'
import { exportAllZip, saveActiveToSource } from './lib/exportActions'

// Zware overlays worden pas geladen wanneer ze echt geopend worden. Zo blijft
// het opstartscript klein en verschijnt de app sneller in beeld.
const EditorView = lazy(() => import('./components/editor/EditorView'))
const Lightbox = lazy(() => import('./components/Lightbox'))
const SearchPanel = lazy(() => import('./components/SearchPanel'))
const CommentsPanel = lazy(() => import('./components/CommentsPanel'))
const BookmarksPanel = lazy(() => import('./components/BookmarksPanel'))
const RemarkableDialog = lazy(() => import('./components/RemarkableDialog'))
const DrawSignatureDialog = lazy(() => import('./components/DrawSignatureDialog'))
const PrivacyScanDialog = lazy(() => import('./components/PrivacyScanDialog'))
const CompareView = lazy(() => import('./components/CompareView'))
const SmartDialog = lazy(() => import('./components/SmartDialog'))
const TemplatesDialog = lazy(() => import('./components/TemplatesDialog'))
const SigningDialog = lazy(() => import('./components/SigningDialog'))
import { cancelDrag, isDragActive } from './lib/dragController'
import { useStudioStore } from './store'

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Tabbladen op volgorde: het Overzicht staat vooraan (null), daarna de documenten. */
function tabOrder(): (string | null)[] {
  const { editorTabs, groups } = useStudioStore.getState()
  return [null, ...editorTabs.filter((id) => groups.some((g) => g.id === id))]
}

function cycleEditorTab(direction: 1 | -1): void {
  const state = useStudioStore.getState()
  const order = tabOrder()
  if (order.length < 2) return
  const current = order.indexOf(state.activeEditorTab)
  const next = ((current < 0 ? 0 : current) + direction + order.length) % order.length
  state.setActiveEditorTab(order[next])
}

function selectEditorTabByNumber(number: number): void {
  const order = tabOrder()
  const target = order[number - 1]
  if (target !== undefined) useStudioStore.getState().setActiveEditorTab(target)
}

export default function App(): JSX.Element {
  const [zoomPct, setZoomPct] = useState(100)
  const controlsRef = useRef<{ zoomBy: (f: number) => void; zoomTo: (s: number) => void } | null>(null)
  const theme = useStudioStore((s) => s.theme)
  const activeEditorTab = useStudioStore((s) => s.activeEditorTab)
  const presentationMode = useStudioStore((s) => s.presentationMode)
  const readerNightMode = useStudioStore((s) => s.readerNightMode)
  const toolbarHidden = useStudioStore((s) => s.toolbarHidden)
  const setToolbarHidden = useStudioStore((s) => s.setToolbarHidden)

  // Open-vlaggen bepalen welke zware overlay-brokken geladen worden.
  const lightboxOpen = useStudioStore((s) => s.lightbox.open)
  const searchOpen = useStudioStore((s) => s.searchOpen)
  const commentsPanelOpen = useStudioStore((s) => s.commentsPanelOpen)
  const bookmarksPanelOpen = useStudioStore((s) => s.bookmarksPanelOpen)
  const remarkableDialogOpen = useStudioStore((s) => s.remarkableDialogOpen)
  const drawSignatureOpen = useStudioStore((s) => s.drawSignatureOpen)
  const privacyScanOpen = useStudioStore((s) => s.privacyScanOpen)
  const compareOpen = useStudioStore((s) => s.compare.open)
  const smartDialogOpen = useStudioStore((s) => s.smartDialogOpen)
  const templatesDialogOpen = useStudioStore((s) => s.templatesDialogOpen)
  const signingDialogOpen = useStudioStore((s) => s.signingDialogOpen)

  useEffect(() => window.api.onFilesOpened((files) => void useStudioStore.getState().importFiles(files)), [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // Het hoofdproces onthoudt het thema zodat een volgend venster meteen in de
    // juiste kleur opent (geen donkere flits bij een licht thema).
    if (typeof window.api?.setWindowTheme === 'function') window.api.setWindowTheme(theme)
  }, [theme])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (isTypingTarget(e.target)) return
      const state = useStudioStore.getState()
      if (state.passwordRequest) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        state.undo()
      } else if ((mod && key === 'y') || (mod && e.shiftKey && key === 'z')) {
        e.preventDefault()
        state.redo()
      } else if (mod && key === 'f') {
        e.preventDefault()
        state.setSearchOpen(!state.searchOpen)
      } else if (mod && key === 'o') {
        e.preventDefault()
        void window.api.openPdfs().then((files) => {
          if (files.length) void useStudioStore.getState().importFiles(files)
        })
      } else if (mod && key === 'e') {
        e.preventDefault()
        void exportAllZip()
      } else if (mod && key === 's') {
        e.preventDefault()
        void saveActiveToSource()
      } else if (!mod && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
        e.preventDefault()
        state.setShortcutsOpen(!state.shortcutsOpen)
      } else if (mod && key === 'p') {
        e.preventDefault()
        void import('./lib/printActions').then((m) => m.printActiveGroup())
      } else if (mod && key === 'w') {
        e.preventDefault()
        if (state.activeEditorTab) state.closeEditorTab(state.activeEditorTab)
      } else if (mod && e.key === 'Tab') {
        e.preventDefault()
        cycleEditorTab(e.shiftKey ? -1 : 1)
      } else if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        selectEditorTabByNumber(Number(e.key))
      } else if (mod && key === 'a') {
        e.preventDefault()
        if (!state.lightbox.open && !state.activeEditorTab) state.selectAllPages()
      } else if (mod && key === 'd') {
        e.preventDefault()
        if (!state.lightbox.open && !state.activeEditorTab) state.duplicatePages([...state.selectedPageIds])
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !state.lightbox.open && !state.activeEditorTab) {
        state.deletePages([...state.selectedPageIds])
      } else if (key === 'r' && !mod && !state.lightbox.open && !state.activeEditorTab) {
        state.rotatePages([...state.selectedPageIds])
      } else if (e.key === 'Escape' && isDragActive()) {
        cancelDrag()
      } else if (e.key === 'Escape' && !state.lightbox.open) {
        state.clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onScaleChange = useCallback((scale: number) => {
    setZoomPct(Math.round(scale * 100))
  }, [])

  const registerZoomControls = useCallback(
    (controls: { zoomBy: (f: number) => void; zoomTo: (s: number) => void }) => {
      controlsRef.current = controls
    },
    []
  )

  return (
    <div className={`app${presentationMode ? ' app--presentation' : ''}${readerNightMode ? ' app--night' : ''}`}>
      {!toolbarHidden && (
        <Toolbar
          zoomPct={zoomPct}
          onZoomIn={() => controlsRef.current?.zoomBy(1.2)}
          onZoomOut={() => controlsRef.current?.zoomBy(1 / 1.2)}
          onZoomReset={() => controlsRef.current?.zoomTo(1)}
          onZoomTo={(scale) => controlsRef.current?.zoomTo(scale)}
        />
      )}
      {toolbarHidden && (
        <button
          type="button"
          className="toolbar-restore"
          onClick={() => setToolbarHidden(false)}
          title="Werkbalk tonen"
          aria-label="Werkbalk tonen"
        >
          <IconPanelLeft size={16} />
          <span className="toolbar-restore__label">Werkbalk</span>
        </button>
      )}
      <main className="app-main">
        <TabStrip />
        {activeEditorTab ? (
          <Suspense fallback={null}>
            <EditorView groupId={activeEditorTab} />
          </Suspense>
        ) : (
          <Canvas onScaleChange={onScaleChange} registerZoomControls={registerZoomControls} />
        )}
        <Suspense fallback={null}>
          {searchOpen && <SearchPanel />}
          {commentsPanelOpen && <CommentsPanel />}
          {bookmarksPanelOpen && <BookmarksPanel />}
        </Suspense>
        <StatusBar />
      </main>
      <Suspense fallback={null}>
        {lightboxOpen && <Lightbox />}
        {remarkableDialogOpen && <RemarkableDialog />}
        {drawSignatureOpen && <DrawSignatureDialog />}
        {privacyScanOpen && <PrivacyScanDialog />}
        {compareOpen && <CompareView />}
        {smartDialogOpen && <SmartDialog />}
        {templatesDialogOpen && <TemplatesDialog />}
        {signingDialogOpen && <SigningDialog />}
      </Suspense>
      <ImportProgress />
      <SelectionBar />
      <PasswordDialog />
      <WhatsNewDialog />
      <UpdateBanner />
      <ShortcutsDialog />
      <PreferencesDialog />
      <TrashPanel />
      <Toasts />
    </div>
  )
}
