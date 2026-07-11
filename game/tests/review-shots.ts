// Maakt drie review-screenshots op karakteristieke plekken: een bospad,
// een bloemenweide en een bergvergezicht. Draaien: npx tsx tests/review-shots.ts

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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

  await page.goto('http://localhost:5199/')
  await page.fill('#seed', 'verdant-review')
  await page.click('#play')
  await page.waitForTimeout(3000)

  // Zonnetijd op laat in de ochtend: warm licht met zachte schaduwen.
  await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    g.sky.timeOfDay = 0.36
  })

  const spots = await page.evaluate(() => {
    const g = (window as unknown as Record<string, any>).__game
    const w = g.world

    // Raster-scan rond de spawn naar drie soorten plekken.
    let forestSpot: { x: number; z: number; score: number } | null = null
    let meadowSpot: { x: number; z: number; score: number } | null = null
    let vistaSpot: { x: number; z: number; score: number } | null = null
    for (let z = -600; z <= 600; z += 12) {
      for (let x = -600; x <= 600; x += 12) {
        const h = w.height(x, z)
        if (h < 2.5) continue
        const forest = w.forestness(x, z)
        const pathHere = Math.max(w.path(x, z, h), w.path(x + 6, z, h), w.path(x, z + 6, h))
        // Bospad: diep in het bos, ruim boven het strand, op een open pad.
        const fScore = forest + pathHere * 2
        if (forest > 0.72 && h > 7 && h < 24 && pathHere > 0.35 && (!forestSpot || fScore > forestSpot.score)) {
          forestSpot = { x, z, score: fScore }
        }
        const mScore = w.meadow(x, z) * 2 - forest
        if (h > 4 && h < 16 && (!meadowSpot || mScore > meadowSpot.score)) {
          meadowSpot = { x, z, score: mScore }
        }
        // Uitzichtpunt: matig hoog, met veel hoger terrein in de buurt.
        if (h > 6 && h < 26) {
          let maxNear = 0
          for (let a = 0; a < 8; a++) {
            const hh = w.height(x + Math.cos(a * 0.785) * 250, z + Math.sin(a * 0.785) * 250)
            if (hh > maxNear) maxNear = hh
          }
          const vScore = maxNear - h
          if (!vistaSpot || vScore > vistaSpot.score) vistaSpot = { x, z, score: vScore }
        }
      }
    }
    return { forestSpot, meadowSpot, vistaSpot }
  })
  console.log('Plekken:', JSON.stringify(spots))

  const shots: [string, { x: number; z: number } | null, number, number][] = [
    ['bospad', spots.forestSpot, -0.06, 9000],
    ['bloemenweide', spots.meadowSpot, -0.1, 12000],
    ['vergezicht', spots.vistaSpot, 0.0, 26000]
  ]

  for (const [name, spot, pitch, wait] of shots) {
    if (!spot) continue
    await page.evaluate(
      ({ spot, pitch }) => {
        const g = (window as unknown as Record<string, any>).__game
        g.player.spawn(spot.x, spot.z)
        const eyeY = g.world.height(spot.x, spot.z) + 1.6
        // Kies de meest open kijkrichting (geen hellingen vlak voor de neus),
        // met verre bergtoppen als mooie achtergrond.
        let bestA = 0
        let bestScore = -Infinity
        for (let a = 0; a < 24; a++) {
          const ang = (a / 24) * Math.PI * 2
          const dx = -Math.sin(ang)
          const dz = -Math.cos(ang)
          let walls = 0
          for (let d = 20; d <= 260; d += 20) {
            const hh = g.world.height(spot.x + dx * d, spot.z + dz * d)
            walls += Math.max(0, hh - (eyeY + d * 0.18))
          }
          let farPeak = 0
          for (let d = 380; d <= 620; d += 80) {
            farPeak = Math.max(farPeak, g.world.height(spot.x + dx * d, spot.z + dz * d))
          }
          const score = -walls * 3 + farPeak * 0.4
          if (score > bestScore) {
            bestScore = score
            bestA = ang
          }
        }
        g.player.yaw = bestA
        g.player.pitch = pitch
      },
      { spot, pitch }
    )
    // Chunks rond de nieuwe plek laten genereren.
    await page.waitForTimeout(wait)
    await page.screenshot({ path: resolve(__dirname, `review-${name}.png`) })
    console.log(`Screenshot: review-${name}.png`)
  }

  await browser.close()
  await server.close()
  process.exit(0)
}

void main()
