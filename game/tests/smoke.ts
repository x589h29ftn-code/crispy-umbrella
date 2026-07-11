// Browser-smoke-test: start de renderer via vite, laadt de game in headless
// Chromium (SwiftShader-WebGL), speelt een paar seconden, controleert op
// console-fouten en maakt screenshots — ook op ultrawide.
// Draaien met: npx tsx tests/smoke.ts

import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { resolve } from 'path'

async function main(): Promise<void> {
  const server = await createServer({
    root: resolve(__dirname, '../src/renderer'),
    resolve: { alias: { '@renderer': resolve(__dirname, '../src/renderer/src') } },
    server: { port: 5199, strictPort: true }
  })
  await server.listen()

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio']
  })

  const errors: string[] = []
  let failures = 0
  const check = (name: string, ok: boolean): void => {
    console.log(`${ok ? 'OK  ' : 'FOUT'} ${name}`)
    if (!ok) failures++
  }

  for (const [label, width, height] of [
    ['1080p', 1920, 1080],
    ['ultrawide', 3440, 1440]
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height } })
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[${label}] ${msg.text()}`)
    })
    page.on('pageerror', (err) => errors.push(`[${label}] ${err.message}`))

    await page.goto('http://localhost:5199/')
    await page.fill('#seed', 'smoke-test-wereld')
    await page.click('#play')
    await page.waitForTimeout(4000)

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, any>).__game
      if (!g) return null
      return {
        chunks: g.chunks.loadedCount as number,
        animals: g.animals?.count ?? -1,
        playerY: g.player.position.y as number,
        fov: g.graphics.camera.fov as number,
        aspect: g.graphics.camera.aspect as number
      }
    })

    check(`${label}: game gestart`, state !== null)
    if (state) {
      check(`${label}: chunks geladen (${state.chunks})`, state.chunks > 28)
      check(`${label}: speler op vaste grond (y=${state.playerY.toFixed(1)})`, state.playerY > -5 && state.playerY < 60)
      check(`${label}: camera-aspect klopt (${state.aspect.toFixed(2)})`, Math.abs(state.aspect - width / height) < 0.01)
    }

    // Even rondkijken en lopen voor de screenshot.
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(1200)
    await page.keyboard.up('KeyW')
    await page.screenshot({ path: resolve(__dirname, `screenshot-${label}.png`) })
    await page.close()
  }

  await browser.close()
  await server.close()

  const realErrors = errors.filter(
    (e) => !e.includes('WebGL') && !e.includes('GroupMarkerNotSet') && !e.includes('AudioContext')
  )
  check('geen console-fouten', realErrors.length === 0)
  if (realErrors.length > 0) console.log(realErrors.join('\n'))

  console.log(failures === 0 ? '\nSmoke-test geslaagd.' : `\n${failures} check(s) gefaald!`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
