import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'

async function main(): Promise<void> {
  const server = await createServer({ root: resolve(__dirname, '../src/renderer'), server: { port: 5199, strictPort: true } })
  await server.listen()
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  await page.goto('http://localhost:5199/')
  await page.fill('#seed', 'groene-vallei')
  await page.click('#play')
  await page.waitForTimeout(2500)
  const info = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const v = g.structures.villageSpotFor(-11, -21)
    const h = v ? g.world.height(v.x + 16, v.z + 13) : null
    if (v) g.player.spawn(v.x + 16, v.z + 13)
    return { v, h, pos: { ...g.player.position } }
  })
  console.log('direct:', JSON.stringify(info))
  await page.waitForTimeout(3000)
  const later = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    return { pos: { x: g.player.position.x, y: g.player.position.y, z: g.player.position.z }, swim: g.player.swimming }
  })
  console.log('na 3s:', JSON.stringify(later))
  await browser.close()
  await server.close()
  process.exit(0)
}
void main()
