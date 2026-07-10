// Pure-module controles zonder browser: determinisme, naadloze chunkranden
// en de blok-opslag. Draaien met: npx tsx tests/pure-checks.ts

import { World } from '../src/renderer/src/world/terrain'
import { BlockStore } from '../src/renderer/src/build/blockStore'

let failures = 0

function check(name: string, ok: boolean): void {
  console.log(`${ok ? 'OK  ' : 'FOUT'} ${name}`)
  if (!ok) failures++
}

// 1. Zelfde seed → exact dezelfde wereld; andere seed → andere wereld.
{
  const a = new World('groene-heuvels')
  const b = new World('groene-heuvels')
  const c = new World('iets-anders')
  let same = true
  let diff = false
  for (let i = 0; i < 200; i++) {
    const x = Math.sin(i * 12.9898) * 4378.5453 * 10
    const z = Math.cos(i * 78.233) * 2358.5453 * 10
    if (a.height(x, z) !== b.height(x, z)) same = false
    if (a.height(x, z) !== c.height(x, z)) diff = true
  }
  check('zelfde seed geeft identieke hoogtes', same)
  check('andere seed geeft andere wereld', diff)
}

// 2. Hoogte is continu over chunkranden (zelfde functie, dus per definitie,
//    maar bewaak dat de functie geen chunk-lokale state heeft).
{
  const w = new World('rand-test')
  let seamless = true
  for (let i = -64; i <= 64; i += 8) {
    const h1 = w.height(64, i)
    const h2 = w.height(64.0000001, i)
    if (Math.abs(h1 - h2) > 0.001) seamless = false
  }
  check('terreinhoogte naadloos over chunkgrens', seamless)
}

// 3. Waarden binnen redelijke grenzen + normalen genormaliseerd.
{
  const w = new World('bereik-test')
  let inRange = true
  let normalized = true
  for (let i = 0; i < 500; i++) {
    const x = (i * 137) % 4000 - 2000
    const z = (i * 89) % 4000 - 2000
    const h = w.height(x, z)
    if (h < -80 || h > 90 || Number.isNaN(h)) inRange = false
    const n = w.normal(x, z)
    const len = Math.hypot(n.x, n.y, n.z)
    if (Math.abs(len - 1) > 0.001 || n.y < 0) normalized = false
    const m = w.moisture(x, z)
    if (m < 0 || m > 1) inRange = false
  }
  check('hoogte/vochtigheid binnen verwachte grenzen', inRange)
  check('terreinnormalen genormaliseerd en omhoog', normalized)
}

// 4. BlockStore: plaatsen, botsingsquery, verwijderen en JSON-roundtrip.
{
  const store = new BlockStore()
  store.set(3, 5, -2, 1)
  store.set(-4, 0, 7, 0)
  check('blok terugvindbaar', store.get(3, 5, -2) === 1)
  const hits = store.blocksInAABB(2.5, 4.5, -2.5, 3.5, 6.5, -1.5)
  check('AABB-query vindt het blok', hits.length === 1 && hits[0].minX === 3)
  const none = store.blocksInAABB(10, 10, 10, 11, 11, 11)
  check('AABB-query elders vindt niets', none.length === 0)
  const json = store.toJSON()
  const restored = new BlockStore()
  restored.fromJSON(json)
  check('JSON-roundtrip behoudt blokken', restored.get(-4, 0, 7) === 0 && restored.size === 2)
  restored.remove(-4, 0, 7)
  check('verwijderen werkt', restored.get(-4, 0, 7) === undefined && restored.size === 1)
}

console.log(failures === 0 ? '\nAlle pure checks geslaagd.' : `\n${failures} check(s) gefaald!`)
process.exit(failures === 0 ? 0 : 1)
