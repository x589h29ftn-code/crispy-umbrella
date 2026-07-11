import * as THREE from 'three'

const DAY_LENGTH = 600 // seconden voor een volledige dag/nachtcyclus

// Keyframes over de dag (t in [0,1); 0 = middernacht, 0.5 = middag).
interface SkyKey {
  t: number
  top: THREE.Color
  horizon: THREE.Color
  sun: THREE.Color
  sunIntensity: number
  ambient: number
  fog: THREE.Color
}

function key(
  t: number,
  top: number,
  horizon: number,
  sun: number,
  sunIntensity: number,
  ambient: number,
  fog: number
): SkyKey {
  return {
    t,
    top: new THREE.Color(top),
    horizon: new THREE.Color(horizon),
    sun: new THREE.Color(sun),
    sunIntensity,
    ambient,
    fog: new THREE.Color(fog)
  }
}

const KEYS: SkyKey[] = [
  key(0.0, 0x0a1030, 0x141b38, 0x223355, 0.05, 0.16, 0x0d1226), // diepe nacht
  key(0.22, 0x1a2246, 0x4a3555, 0x774466, 0.1, 0.2, 0x241f33), // vroege ochtend
  key(0.28, 0x3f6ea8, 0xffb27a, 0xffc490, 0.55, 0.42, 0xd9a37a), // zonsopkomst
  key(0.38, 0x5aa0dd, 0xc4e2e2, 0xffeec2, 1.2, 0.62, 0xdde8d2), // ochtend, warme nevel
  key(0.5, 0x4f9ae2, 0xd4ecf0, 0xfff2cc, 1.4, 0.7, 0xe0ecd8), // middag, gouden zon
  key(0.62, 0x5aa0dd, 0xc9e4e6, 0xffe9b8, 1.2, 0.62, 0xdbe6d0), // middag laat
  key(0.72, 0x3f6ea8, 0xff9a5e, 0xffb070, 0.55, 0.42, 0xe09a6c), // zonsondergang
  key(0.78, 0x1a2246, 0x54395c, 0x774466, 0.12, 0.22, 0x241f33), // schemer
  key(1.0, 0x0a1030, 0x141b38, 0x223355, 0.05, 0.16, 0x0d1226) // nacht
]

/**
 * Lucht en licht: skydome-shader met zon, maan en sterren, plus de
 * bijbehorende DirectionalLight (met schaduwen) en HemisphereLight.
 * `timeOfDay` loopt van 0..1; start rond 09:30 's ochtends.
 */
export class Sky {
  readonly dome: THREE.Mesh
  readonly sun: THREE.DirectionalLight
  readonly hemi: THREE.HemisphereLight
  readonly fogColor = new THREE.Color()
  timeOfDay = 0.4
  private uniforms: {
    uTopColor: { value: THREE.Color }
    uHorizonColor: { value: THREE.Color }
    uSunDir: { value: THREE.Vector3 }
    uSunColor: { value: THREE.Color }
    uNight: { value: number }
  }

  constructor(scene: THREE.Scene) {
    this.uniforms = {
      uTopColor: { value: new THREE.Color() },
      uHorizonColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 }
    }

    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = pos.xyww; // altijd op de verste diepte
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uNight;

