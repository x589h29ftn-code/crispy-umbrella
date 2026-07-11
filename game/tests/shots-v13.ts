// Reviewshots v1.3: meerhuisje met steiger/moestuin/graanveld, het meertje,
// de bergen en het bos. Draaien: npx tsx tests/shots-v13.ts

import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'

const SEEDS = ['verdant-review', 'meerhuis', 'groene-vallei', 'bergmeer', 'verdant']

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

  // Zoek een seed waarvan de wereld een meerhuisje heeft.
  let chosenSeed = ''
  for (const seed of SEEDS) {
    await page.goto('http://localhost:5199/')
    await page.fill('#seed', seed)
    await page.click('#play')
    await page.waitForTimeout(2500)
    const hasLakeHouse = await page.evaluate(() => {
      const g = (window as unknown as Record<string, any>).__game
      return Boolean(g.structures?.lakeHouse)
    })
    console.log(`Seed "${seed}": meerhuisje ${hasLakeHouse ? 'JA' : 'nee'}`)
    if (hasLakeHouse) {
      chosenSeed = seed
      break
    }
  }
  if (!chosenSeed) {
    console.log('Geen seed met meerhuisje gevonden!')
    process.exit(1)
  }

  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    g.sky.timeOfDay = 0.38
  })

  // 1. Het meerhuisje vanaf de spawnplek.
  await page.waitForTimeout(12000)
  await page.screenshot({ path: resolve(__dirname, 'v13-meerhuisje.png') })
  console.log('Screenshot: v13-meerhuisje.png')

  // 2. Vanaf de steiger over het meer, terugkijkend naar het erf.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const lh = g.structures.lakeHouse
    const dirs = [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0]
    ][lh.quarter]
    const px = lh.x + dirs[0] * 6
    const pz = lh.z + dirs[1] * 6
    g.player.spawn(px, pz)
    g.player.position.y = 1.2
    const tx = lh.x - dirs[0] * 12
    const tz = lh.z - dirs[1] * 12
    g.player.yaw = Math.atan2(-(tx - px), -(tz - pz))
    g.player.pitch = -0.02
  })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: resolve(__dirname, 'v13-steiger.png') })
  console.log('Screenshot: v13-steiger.png')


  // 2b. Een dorpje opzoeken — met een verse game-state.
  await page.goto('http://localhost:5199/')
  await page.fill('#seed', chosenSeed)
  await page.click('#play')
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    g.sky.timeOfDay = 0.38
  })
  const village = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const pcx = Math.floor(g.player.position.x / 64)
    const pcz = Math.floor(g.player.position.z / 64)
    for (let r = 0; r < 16; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const v = g.structures.villageSpotFor(pcx + dx, pcz + dz)
          if (v) return v
        }
      }
    }
    return null
  })
  console.log('Dorp:', JSON.stringify(village))
  if (village) {
    await page.evaluate((v) => {
      const g = (window as unknown as Record<string, any>).__game
      // Naast de waterput, kijkend naar het zuidelijke huisje.
      g.player.spawn(v.x + 4.5, v.z + 5)
      const tx = v.x
      const tz = v.z - 11.5
      g.player.yaw = Math.atan2(-(tx - (v.x + 4.5)), -(tz - (v.z + 5)))
      g.player.pitch = -0.03
    }, village)
    await page.waitForTimeout(12000)
    await page.screenshot({ path: resolve(__dirname, 'v13-dorp.png') })
    console.log('Screenshot: v13-dorp.png')
  }

  // 3. De bergen in: hoog uitzichtpunt met verre bergketens.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    let best = { x: 0, z: 0, h: -1 }
    for (let z = -800; z <= 800; z += 16) {
      for (let x = -800; x <= 800; x += 16) {
        const h = g.world.height(x, z)
        if (h > best.h) best = { x, z, h }
      }
    }
    // Sta op ~zichthoogte van de flank en kijk naar de hoogste top.
    const px = best.x + 130
    const pz = best.z + 90
    g.player.spawn(px, pz)
    g.player.yaw = Math.atan2(-(best.x - px), -(best.z - pz))
    g.player.pitch = 0.06
  })
  await page.waitForTimeout(14000)
  await page.screenshot({ path: resolve(__dirname, 'v13-bergen.png') })
  console.log('Screenshot: v13-bergen.png')

  // 4. Diep het dichte bos in.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    let best: { x: number; z: number; s: number } | null = null
    for (let z = -700; z <= 700; z += 14) {
      for (let x = -700; x <= 700; x += 14) {
        const h = g.world.height(x, z)
        if (h < 6 || h > 22) continue
        const f = g.world.forestness(x, z)
        const p = Math.max(g.world.path(x, z, h), g.world.path(x + 5, z, h))
        const s = f + p
        if (f > 0.75 && (!best || s > best.s)) best = { x, z, s }
      }
    }
    if (!best) return
    g.player.spawn(best.x, best.z)
    // Open kijkrichting kiezen.
    let bestA = 0
    let bestScore = -Infinity
    const eyeY = g.world.height(best.x, best.z) + 1.6
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2
      let walls = 0
      for (let d = 15; d <= 200; d += 15) {
        const hh = g.world.height(best.x - Math.sin(ang) * d, best.z - Math.cos(ang) * d)
        walls += Math.max(0, hh - (eyeY + d * 0.2))
      }
      if (-walls > bestScore) {
        bestScore = -walls
        bestA = ang
      }
    }
    g.player.yaw = bestA
    g.player.pitch = -0.04
  })
  await page.waitForTimeout(12000)
  await page.screenshot({ path: resolve(__dirname, 'v13-bos.png') })
  console.log('Screenshot: v13-bos.png')

  await browser.close()
  await server.close()
  process.exit(0)
}

void main()
