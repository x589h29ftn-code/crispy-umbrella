import { World } from '../src/renderer/src/world/terrain'

const w = new World('groene-vallei')
// Warm-up
w.height(0, 0)

let t0 = performance.now()
let sum = 0
for (let z = 0; z < 66; z++) for (let x = 0; x < 66; x++) sum += w.height(x, z)
console.log('hoogtegrid 66x66:', (performance.now() - t0).toFixed(1), 'ms')

t0 = performance.now()
for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) sum += w.river(x + 0.5, z + 0.5, 5)
console.log('river-masker 64x64 (met bekende h):', (performance.now() - t0).toFixed(1), 'ms')

t0 = performance.now()
for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
  const h = w.height(x + 0.5, z + 0.5)
  sum += w.river(x + 0.5, z + 0.5, h)
}
console.log('levelAt-patroon 64x64 (height+river):', (performance.now() - t0).toFixed(1), 'ms')

t0 = performance.now()
for (let i = 0; i < 4356; i++) sum += w.region(i % 66, i / 66) 
console.log('region 4356x:', (performance.now() - t0).toFixed(1), 'ms')
console.log(sum > -1 ? 'ok' : '')
