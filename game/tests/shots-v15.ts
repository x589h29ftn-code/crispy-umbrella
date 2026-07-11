// Reviewshots v1.5: rivier, herfstbos, regen, winter, kano, dorpeling, vissen.
// Headless Chromium smoort requestAnimationFrame (~0,33 fps), dus we bouwen
// de wereld synchroon op via chunks.update met een groot budget en tikken
// frames handmatig met game.frame(dt). Draaien: npx tsx tests/shots-v15.ts

import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'
import { writeFileSync } from 'fs'

const SEED = 'groene-vallei'

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
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

  const fresh = async (): Promise<void> => {
    await page.goto('http://localhost:5199/')
    await page.fill('#seed', SEED)
    await page.click('#play')
    await page.waitForTimeout(2500)
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, any>).__game
      g.sky.timeOfDay = 0.38
      g.chunks.viewDistance = 8 // sneller vol beeld in de software-renderer
      // Helder weer als uitgangspunt, zodat mist de shots niet verpest.
      const w = g.weather
      w.kind = 'helder'
      w.targetRain = 0
      w.targetCloud = 0.12
      w.intensity = 0
      w.cloudiness = 0.12
      w.timer = 600
    })
  }

  // Bouwt alle chunks rond de speler synchroon op en tikt daarna een paar
  // frames zodat animaties/weer/camera zich zetten en er echt gerenderd is.
  const settle = async (frames = 10): Promise<void> => {
    await page.evaluate((n) => {
      const g = (window as unknown as Record<string, any>).__game
      const p = g.player.position
      g.chunks.update(p.x, p.z, 300000)
      for (let i = 0; i < n; i++) g.frame(1 / 30)
    }, frames)
  }

  // page.screenshot hangt in een 'occluded' headless pagina (compositor levert
  // geen frames), dus we lezen het WebGL-canvas direct uit in dezelfde JS-taak
  // als de render — dan is de drawing buffer nog geldig.
  const shoot = async (name: string, frames = 10): Promise<void> => {
    await settle(frames)
    const dataUrl = await page.evaluate(() => {
      const g = (window as unknown as Record<string, any>).__game
      g.frame(1 / 30)
      return g.graphics.renderer.domElement.toDataURL('image/png') as string
    })
    const base64 = dataUrl.split(',')[1]
    writeFileSync(resolve(__dirname, `v15-${name}.png`), Buffer.from(base64, 'base64'))
    console.log(`Screenshot: v15-${name}.png`)
  }

  // 1. Rivier met waterval: zoek een riviercel met verval, in groen gebied.
  await fresh()
  const rivierSpot = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    let best: { x: number; z: number; s: number; h: number } | null = null
    for (let z = -700; z <= 700; z += 8) {
      for (let x = -700; x <= 700; x += 8) {
        const h = g.world.height(x, z)
        if (h < 8 || h > 30) continue
        const r = g.world.river(x, z, h)
        if (r < 0.6) continue
        // Groen eromheen (geen kale kust) en verval langs de rivier.
        const f = Math.max(g.world.forestness(x + 12, z), g.world.forestness(x - 12, z))
        if (f < 0.3) continue
        const drop = Math.abs(g.world.height(x + 6, z) - g.world.height(x - 6, z))
        const s = r + drop * 0.4 + f * 0.5
        if (!best || s > best.s) best = { x, z, s, h }
      }
    }
    if (!best) return null
    // Sta naast de rivier en kijk erlangs (dwars op de gradiënt).
    g.player.spawn(best.x + 5, best.z + 4)
    g.player.yaw = Math.atan2(-(best.x - (best.x + 5)), -(best.z - (best.z + 4)))
    g.player.pitch = -0.18
    return best
  })
  console.log('Rivierplek:', JSON.stringify(rivierSpot))
  await shoot('rivier')

  // 2. Herfstbos.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    let best: { x: number; z: number; s: number } | null = null
    for (let z = -900; z <= 900; z += 14) {
      for (let x = -900; x <= 900; x += 14) {
        const h = g.world.height(x, z)
        if (h < 5 || h > 24) continue
        const region = g.world.region(x, z)
        const f = g.world.forestness(x, z)
        // Op een open bospad staan, zodat de camera niet in een boomkruin zit.
        const p = Math.max(g.world.path(x, z, h), g.world.path(x + 4, z, h))
        if (region > 0.8 && f > 0.4 && p > 0.35 && (!best || region + f + p > best.s))
          best = { x, z, s: region + f + p }
      }
    }
    if (!best) return
    g.player.spawn(best.x, best.z)
    g.player.pitch = -0.02
    // Open richting kiezen.
    let bestA = 0
    let bestScore = -Infinity
    const eyeY = g.world.height(best.x, best.z) + 1.6
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2
      let walls = 0
      for (let d = 15; d <= 180; d += 15) {
        walls += Math.max(0, g.world.height(best.x - Math.sin(ang) * d, best.z - Math.cos(ang) * d) - (eyeY + d * 0.22))
      }
      if (-walls > bestScore) {
        bestScore = -walls
        bestA = ang
      }
    }
    g.player.yaw = bestA
  })
  await shoot('herfstbos')

  // 3. Regenbui op het erf.
  await fresh()
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const w = g.weather
    w.kind = 'regen'
    w.targetRain = 1
    w.targetCloud = 0.9
    w.timer = 600
    w.intensity = 0.8
    w.cloudiness = 0.85
  })
  await shoot('regen', 30)

  // 4. Winter (seizoen doorspoelen naar het vierde kwart) op een heuvelweide
  // ruim boven de gezakte sneeuwgrens, zodat de grond wit is.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    g.sky.totalDays = 2.0 // seasonT ≈ 0.85 → winter
    const w = g.weather
    w.kind = 'regen'
    w.targetRain = 0.8
    w.intensity = 0.7
    w.targetCloud = 0.6
    w.cloudiness = 0.5
    w.timer = 600
    let best: { x: number; z: number; s: number } | null = null
    for (let z = -700; z <= 700; z += 12) {
      for (let x = -700; x <= 700; x += 12) {
        const h = g.world.height(x, z)
        if (h < 18 || h > 34) continue
        const f = g.world.forestness(x, z)
        const n = g.world.normal(x, z)
        if (n.y < 0.92) continue
        // Halfopen plek met wat bos in de buurt voor besneeuwde bomen.
        const fNear = Math.max(g.world.forestness(x + 20, z), g.world.forestness(x, z + 20))
        const s = (1 - f) + fNear * 0.6 + h * 0.01
        if (f < 0.4 && (!best || s > best.s)) best = { x, z, s }
      }
    }
    if (!best) return
    g.player.spawn(best.x, best.z)
    g.player.pitch = -0.04
    // Open kijkrichting met liefst hoge toppen in de verte.
    let bestA = 0
    let bestScore = -Infinity
    const eyeY = g.world.height(best.x, best.z) + 1.6
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2
      let walls = 0
      for (let d = 15; d <= 200; d += 15) {
        walls += Math.max(0, g.world.height(best.x - Math.sin(ang) * d, best.z - Math.cos(ang) * d) - (eyeY + d * 0.22))
      }
      let farPeak = 0
      for (let d = 300; d <= 550; d += 60) {
        farPeak = Math.max(farPeak, g.world.height(best.x - Math.sin(ang) * d, best.z - Math.cos(ang) * d))
      }
      const score = -walls * 3 + farPeak * 0.3
      if (score > bestScore) {
        bestScore = score
        bestA = ang
      }
    }
    g.player.yaw = bestA
  })
  await shoot('winter', 30)

  // 5. Kano op het meer, kijkend richting het meerhuisje zodat de boeg,
  // de peddel en het erf samen in beeld staan.
  await fresh()
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    // Kies een kano die echt drijft.
    const canoe =
      g.boats.canoes.find((c: { x: number; z: number }) => g.world.height(c.x, c.z) < -0.5) ?? g.boats.canoes[0]
    if (!canoe) return
    g.boats.enter(canoe)
    // Kijk over de boeg, iets omlaag: romp en peddel in beeld.
    g.player.yaw = canoe.heading
    g.player.pitch = -0.42
  })
  await shoot('kano', 20)

  // 6. Dorpeling bij de put.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    if (g.boats.active) g.boats.exit()
    const pcx = Math.floor(g.player.position.x / 64)
    const pcz = Math.floor(g.player.position.z / 64)
    for (let r = 0; r < 24; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const v = g.structures.villageSpotFor(pcx + dx, pcz + dz)
          if (v) {
            g.player.spawn(v.x + 3.5, v.z + 4)
            g.player.yaw = Math.atan2(-(v.x - (v.x + 3.5)), -(v.z - (v.z + 4)))
            g.player.pitch = -0.04
            return
          }
        }
      }
    }
  })
  await shoot('dorp', 20)

  // 7. Vissen vanaf de steiger.
  await fresh()
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const lh = g.structures.lakeHouse
    const dirs = [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0]
    ][lh.quarter]
    g.player.spawn(lh.x + dirs[0] * 6, lh.z + dirs[1] * 6)
    g.player.position.y = 1.0
    g.player.yaw = Math.atan2(-dirs[0], -dirs[1]) // het meer op kijken
    g.player.pitch = -0.28
  })
  await settle(10)
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const eye = g.player.position.clone()
    eye.y += 1.62
    const look = g.player.position.clone() // Vector3-instantie lenen
    g.player.getLookDirection(look)
    g.fishing.click(eye, look)
  })
  // Dobber laten landen en drijven: ± 2 seconden simuleren.
  await shoot('vissen', 60)

  await browser.close()
  await server.close()
  process.exit(0)
}

void main()
