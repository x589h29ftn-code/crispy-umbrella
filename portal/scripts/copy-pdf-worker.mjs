// Kopieert de pdf.js-worker naar public/ zodat hij same-origin geladen wordt
// (strikte CSP: geen externe worker-src). Draait als postinstall.
import { copyFile, mkdir, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

async function main() {
  let src
  try {
    // pdfjs-dist v4 levert een ESM-worker mee.
    src = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
  } catch {
    try {
      src = require.resolve('pdfjs-dist/build/pdf.worker.mjs')
    } catch {
      console.warn('[copy-pdf-worker] pdf.js-worker niet gevonden; overslaan.')
      return
    }
  }
  const publicDir = join(dirname(new URL(import.meta.url).pathname), '..', 'public')
  await mkdir(publicDir, { recursive: true })
  const dest = join(publicDir, 'pdf.worker.min.mjs')
  await copyFile(src, dest)
  await access(dest)
  console.log('[copy-pdf-worker] worker gekopieerd naar public/pdf.worker.min.mjs')
}

main().catch((e) => {
  console.warn('[copy-pdf-worker] mislukt (niet fataal):', e?.message ?? e)
})
