// Reviewshots v1.6: reuzeneik op de weide + vernieuwde bos-details.
// Draaien: npx tsx tests/shots-v16.ts

import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'
import { writeFileSync } from 'fs'

const SEED = 'groene-vallei'

async function main(): Promise<void> {
  const server = await createServer({
    root: resolve(__dirname, '../src/renderer'),
    server: { port: 5196, strictPort: true }
  })
  await server.listen()
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio']
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

  await page.goto('http://localhost:5196/')
  await page.fill('#seed', SEED)
  await page.click('#play')
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
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
  })

  const settle = async (frames = 8): Promise<void> => {
    await page.evaluate((n) => {
      const g = (window as unknown as Record<string, any>).__game
      const p = g.player.position
      g.chunks.update(p.x, p.z, 300000)
      for (let i = 0; i < n; i++) g.frame(1 / 30)
    }, frames)
  }

  const shoot = async (name: string): Promise<void> => {
    const dataUrl = await page.evaluate(() => {
      const g = (window as unknown as Record<string, any>).__game
      g.frame(1 / 30)
      return g.graphics.renderer.domElement.toDataURL('image/png') as string
    })
    writeFileSync(resolve(__dirname, `v16-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log(`Screenshot: v16-${name}.png`)
  }

  // 1. Een reuzeneik zoeken: scan chunks tot er een 'eikstam'-mesh bestaat.
  const oak = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const w = g.world
    // Kandidaat-weides zoeken zoals de plaatsingslogica dat doet.
    let best: { x: number; z: number; s: number } | null = null
    for (let z = -800; z <= 800; z += 10) {
      for (let x = -800; x <= 800; x += 10) {
        const h = w.height(x, z)
        if (h < 2.5 || h > 26) continue
        if (w.forestness(x, z) > 0.25) continue
        const m = w.meadow(x, z)
        if (m < 0.35) continue
        const s = m + (1 - w.forestness(x, z))
        if (!best || s > best.s) best = { x, z, s }
      }
    }
    return best
  })
  console.log('Weide:', JSON.stringify(oak))
  if (oak) {
    await page.evaluate((o) => {
      const g = (window as unknown as Record<string, any>).__game
      g.player.spawn(o.x, o.z)
    }, oak)
    await settle(4)
    // Zoek de dichtstbijzijnde geplaatste eik in de geladen chunks.
    const oakPos = await page.evaluate(() => {
      const g = (window as unknown as Record<string, any>).__game
      const p = g.player.position
      let best: { x: number; z: number; d: number } | null = null
      g.scene.traverse((obj: { isInstancedMesh?: boolean; name: string; count?: number; instanceMatrix?: { array: Float32Array } }) => {
        if (!obj.isInstancedMesh || !obj.name.startsWith('veg:eikstam')) return
        const arr = obj.instanceMatrix!.array
        for (let i = 0; i < (obj.count ?? 0); i++) {
          const x = arr[i * 16 + 12]
          const z = arr[i * 16 + 14]
          const d = Math.hypot(x - p.x, z - p.z)
          if (!best || d < best.d) best = { x, z, d }
        }
      })
      if (!best) return null
      const o = best as { x: number; z: number; d: number }
      // Fotomodus: laag standpunt schuin op de eik, heuvels op de achtergrond.
      g.player.spawn(o.x + 14, o.z + 6)
      g.photoMode = true
      const h = g.world.height(o.x + 14, o.z + 6)
      g.photoPos.set(o.x + 14, h + 2.2, o.z + 6)
      g.player.yaw = Math.atan2(-(o.x - (o.x + 14)), -(o.z - (o.z + 6)))
      g.player.pitch = 0.06
      return o
    })
    console.log('Eik:', JSON.stringify(oakPos))
    if (oakPos) {
      await settle(8)
      await shoot('eik')
    }
  }

  // 2. Vernieuwd dennenbos + loofbomen vanaf een bospad.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    if (g.photoMode) g.photoMode = false
    let best: { x: number; z: number; s: number } | null = null
    for (let z = -700; z <= 700; z += 12) {
      for (let x = -700; x <= 700; x += 12) {
        const h = g.world.height(x, z)
        if (h < 5 || h > 24) continue
        const f = g.world.forestness(x, z)
        const p = Math.max(g.world.path(x, z, h), g.world.path(x + 4, z, h))
        if (f > 0.6 && p > 0.4 && (!best || f + p > best.s)) best = { x, z, s: f + p }
      }
    }
    if (!best) return
    g.player.spawn(best.x, best.z)
    // Kijk langs het pad (open richting).
    let bestA = 0
    let bestScore = -Infinity
    const eyeY = g.world.height(best.x, best.z) + 1.6
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2
      let walls = 0
      for (let d = 12; d <= 160; d += 12) {
        walls += Math.max(0, g.world.height(best.x - Math.sin(ang) * d, best.z - Math.cos(ang) * d) - (eyeY + d * 0.22))
      }
      if (-walls > bestScore) {
        bestScore = -walls
        bestA = ang
      }
    }
    g.player.yaw = bestA
    g.player.pitch = -0.03
  })
  await settle(8)
  await shoot('bospad')

  await browser.close()
  await server.close()
  process.exit(0)
}

void main()
