import * as THREE from 'three'
import { SEA_LEVEL, type World } from './terrain'

const SIZE = 2048 // zichtbaar watervlak (m), ruim voorbij de mist
const SEGMENTS = 128
const CELL = SIZE / SEGMENTS

/**
 * Golvend, deels doorzichtig watervlak dat met de speler meebeweegt.
 * Per vertex wordt de waterdiepte bijgehouden (geamortiseerd bijgewerkt)
 * voor schuimranden en diepte-afhankelijke transparantie.
 */
export class Water {
  readonly mesh: THREE.Mesh
  private world: World
  private material: THREE.MeshPhongMaterial
  private depthAttr: THREE.BufferAttribute
  private uniforms = { uTime: { value: 0 } }
  private snapX = Infinity
  private snapZ = Infinity
  private refreshRow = 0

  constructor(world: World) {
    this.world = world

    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
    geometry.rotateX(-Math.PI / 2)
    const count = (SEGMENTS + 1) * (SEGMENTS + 1)
    this.depthAttr = new THREE.BufferAttribute(new Float32Array(count), 1)
    this.depthAttr.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aDepth', this.depthAttr)

    this.material = new THREE.MeshPhongMaterial({
      color: 0x2a6f9e,
      specular: 0xaaccdd,
      shininess: 180,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide
    })

    const uniforms = this.uniforms
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime

      shader.vertexShader =
        'uniform float uTime;\nattribute float aDepth;\nvarying float vDepth;\nvarying vec3 vWave;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vDepth = aDepth;
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float calm = smoothstep(0.0, 1.5, aDepth);
          float w1 = sin(wp.x * 0.11 + uTime * 1.1) * cos(wp.z * 0.09 + uTime * 0.9);
          float w2 = sin((wp.x + wp.z) * 0.23 + uTime * 1.7);
          transformed.y += (w1 * 0.10 + w2 * 0.05) * calm;
          vWave = vec3(w1, w2, calm);`
        )

      shader.fragmentShader =
        'uniform float uTime;\nvarying float vDepth;\nvarying vec3 vWave;\n' +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            // Dieper water is donkerder en blauwer.
            vec3 shallowCol = vec3(0.30, 0.62, 0.66);
            vec3 deepCol = vec3(0.07, 0.26, 0.45);
            diffuseColor.rgb = mix(shallowCol, deepCol, smoothstep(0.0, 7.0, vDepth));
            // Schuimrand waar het water het strand raakt.
            float foamBand = smoothstep(0.55, 0.05, vDepth);
            float foamPattern = 0.6 + 0.4 * sin(vDepth * 22.0 - uTime * 2.2 + vWave.x * 3.0);
            float foam = foamBand * foamPattern;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), foam);
            diffuseColor.a = mix(0.55, 0.85, smoothstep(0.0, 5.0, vDepth));
            diffuseColor.a = max(diffuseColor.a, foam);`
          )
          .replace(
            '#include <normal_fragment_begin>',
            `#include <normal_fragment_begin>
            // Golfjes in de normaal voor levendige spiegeling van de zon.
            normal = normalize(normal + vec3(vWave.x * 0.08, 0.0, vWave.y * 0.08) * vWave.z);`
          )
    }

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.position.y = SEA_LEVEL
    this.mesh.renderOrder = 1
    this.mesh.frustumCulled = false
  }

  update(dt: number, playerX: number, playerZ: number): void {
    this.uniforms.uTime.value += dt

    // Vlak in stappen van één cel meebewegen zodat de golven niet "glijden".
    const sx = Math.round(playerX / CELL) * CELL
    const sz = Math.round(playerZ / CELL) * CELL
    const moved = sx !== this.snapX || sz !== this.snapZ
    if (moved) {
      this.snapX = sx
      this.snapZ = sz
      this.mesh.position.x = sx
      this.mesh.position.z = sz
    }

    // Diepte-attribuut geamortiseerd verversen (enkele rijen per frame).
    const rows = moved ? 12 : 4
    const arr = this.depthAttr.array as Float32Array
    for (let r = 0; r < rows; r++) {
      const z = this.refreshRow
      for (let x = 0; x <= SEGMENTS; x++) {
        const wx = sx - SIZE / 2 + x * CELL
        const wz = sz - SIZE / 2 + z * CELL
        arr[z * (SEGMENTS + 1) + x] = Math.max(0, SEA_LEVEL - this.world.height(wx, wz))
      }
      this.refreshRow = (this.refreshRow + 1) % (SEGMENTS + 1)
    }
    this.depthAttr.needsUpdate = true
  }
}
