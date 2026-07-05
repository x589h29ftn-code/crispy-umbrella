import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initSessionPersistence } from './lib/session'
import { consumeHandoffIfPresent, isHandoffWindow } from './lib/detachWindow'
import './styles.css'

// Een los venster laadt alleen het doorgegeven document en raakt de gedeelde
// sessie niet aan; een normaal venster herstelt en bewaart de sessie.
if (isHandoffWindow()) {
  void consumeHandoffIfPresent()
} else {
  initSessionPersistence()
}

// Safety net: without this, dropping a file outside a designated drop zone
// makes Electron navigate the window away to the dropped file.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
