// Hertakes voor de twee lastige v1.5-shots: rivier (met waterval) en
// herfstbos. Met diagnose-logging en boom-collider-bewuste cameraplaatsing.
// Draaien: npx tsx tests/fix-shots.ts

import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'
import { writeFileSync } from 'fs'

const SEED = 'groene-vallei'

async function main(): Promise<void> {
  const server = await createServer({
    root: resolve(__dirname, '../src/renderer'),
    server: { port: 5198, strictPort: true }
  })
  await server.listen()
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio']
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

  const fresh = async (): Promise<void> => {
    await page.goto('http://localhost:5198/')
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
  }

  const settle = async (frames = 10): Promise<void> => {
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
    writeFileSync(resolve(__dirname, `v15-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log(`Screenshot: v15-${name}.png`)
  }

  // ---- 1. Rivier met waterval ----
  await fresh()
  const rivierInfo = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const w = g.world
    let best: { x: number; z: number; h: number; drop: number; s: number; dirX: number; dirZ: number } | null = null
    for (let z = -700; z <= 700; z += 6) {
      for (let x = -700; x <= 700; x += 6) {
        const h = w.height(x, z)
        if (h < 9 || h > 34) continue
        const r = w.river(x, z, h)
        if (r < 0.7) continue
        // Bos in de buurt voor een groene omlijsting.
        const fNear = Math.max(
          w.forestness(x + 15, z),
          w.forestness(x - 15, z),
          w.forestness(x, z + 15),
          w.forestness(x, z - 15)
        )
        if (fNear < 0.3) continue
        // Richting van de rivier: waar blijft r hoog op 7 m afstand?
        let dirX = 0
        let dirZ = 0
        let bestR = 0
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2
          const dx = Math.cos(ang)
          const dz = Math.sin(ang)
          const rr = w.river(x + dx * 7, z + dz * 7)
          if (rr > bestR) {
            bestR = rr
            dirX = dx
            dirZ = dz
          }
        }
        if (bestR < 0.5) continue
        // Verval: hoogteverschil 10 m stroomop/-af langs de rivier. Beide
        // kanten moeten land blijven (geen zeekliffen) en het verval moet
        // waterval-groot zijn, niet klif-groot.
        const hA = w.height(x + dirX * 10, z + dirZ * 10)
        const hB = w.height(x - dirX * 10, z - dirZ * 10)
        if (hA < 2.5 || hB < 2.5) continue
        const drop = Math.abs(hA - hB)
        if (drop > 9) continue
        // Niet vlak bij de kust: rondom moet het land blijven.
        if (
          w.height(x + 30, z) < 2 ||
          w.height(x - 30, z) < 2 ||
          w.height(x, z + 30) < 2 ||
          w.height(x, z - 30) < 2
        )
          continue
        // Stroomafwaartse richting (omlaag).
        const downX = hA < hB ? dirX : -dirX
        const downZ = hA < hB ? dirZ : -dirZ
        const s = drop * 2 + r + fNear
        if (!best || s > best.s) best = { x, z, h, drop, s, dirX: downX, dirZ: downZ }
      }
    }
    if (!best) return null
    // Fotomodus: camera schuin boven de rivier, stroomopwaarts kijkend naar
    // het verval — vrij van stammen en oevers.
    g.player.spawn(best.x, best.z)
    g.photoMode = true
    const camX = best.x + best.dirX * 16
    const camZ = best.z + best.dirZ * 16
    g.photoPos.set(camX, best.h + 7, camZ)
    g.player.yaw = Math.atan2(-(best.x - camX), -(best.z - camZ))
    g.player.pitch = -0.3
    return best
  })
  console.log('Rivierplek:', JSON.stringify(rivierInfo))
  await settle(10)
  const naSettle = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const p = g.player.position
    return {
      pos: { x: Math.round(p.x), y: Math.round(p.y * 10) / 10, z: Math.round(p.z) },
      chunks: g.chunks.loadedCount,
      fog: g.fog.density,
      cloud: g.weather.cloudiness
    }
  })
  console.log('Na settle:', JSON.stringify(naSettle))
  await shoot('rivier')

  // ---- 2. Herfstbos ----
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const w = g.world
    let best: { x: number; z: number; s: number } | null = null
    for (let z = -900; z <= 900; z += 10) {
      for (let x = -900; x <= 900; x += 10) {
        const h = w.height(x, z)
        if (h < 6 || h > 24) continue
        const region = w.region(x, z)
        if (region < 0.8) continue
        const f = w.forestness(x, z)
        if (f < 0.35 || f > 0.6) continue
        const s = region + (0.6 - Math.abs(f - 0.45))
        if (!best || s > best.s) best = { x, z, s }
      }
    }
    if (!best) return
    g.player.spawn(best.x, best.z)
    g.player.pitch = -0.03
  })
  await settle(6)
  // Fotomodus: camera boven de boomtoppen, schuin over het zonverlichte
  // herfstbladerdak kijkend — geen donkere onderkant van kronen.
  const bosInfo = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const px = g.player.position.x
    const pz = g.player.position.z
    const h = g.world.height(px, pz)
    // Richting met de meeste bomen op 15-60 m: daar ligt het bos.
    const trees = g.vegetation.collidersNear(px, pz).slice()
    let bestA = 0
    let bestScore = -Infinity
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2
      const dx = -Math.sin(ang)
      const dz = -Math.cos(ang)
      let midTrees = 0
      for (const t of trees) {
        const tx = t.x - px
        const tz = t.z - pz
        const dist = Math.hypot(tx, tz)
        if (dist < 2) continue
        const dot = (tx * dx + tz * dz) / dist
        if (dot > 0.55 && dist < 60) midTrees++
      }
      // Terrein dat boven de camera uit stijgt vermijden.
      let walls = 0
      for (let d = 20; d <= 160; d += 20) {
        walls += Math.max(0, g.world.height(px + dx * d, pz + dz * d) - (h + 12 + d * 0.3))
      }
      const score = midTrees - walls * 4
      if (score > bestScore) {
        bestScore = score
        bestA = ang
      }
    }
    g.photoMode = true
    g.photoPos.set(px, h + 13, pz)
    g.player.yaw = bestA
    g.player.pitch = -0.24
    return { x: px, z: pz, score: bestScore }
  })
  console.log('Bosplek:', JSON.stringify(bosInfo))
  await settle(6)
  await shoot('herfstbos')

  await browser.close()
  await server.close()
  process.exit(0)
}

void main()
