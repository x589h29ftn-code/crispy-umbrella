import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initSessionPersistence } from './lib/session'
import './styles.css'

initSessionPersistence()

// Safety net: without this, dropping a file outside a designated drop zone
// makes Electron navigate the window away to the dropped file.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
