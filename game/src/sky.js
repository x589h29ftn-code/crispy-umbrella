// Lucht, zon, maan, sterren, wolken, mist en de dag/nachtcyclus.
window.Sky = (function () {
  const S = {};
  let scene, camera, renderer;

  let skyMesh, sunLight, moonLight, hemiLight, ambient;
  let clouds = null, cloudData = [];
  let stars = null;

  // Kleur-keyframes op zonhoogte (-1 .. 1)
  // [elevatie, top, horizon, zonlichtkleur, intensiteit, belichting]
  const KEYS = [
    [-1.00, 0x05070f, 0x0a0e1c, 0x223355, 0.00, 0.52],
    [-0.35, 0x070c1a, 0x0f1628, 0x223355, 0.00, 0.56],
    [-0.08, 0x141c36, 0x4f3348, 0xff8a48, 0.06, 0.66],
    [0.00, 0x39406e, 0xdd7f66, 0xffa055, 0.35, 0.76],
    [0.08, 0x5c7aa8, 0xeeae88, 0xffc084, 1.00, 0.86],
    [0.22, 0x6491c4, 0xe8bfa2, 0xffddac, 1.45, 0.92],
    [0.60, 0x5d92d2, 0xd8c4ae, 0xfff0d0, 1.65, 0.95],
    [1.00, 0x5890d2, 0xd0c8b6, 0xfff4dc, 1.70, 0.95],
  ];
  const cA = new THREE.Color(), cB = new THREE.Color();
  function keyLerp(e, idx, target) {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1][0] < e) i++;
    const k0 = KEYS[i], k1 = KEYS[i + 1];
    const t = Noise.clamp((e - k0[0]) / (k1[0] - k0[0]), 0, 1);
    if (idx <= 3) {
      cA.setHex(k0[idx]); cB.setHex(k1[idx]);
      target.copy(cA).lerp(cB, t);
      return target;
    }
    return Noise.lerp(k0[idx], k1[idx], t);
  }

  S.uniforms = {
    uTopColor: { value: new THREE.Color(0x87b3e2) },
    uHorizonColor: { value: new THREE.Color(0xdfd3c2) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff0d8) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uStars: { value: 0 },
    uHaze: { value: 0 },
    uTime: { value: 0 },
    uAurora: { value: 0 },
    uCloudsOn: { value: 1 },
    uCloudCover: { value: 0.5 },
    uCamPos: { value: new THREE.Vector3() },
    uNight: { value: 0 },
  };
  let skyTime = 0;

  S.init = function (theScene, theCamera, theRenderer) {
    scene = theScene; camera = theCamera; renderer = theRenderer;

    // ---- hemelkoepel ----
    const skyGeo = new THREE.SphereGeometry(900, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: S.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor, uHorizonColor, uSunColor;
        uniform vec3 uSunDir, uMoonDir, uCamPos;
        uniform float uStars, uHaze, uTime, uAurora, uCloudsOn, uCloudCover, uNight;
        varying vec3 vDir;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        // waarde-noise + fbm voor wolken
        float vnoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = hash(i + vec3(0,0,0)), n100 = hash(i + vec3(1,0,0));
          float n010 = hash(i + vec3(0,1,0)), n110 = hash(i + vec3(1,1,0));
          float n001 = hash(i + vec3(0,0,1)), n101 = hash(i + vec3(1,0,1));
          float n011 = hash(i + vec3(0,1,1)), n111 = hash(i + vec3(1,1,1));
          return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                     mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p *= 2.02; a *= 0.5; }
          return s;
        }
        // wolkdichtheid op een wereldpositie
        float cloudDensity(vec3 p) {
          vec3 q = p * 0.006;
          q.xz += uTime * 0.010;                        // wind
          float base = fbm(q);
          float d = base - (1.0 - uCloudCover) * 0.55;  // dekkingsdrempel
          d -= abs(p.y - 118.0) / 100.0;                // zachte verticale afronding
          return clamp(d * 2.7, 0.0, 1.0);
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 col = mix(uHorizonColor, uTopColor, pow(clamp(h, 0.0, 1.0), 0.55));
          if (h < 0.0) col = mix(uHorizonColor, uHorizonColor * 0.55, clamp(-h * 3.0, 0.0, 1.0));

          // nevel dichter bij de horizon (zoals op warme avonden)
          col = mix(col, uHorizonColor, uHaze * pow(1.0 - clamp(abs(h), 0.0, 1.0), 2.0) * 0.5);

          // zon: heldere schijf + meerdere gloedlagen (breed en zacht)
          float sd = dot(dir, normalize(uSunDir));
          float lowSun = 1.0 - clamp(uSunDir.y * 2.2, 0.0, 1.0);
          col += uSunColor * pow(clamp(sd, 0.0, 1.0), 1400.0) * 2.0;                 // schijf
          col += uSunColor * pow(clamp(sd, 0.0, 1.0), 24.0) * (0.32 + lowSun * 0.4); // binnengloed
          col += uSunColor * pow(clamp(sd, 0.0, 1.0), 4.0) * (0.14 + lowSun * 0.34); // middengloed
          col += uSunColor * pow(clamp(sd, 0.0, 1.0), 1.6) * (0.05 + lowSun * 0.12); // brede halo

          // maan: schijf + zachte blauwe gloed
          float md = dot(dir, normalize(uMoonDir));
          col += vec3(0.9, 0.94, 1.0) * pow(clamp(md, 0.0, 1.0), 2200.0) * 1.4;
          col += vec3(0.6, 0.7, 0.95) * pow(clamp(md, 0.0, 1.0), 60.0) * 0.16;
          col += vec3(0.4, 0.5, 0.85) * pow(clamp(md, 0.0, 1.0), 8.0) * 0.07;

          // noorderlicht: golvende groene gordijnen hoog in de hemel
          if (uAurora > 0.01 && h > 0.08) {
            float curtain = sin(dir.x * 7.0 + uTime * 0.5 + sin(dir.z * 4.0 + uTime * 0.25) * 2.2);
            float band = sin(dir.x * 2.3 - dir.z * 1.7 + uTime * 0.15);
            float hMask = smoothstep(0.12, 0.45, h) * (1.0 - smoothstep(0.55, 0.95, h));
            float a = hMask * pow(max(curtain, 0.0), 2.0) * (0.6 + 0.4 * band) * uAurora;
            col += vec3(0.18, 0.95, 0.55) * a * 0.6;
            col += vec3(0.35, 0.18, 0.85) * a * 0.18;
          }

          // sterren
          if (uStars > 0.01 && h > 0.02) {
            vec3 cell = floor(dir * 220.0);
            float s = hash(cell);
            if (s > 0.997) {
              float tw = hash(cell + 7.0) * 6.283;
              col += vec3(1.0) * uStars * (0.5 + 0.5 * sin(tw + uHaze * 20.0)) *
                     smoothstep(0.997, 1.0, s) * 0.9;
            }
          }

          // volumetrische wolken (raymarch door een horizontale laag)
          if (uCloudsOn > 0.5 && dir.y > 0.02) {
            float h0 = 92.0, h1 = 145.0;
            float t0 = max((h0 - uCamPos.y) / dir.y, 0.0);
            float t1 = (h1 - uCamPos.y) / dir.y;
            if (t1 > t0) {
              float T = 1.0;
              vec3 acc = vec3(0.0);
              vec3 sunN = normalize(uSunDir);
              const int N = 6;
              for (int i = 0; i < N; i++) {
                float t = mix(t0, t1, (float(i) + 0.5) / float(N));
                if (t > 900.0) break;
                vec3 pos = uCamPos + dir * t;
                float d = cloudDensity(pos);
                if (d > 0.01) {
                  // belichting: dichtheid richting de zon geeft schaduw
                  float ld = cloudDensity(pos + sunN * 9.0);
                  float lit = clamp(1.0 - ld, 0.25, 1.0);
                  vec3 lite = mix(uHorizonColor * 0.7, uSunColor, 0.6) * (0.55 + lit);
                  vec3 shade = mix(vec3(0.32, 0.34, 0.40), lite, lit);
                  shade = mix(shade, vec3(0.10, 0.12, 0.20), uNight * 0.7);
                  float a = d * 0.55;
                  acc += T * a * shade;
                  T *= 1.0 - a;
                  if (T < 0.02) break;
                }
              }
              float cover = 1.0 - T;
              float horizonFade = smoothstep(0.0, 0.07, dir.y);
              col = mix(col, acc / max(cover, 0.001), cover * horizonFade);
            }
          }

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }
      `,
    });
    skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -10;
    scene.add(skyMesh);

    // ---- lichten ----
    sunLight = new THREE.DirectionalLight(0xfff0d8, 1.2);
    sunLight.castShadow = true;
    // scherpere schaduwen: hogere resolutie + strakkere frustum rond de speler
    sunLight.shadow.mapSize.set(3072, 3072);
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 360;
    const ext = 62;
    sunLight.shadow.camera.left = -ext; sunLight.shadow.camera.right = ext;
    sunLight.shadow.camera.top = ext; sunLight.shadow.camera.bottom = -ext;
    sunLight.shadow.camera.updateProjectionMatrix();
    sunLight.shadow.bias = -0.0003;
    sunLight.shadow.normalBias = 0.06;
    scene.add(sunLight);
    scene.add(sunLight.target);

    moonLight = new THREE.DirectionalLight(0x8899cc, 0.0);
    scene.add(moonLight);
    scene.add(moonLight.target);

    hemiLight = new THREE.HemisphereLight(0xbcd8f0, 0x5a6a50, 0.7);
    scene.add(hemiLight);

    ambient = new THREE.AmbientLight(0x404860, 0.35);
    scene.add(ambient);

    scene.fog = new THREE.Fog(0xdfd3c2, 60, 300);

    // ---- wolken: blokkige, langzaam drijvende platen ----
    buildClouds();

    // ---- sterrenbeelden: enkele heldere sterren in vaste patronen ----
    buildConstellations();

    // ---- vallende sterren ----
    initShootingStars();
  };

  // Heldere sterren gegroepeerd in een paar herkenbare clusters
  let constellations = null;
  function buildConstellations() {
    const rng = Noise.rng(0xC0FFEE);
    const pos = [], col = [];
    const R = 880;
    const clusters = 7;
    for (let c = 0; c < clusters; c++) {
      const ca = rng() * Math.PI * 2, ce = 0.25 + rng() * 0.9;
      const n = 4 + ((rng() * 5) | 0);
      for (let i = 0; i < n; i++) {
        const a = ca + (rng() - 0.5) * 0.5, e = ce + (rng() - 0.5) * 0.4;
        const ce2 = Math.cos(e);
        pos.push(Math.cos(a) * ce2 * R, Math.sin(e) * R, Math.sin(a) * ce2 * R);
        const w = 0.8 + rng() * 0.2;
        col.push(w, w, 1.0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 5, vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: false,
    });
    constellations = new THREE.Points(geo, mat);
    constellations.frustumCulled = false;
    constellations.renderOrder = -9;
    scene.add(constellations);
  }

  // ---- vallende sterren ----
  const SHOOTERS = 3;
  const shooters = [];
  let shootTimer = 6;
  function initShootingStars() {
    for (let i = 0; i < SHOOTERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = -8;
      scene.add(line);
      shooters.push({ line, life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    }
  }
  function updateShootingStars(dt, nightAmt, playerPos) {
    shootTimer -= dt;
    if (shootTimer <= 0 && nightAmt > 0.5) {
      shootTimer = 5 + Math.random() * 12;
      const s = shooters.find((o) => o.life <= 0);
      if (s) {
        const a = Math.random() * Math.PI * 2;
        const e = 0.55 + Math.random() * 0.35;
        const R = 500;
        s.pos.set(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R);
        // schuine baan langs de hemel
        s.vel.set(-Math.sin(a) * 260 + (Math.random() - 0.5) * 80, -60 - Math.random() * 60, Math.cos(a) * 260);
        s.life = 0.7 + Math.random() * 0.6;
        s.maxLife = s.life;
      }
    }
    for (const s of shooters) {
      if (s.life <= 0) { s.line.material.opacity = 0; continue; }
      s.life -= dt;
      s.pos.addScaledVector(s.vel, dt);
      const tail = s.pos.clone().addScaledVector(s.vel, -0.08);
      const p = s.line.geometry.attributes.position;
      p.setXYZ(0, playerPos.x + s.pos.x, playerPos.y + s.pos.y, playerPos.z + s.pos.z);
      p.setXYZ(1, playerPos.x + tail.x, playerPos.y + tail.y, playerPos.z + tail.z);
      p.needsUpdate = true;
      s.line.material.opacity = Math.max(0, s.life / s.maxLife) * nightAmt;
    }
  }

  // Volumetrische wolken zitten in de hemel-shader; hier alleen aan/uit schakelen
  function buildClouds() {
    S.uniforms.uCloudsOn.value = G.settings.clouds ? 1 : 0;
  }
  S.rebuildClouds = buildClouds;

  const _m4 = new THREE.Matrix4();
  const _sunDir = new THREE.Vector3();

  // Weer-modulatie wordt door weather.js gezet
  S.weatherMod = { fogMul: 1, skyDesat: 0, lightMul: 1, hazeAdd: 0, cloudOpacity: 0.42 };

  S.update = function (dt, playerPos) {
    skyTime += dt;
    S.uniforms.uTime.value = skyTime;
    // tijd laten verlopen
    G.timeSec += dt;
    const cyc = G.cycleLen();
    G.dayNumber = 1 + Math.floor(G.timeSec / cyc);

    const tod = G.timeOfDay();
    const e = G.sunElevation();

    // zonpositie: boog over de hemel
    const ang = tod.sunUp ? tod.phase * Math.PI : Math.PI + tod.phase * Math.PI;
    _sunDir.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    S.uniforms.uSunDir.value.copy(_sunDir);
    S.uniforms.uMoonDir.value.copy(_sunDir).multiplyScalar(-1);

    // kleuren via keyframes
    keyLerp(e, 1, S.uniforms.uTopColor.value);
    keyLerp(e, 2, S.uniforms.uHorizonColor.value);
    keyLerp(e, 3, S.uniforms.uSunColor.value);
    let sunI = keyLerp(e, 4);
    let expo = keyLerp(e, 5);

    const wm = S.weatherMod;
    // weer: lucht vergrijzen en licht dempen
    if (wm.skyDesat > 0) {
      const grey = 0.55;
      const t = wm.skyDesat;
      const topc = S.uniforms.uTopColor.value, horc = S.uniforms.uHorizonColor.value;
      const tl = topc.r * 0.3 + topc.g * 0.6 + topc.b * 0.1;
      const hl = horc.r * 0.3 + horc.g * 0.6 + horc.b * 0.1;
      topc.lerp(cA.setRGB(tl * grey + 0.22, tl * grey + 0.24, tl * grey + 0.27), t);
      horc.lerp(cB.setRGB(hl * grey + 0.30, hl * grey + 0.31, hl * grey + 0.33), t);
      sunI *= (1 - t * 0.85);
    }
    sunI *= wm.lightMul;

    S.uniforms.uStars.value = Noise.smoothstep(0.0, -0.22, e) * (1 - wm.skyDesat * 0.9);
    S.uniforms.uHaze.value = 0.35 + wm.hazeAdd;

    // zonlicht volgt de speler zodat de schaduwcamera dichtbij blijft
    sunLight.position.copy(playerPos).addScaledVector(_sunDir, 160);
    sunLight.target.position.copy(playerPos);
    sunLight.intensity = Math.max(0, sunI);
    sunLight.color.copy(S.uniforms.uSunColor.value);
    sunLight.castShadow = G.settings.shadows && sunI > 0.05;

    const nightAmt = Noise.smoothstep(0.05, -0.25, e);
    moonLight.position.copy(playerPos).addScaledVector(_sunDir, -140);
    moonLight.target.position.copy(playerPos);
    moonLight.intensity = nightAmt * 0.22 * wm.lightMul;

    // gedempt omgevingslicht zodat zonlicht en schaduw echt contrast geven
    hemiLight.color.copy(S.uniforms.uTopColor.value).lerp(cA.setRGB(1, 0.98, 0.92), 0.35);
    hemiLight.groundColor.setRGB(0.34, 0.40, 0.28).lerp(cA.setRGB(0.04, 0.05, 0.09), nightAmt);
    hemiLight.intensity = 0.22 + (1 - nightAmt) * 0.52;

    ambient.intensity = 0.12 + (1 - nightAmt) * 0.12;
    ambient.color.setRGB(0.42 + nightAmt * 0.05, 0.46, 0.5);

    renderer.toneMappingExposure = expo * (1 - wm.skyDesat * 0.15);

    // mist gekoppeld aan kijkafstand, weer en instelling
    const viewDist = G.settings.renderDist * G.CS;
    const fog = scene.fog;
    fog.color.copy(S.uniforms.uHorizonColor.value);
    const fm = G.settings.fogMul * wm.fogMul;
    fog.near = Math.max(8, viewDist * 0.28 / fm);
    fog.far = Math.max(24, viewDist * 1.0 / fm);

    // seizoensgrading: winter koeler/helderder, herfst warmer
    if (G.season.idx === 3) {
      fog.color.lerp(cA.setRGB(0.82, 0.86, 0.93), 0.28);
      sunLight.color.lerp(cB.setRGB(0.85, 0.9, 1.0), 0.25);
      renderer.toneMappingExposure *= 1.05;
    } else if (G.season.idx === 2) {
      fog.color.lerp(cA.setRGB(0.86, 0.72, 0.52), 0.18);
      sunLight.color.lerp(cB.setRGB(1.0, 0.88, 0.7), 0.2);
    } else if (G.season.idx === 0) {
      fog.color.lerp(cA.setRGB(0.80, 0.88, 0.82), 0.10);
    }

    // doorschijnend blad/gras voeden met de zonrichting/-kleur
    if (Chunks.foliageUniforms) {
      Chunks.foliageUniforms.uSunDir.value.copy(_sunDir);
      Chunks.foliageUniforms.uSunColor.value.copy(S.uniforms.uSunColor.value).multiplyScalar(Math.max(0, e));
    }

    // waterschader voeden
    const wu = Chunks.waterUniforms;
    wu.uSunDir.value.copy(_sunDir);
    wu.uSunColor.value.copy(S.uniforms.uSunColor.value);
    wu.uSkyColor.value.copy(S.uniforms.uTopColor.value);
    wu.uHorizonColor.value.copy(S.uniforms.uHorizonColor.value);
    wu.uCamPos.value.copy(camera.position);
    wu.fogColor.value.copy(fog.color);
    wu.fogNear.value = fog.near;
    wu.fogFar.value = fog.far;

    // koepel volgt de speler; wolken-uniforms voeden
    skyMesh.position.copy(playerPos);
    S.uniforms.uCamPos.value.copy(camera.position);
    S.uniforms.uNight.value = nightAmt;
    S.uniforms.uCloudsOn.value = G.settings.clouds ? 1 : 0;
    // meer bewolking bij regen/onweer
    S.uniforms.uCloudCover.value = Noise.lerp(0.45, 0.85, wm.skyDesat) + wm.hazeAdd * 0.2;

    // noorderlicht (sterker in de winter), sterrenbeelden en vallende sterren
    const winter = G.season.idx === 3 ? 1 : 0;
    const slow = 0.5 + 0.5 * Math.sin(skyTime * 0.05 + 1.3);
    S.uniforms.uAurora.value = nightAmt * (0.2 + winter * 0.55) * slow * (1 - wm.skyDesat);
    if (constellations) {
      constellations.position.copy(playerPos);
      const tw = 0.85 + 0.15 * Math.sin(skyTime * 1.5);
      constellations.material.opacity = S.uniforms.uStars.value * tw;
    }
    updateShootingStars(dt, nightAmt, playerPos);

    return { elevation: e, nightAmt, sunDir: _sunDir };
  };

  return S;
})();
