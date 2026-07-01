import { useCallback, useEffect, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import Canvas from './components/Canvas'
import Lightbox from './components/Lightbox'
import { useStudioStore } from './store'

export default function App(): JSX.Element {
  const [zoomPct, setZoomPct] = useState(100)
  const controlsRef = useRef<{ zoomBy: (f: number) => void; zoomTo: (s: number) => void } | null>(null)

  useEffect(() => window.api.onFilesOpened((files) => void useStudioStore.getState().importFiles(files)), [])

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
      />
      <Canvas onScaleChange={onScaleChange} registerZoomControls={registerZoomControls} />
      <Lightbox />
    </div>
  )
}
