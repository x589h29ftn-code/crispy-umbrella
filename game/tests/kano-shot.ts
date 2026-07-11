// Hertake van de kano-shot: drijvende kano bij de steiger, kijkend over de
// boeg. Draaien: npx tsx tests/kano-shot.ts

import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'
import { writeFileSync } from 'fs'

const SEED = 'groene-vallei'

async function main(): Promise<void> {
  const server = await createServer({
    root: resolve(__dirname, '../src/renderer'),
    server: { port: 5197, strictPort: true }
  })
  await server.listen()
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio']
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

  await page.goto('http://localhost:5197/')
  await page.fill('#seed', SEED)
  await page.click('#play')
  await page.waitForTimeout(2500)
  const info = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    g.sky.timeOfDay = 0.38
    g.chunks.viewDistance = 8
    const w = g.weather
    w.kind = 'helder'
    w.targetRain = 0
    w.targetCloud = 0.12
    w.intensity = 0
    w.cloudiness = 0.12
    w.timer = 600
    const canoe =
      g.boats.canoes.find((c: { x: number; z: number }) => g.world.height(c.x, c.z) < -0.5) ?? g.boats.canoes[0]
    if (!canoe) return null
    // Fotomodus: de afgemeerde kano in de voorgrond, steiger en meerhuisje
    // op de achtergrond.
    const lh = g.structures.lakeHouse ?? { x: canoe.x + 10, z: canoe.z }
    g.player.spawn(canoe.x, canoe.z)
    g.photoMode = true
    const dx = lh.x - canoe.x
    const dz = lh.z - canoe.z
    const len = Math.hypot(dx, dz)
    const camX = canoe.x - (dx / len) * 8
    const camZ = canoe.z - (dz / len) * 8
    g.photoPos.set(camX, 2.6, camZ)
    g.player.yaw = Math.atan2(-(canoe.x - camX), -(canoe.z - camZ))
    g.player.pitch = -0.18
    return { x: Math.round(canoe.x), z: Math.round(canoe.z), diepte: g.world.height(canoe.x, canoe.z) }
  })
  console.log('Kano:', JSON.stringify(info))
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const p = g.player.position
    g.chunks.update(p.x, p.z, 300000)
    for (let i = 0; i < 20; i++) g.frame(1 / 30)
  })
  const dataUrl = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    g.frame(1 / 30)
    return g.graphics.renderer.domElement.toDataURL('image/png') as string
  })
  writeFileSync(resolve(__dirname, 'v15-kano.png'), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('Screenshot: v15-kano.png')

  await browser.close()
  await server.close()
  process.exit(0)
}

void main()
