import { useCallback, useEffect, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import Canvas from './components/Canvas'
import Lightbox from './components/Lightbox'
import Toasts from './components/Toasts'
import PasswordDialog from './components/PasswordDialog'
import SelectionBar from './components/SelectionBar'
import SearchPanel from './components/SearchPanel'
import CommentsPanel from './components/CommentsPanel'
import TabStrip from './components/TabStrip'
import EditorView from './components/editor/EditorView'
import { exportAllZip } from './lib/exportActions'
import { printActiveGroup } from './lib/printActions'
import { cancelDrag, isDragActive } from './lib/dragController'
import { useStudioStore } from './store'

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export default function App(): JSX.Element {
  const [zoomPct, setZoomPct] = useState(100)
  const controlsRef = useRef<{ zoomBy: (f: number) => void; zoomTo: (s: number) => void } | null>(null)
  const theme = useStudioStore((s) => s.theme)
  const activeEditorTab = useStudioStore((s) => s.activeEditorTab)

  useEffect(() => window.api.onFilesOpened((files) => void useStudioStore.getState().importFiles(files)), [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
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
      } else if (mod && key === 'p') {
        e.preventDefault()
        void printActiveGroup()
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
    <div className="app">
      <Toolbar
        zoomPct={zoomPct}
        onZoomIn={() => controlsRef.current?.zoomBy(1.2)}
        onZoomOut={() => controlsRef.current?.zoomBy(1 / 1.2)}
        onZoomReset={() => controlsRef.current?.zoomTo(1)}
        onZoomTo={(scale) => controlsRef.current?.zoomTo(scale)}
      />
      <main className="app-main">
        <TabStrip />
        {activeEditorTab ? (
          <EditorView groupId={activeEditorTab} />
        ) : (
          <Canvas onScaleChange={onScaleChange} registerZoomControls={registerZoomControls} />
        )}
        <SearchPanel />
        <CommentsPanel />
      </main>
      <Lightbox />
      <SelectionBar />
      <PasswordDialog />
      <Toasts />
    </div>
  )
}
