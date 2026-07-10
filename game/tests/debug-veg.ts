// Debughulp: telt vegetatie-instances rond de speler en maakt een screenshot
// terwijl de camera schuin omlaag kijkt. Draaien met: npx tsx tests/debug-veg.ts

import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'

async function main(): Promise<void> {
  const server = await createServer({
    root: resolve(__dirname, '../src/renderer'),
    server: { port: 5199, strictPort: true }
  })
  await server.listen()

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio']
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

  await page.goto('http://localhost:5199/')
  await page.fill('#seed', 'smoke-test-wereld')
  await page.click('#play')
  await page.waitForTimeout(4000)

  const stats = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const p = g.player.position
    const out: Record<string, { meshes: number; instances: number; nearInstances: number }> = {}
    const m4 = { elements: null as unknown as Float32Array }
    g.scene.traverse((obj: any) => {
      if (!obj.isInstancedMesh || !obj.name.startsWith('veg:')) return
      const label = obj.name.split(':')[1]
      out[label] ??= { meshes: 0, instances: 0, nearInstances: 0 }
      out[label].meshes++
      out[label].instances += obj.count
      const arr = obj.instanceMatrix.array
      for (let i = 0; i < obj.count; i++) {
        const x = arr[i * 16 + 12]
        const z = arr[i * 16 + 14]
        const dx = x - p.x
        const dz = z - p.z
        if (dx * dx + dz * dz < 15 * 15) out[label].nearInstances++
      }
    })
    return { player: { x: p.x, y: p.y, z: p.z }, out }
  })
  console.log(JSON.stringify(stats, null, 2))

  // Schuin omlaag kijken voor een close-up van het grasdek.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    g.player.pitch = -0.55
    g.player.yaw = 2.2
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: resolve(__dirname, 'screenshot-debug.png') })

  await browser.close()
  await server.close()
  process.exit(0)
}

void main()
