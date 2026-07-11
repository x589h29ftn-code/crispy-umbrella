import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

export type Quality = 'low' | 'medium' | 'high'

// Vaste verticale FOV afgeleid van 100° horizontaal op 16:9 ("Hor+"):
// op ultrawide groeit het horizontale blikveld mee in plaats van uit te rekken.
const BASE_ASPECT = 16 / 9

function verticalFov(hFov: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hFov / 2)) / BASE_ASPECT))
}

// Vignette + onderwater-kleurgrading als laatste pass.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.32 },
    uUnderwater: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uUnderwater;
    varying vec2 vUv;
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      // Rijkere, iets warmere kleuren (referentie-artstijl).
      float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(vec3(luma), col.rgb, 1.14);
      col.rgb *= vec3(1.02, 1.0, 0.965);
      // Onderwater: blauwgroene zweem en iets minder contrast.
      col.rgb = mix(col.rgb, col.rgb * vec3(0.55, 0.85, 1.05) + vec3(0.0, 0.03, 0.07), uUnderwater);
      // Zachte vignette.
      float d = distance(vUv, vec2(0.5));
      col.rgb *= 1.0 - uVignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = col;
    }
  `
}

/**
 * Renderer, camera en postprocessing op één plek: ACES tone mapping, zachte
 * schaduwen, bloom + vignette, en ultrawide-vriendelijke Hor+ FOV.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private bloomPass: UnrealBloomPass
  private gradePass: ShaderPass
  private scene: THREE.Scene
  quality: Quality = 'high'
  private hFov = 100

  /** Basis horizontale FOV (op 16:9); ultrawide krijgt automatisch meer. */
  setHFov(deg: number): void {
    this.hFov = deg
    this.camera.fov = verticalFov(deg)
    this.camera.updateProjectionMatrix()
  }

  constructor(container: HTMLElement, scene: THREE.Scene) {
    this.scene = scene
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(verticalFov(this.hFov), 1, 0.1, 1450)

    // MSAA op de composer-rendertarget: gladde randen, ook mét postprocessing.
    const msaaTarget = new THREE.WebGLRenderTarget(1, 1, {
      samples: 4,
      type: THREE.HalfFloatType
    })
    this.composer = new EffectComposer(this.renderer, msaaTarget)
    this.composer.addPass(new RenderPass(scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.7, 0.86)
    this.composer.addPass(this.bloomPass)
    this.gradePass = new ShaderPass(GradeShader)
    this.composer.addPass(this.gradePass)
    this.composer.addPass(new OutputPass())

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  setQuality(q: Quality): void {
    this.quality = q
    this.renderer.shadowMap.enabled = q !== 'low'
    this.bloomPass.enabled = q === 'high'
    // Materialen opnieuw laten compileren zodat de schaduwtoggle doorwerkt.
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        const m = mesh.material as THREE.Material | THREE.Material[]
        if (Array.isArray(m)) m.forEach((mm) => (mm.needsUpdate = true))
        else if (m) m.needsUpdate = true
      }
    })
    this.resize()
  }

  get shadowsEnabled(): boolean {
    return this.quality !== 'low'
  }

  setUnderwater(underwater: boolean): void {
    const target = underwater ? 1 : 0
    const u = this.gradePass.uniforms['uUnderwater']
    u.value += (target - u.value) * 0.2
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const maxRatio = this.quality === 'high' ? 1.5 : this.quality === 'medium' ? 1.25 : 1
    const ratio = Math.min(window.devicePixelRatio || 1, maxRatio)
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.composer.setPixelRatio(ratio)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    if (this.quality === 'low') {
      this.renderer.render(this.scene, this.camera)
    } else {
      this.composer.render()
    }
  }
}