        // Hash voor het sterrenveld.
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.55));

          // Zonneschijf met warme gloed eromheen.
          float sunDot = dot(dir, uSunDir);
          float disc = smoothstep(0.9993, 0.9997, sunDot);
          float glow = pow(clamp(sunDot, 0.0, 1.0), 90.0) * 0.8;
          float halo = pow(clamp(sunDot, 0.0, 1.0), 8.0) * 0.12;
          col += uSunColor * (disc * 2.2 + glow + halo);

          // Maan tegenover de zon.
          float moonDot = dot(dir, -uSunDir);
          float moon = smoothstep(0.9995, 0.9998, moonDot);
          col += vec3(0.9, 0.93, 1.0) * moon * uNight;

          // Sterren: puntjes uit een hash-raster, alleen 's nachts.
          vec3 cell = floor(dir * 180.0);
          float star = step(0.9982, hash(cell));
          float twinkle = 0.6 + 0.4 * hash(cell + 7.0);
          col += vec3(star * twinkle) * uNight * smoothstep(0.05, 0.3, dir.y);

          gl_FragColor = vec4(col, 1.0);
        }
      `
    })

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material)
    this.dome.frustumCulled = false
    this.dome.renderOrder = -1
    // De dome schaalt mee met de camera-far in Game (scale wordt daar gezet).
    scene.add(this.dome)

    this.sun = new THREE.DirectionalLight(0xffffff, 1)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 400
    const ext = 85
    this.sun.shadow.camera.left = -ext
    this.sun.shadow.camera.right = ext
    this.sun.shadow.camera.top = ext
    this.sun.shadow.camera.bottom = -ext
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.5
    scene.add(this.sun)
    scene.add(this.sun.target)

    this.hemi = new THREE.HemisphereLight(0xbfd8ee, 0x47703c, 0.6)
    scene.add(this.hemi)
  }

  /** Interpoleert de keyframes rond tijdstip t. */
  private sample(t: number, out: SkyKey): void {
    let a = KEYS[0]
    let b = KEYS[KEYS.length - 1]
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) {
        a = KEYS[i]
        b = KEYS[i + 1]
        break
      }
    }
    const span = b.t - a.t || 1
    const f = (t - a.t) / span
    const s = f * f * (3 - 2 * f)
    out.top.lerpColors(a.top, b.top, s)
    out.horizon.lerpColors(a.horizon, b.horizon, s)
    out.sun.lerpColors(a.sun, b.sun, s)
    out.fog.lerpColors(a.fog, b.fog, s)
    out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * s
    out.ambient = a.ambient + (b.ambient - a.ambient) * s
  }

  private scratch: SkyKey = key(0, 0, 0, 0, 0, 0, 0)

  /** 0..1 hoe "nacht" het is (voor sterren, muziek en krekels). */
  get nightness(): number {
    return this.uniforms.uNight.value
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1
    const t = this.timeOfDay

    this.sample(t, this.scratch)
    const s = this.scratch

    // Zonnestand: op t=0.5 recht boven, draait om de oost-west-as.
    const angle = (t - 0.25) * Math.PI * 2
    const sunDir = new THREE.Vector3(Math.cos(angle) * 0.45, Math.sin(angle), 0.35).normalize()

    this.uniforms.uTopColor.value.copy(s.top)
    this.uniforms.uHorizonColor.value.copy(s.horizon)
    this.uniforms.uSunColor.value.copy(s.sun)
    this.uniforms.uSunDir.value.copy(sunDir)
    const night = 1 - THREE.MathUtils.smoothstep(sunDir.y, -0.18, 0.05)
    this.uniforms.uNight.value = night

    // Zonlicht volgt de speler zodat het schaduw-frustum altijd om je heen zit.
    this.sun.position.copy(playerPos).addScaledVector(sunDir, 180)
    this.sun.target.position.copy(playerPos)
    this.sun.color.copy(s.sun)
    this.sun.intensity = Math.max(0.02, s.sunIntensity)
    this.sun.castShadow = sunDir.y > 0.02 && this.shadowsEnabled

    this.hemi.intensity = s.ambient
    this.hemi.color.copy(s.top).lerp(new THREE.Color(0xffffff), 0.4)

    this.fogColor.copy(s.fog)
    this.dome.position.copy(playerPos)
  }

  shadowsEnabled = true

  /** Kloktijd als "HH:MM" voor de HUD. */
  get clockText(): string {
    const minutes = Math.floor(this.timeOfDay * 24 * 60)
    const hh = Math.floor(minutes / 60)
    const mm = minutes % 60
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
  }
}
