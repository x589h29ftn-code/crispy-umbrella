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
  await page.goto('http://localhost:5199/')
  await page.fill('#seed', 'groene-vallei')
  await page.click('#play')
  await page.waitForTimeout(2500)
  const probe = await page.evaluate(`(async () => {
    const g = window.__game
    // rAF-tempo meten.
    let frames = 0
    function cb() {
      frames++
      requestAnimationFrame(cb)
    }
    requestAnimationFrame(cb)
    await new Promise((r) => setTimeout(r, 3000))
    const rafPerSec = frames / 3

    // Duur van de zware frame-onderdelen meten.
    const t1 = performance.now()
    g.chunks.update(g.player.position.x, g.player.position.z, 6)
    const chunksMs = performance.now() - t1
    const t2 = performance.now()
    g.graphics.render()
    const renderMs = performance.now() - t2
    const t3 = performance.now()
    g.water.update(0.016, g.player.position.x, g.player.position.z)
    const waterMs = performance.now() - t3
    return { rafPerSec, chunksMs, renderMs, waterMs }
  })()`)
  console.log(JSON.stringify(probe))
  await browser.close()
  await server.close()
  process.exit(0)
}
void main()
