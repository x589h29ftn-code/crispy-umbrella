import { World } from '../src/renderer/src/world/terrain'
import { chunkRng } from '../src/renderer/src/core/rng'

const world = new World('groene-vallei')
const fails = { h: 0, normal: 0, forest: 0, lake: 0, ok: 0 }
for (let cz = -20; cz <= 20; cz++) {
  for (let cx = -20; cx <= 20; cx++) {
    const rng = chunkRng(world.seed, cx, cz, 'dorp')
    if (rng() >= 0.16) continue
    for (let attempt = 0; attempt < 34; attempt++) {
      const x = cx * 64 + 16 + rng() * 32
      const z = cz * 64 + 16 + rng() * 32
      const h = world.height(x, z)
      if (h < 2.2 || h > 38) { fails.h++; continue }
      if (world.normal(x, z).y < 0.9) { fails.normal++; continue }
      if (world.forestness(x, z) > 0.5) { fails.forest++; continue }
      if (world.lakeness(x, z) > 0.45) { fails.lake++; continue }
      let flat = true
      for (const [ox, oz] of [[0, -9], [1, 9], [-9, 0.8], [9, -0.8]]) {
        const hh = world.height(x + ox, z + oz)
        if (Math.abs(hh - h) > 3 || world.normal(x + ox, z + oz).y < 0.85) { flat = false; break }
      }
      if (!flat) continue
      fails.ok++
      break
    }
  }
}
console.log(JSON.stringify(fails))
