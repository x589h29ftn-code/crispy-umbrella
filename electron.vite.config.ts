import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          // Splits de zware bibliotheken in aparte brokken zodat het
          // hoofdscript klein blijft en de app sneller opstart.
          manualChunks: {
            pdfjs: ['pdfjs-dist'],
            pdflib: ['@cantoo/pdf-lib', '@pdf-lib/fontkit'],
            react: ['react', 'react-dom', 'zustand']
          }
        }
      }
    }
  }
})
