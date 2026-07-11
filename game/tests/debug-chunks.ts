import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'

async function main(): Promise<void> {
  const server = await createServer({ root: resolve(__dirname, '../src/renderer'), server: { port: 5199, strictPort: true } })
  await server.listen()
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE:', m.text().slice(0, 200)) })
  await page.goto('http://localhost:5199/')
  await page.fill('#seed', 'groene-vallei')
  await page.click('#play')
  await page.waitForTimeout(2500)
  const probe = await page.evaluate(async () => {
    const g = (window as unknown as Record<string, any>).__game
    g.chunks.viewDistance = 8
    g.player.spawn(265, -256)
    const counts: number[] = []
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      counts.push(g.chunks.loadedCount)
    }
    // Meet één handmatige chunkbouw.
    const t0 = performance.now()
    ;(g.chunks as any).loadChunk(3, -6, '3,-6-test')
    const dt = performance.now() - t0
    return { counts, manualMs: dt, queue: (g.chunks as any).queue.length }
  })
  console.log(JSON.stringify(probe))
  await browser.close()
  await server.close()
  process.exit(0)
}
void main()
