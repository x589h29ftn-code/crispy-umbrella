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
    [-1.00, 0x070a18, 0x0d1326, 0x223355, 0.00, 0.62],
    [-0.35, 0x081020, 0x101a30, 0x223355, 0.00, 0.66],
    [-0.08, 0x18203c, 0x4a3550, 0xff9a55, 0.05, 0.74],
    [0.00, 0x3a4a74, 0xe8926a, 0xffb070, 0.25, 0.86],
    [0.10, 0x6f95c8, 0xf2b891, 0xffcf9a, 0.75, 1.00],
    [0.30, 0x87b3e2, 0xdfd3c2, 0xfff0d8, 1.05, 1.06],
    [0.70, 0x7fb0e8, 0xd5e2ea, 0xfff6e8, 1.25, 1.10],
    [1.00, 0x77ace8, 0xd0e0ec, 0xfffaf0, 1.30, 1.10],
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
  };

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
        uniform vec3 uSunDir, uMoonDir;
        uniform float uStars, uHaze;
        varying vec3 vDir;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 col = mix(uHorizonColor, uTopColor, pow(clamp(h, 0.0, 1.0), 0.55));
          if (h < 0.0) col = mix(uHorizonColor, uHorizonColor * 0.55, clamp(-h * 3.0, 0.0, 1.0));

          // nevel dichter bij de horizon (zoals op warme avonden)
          col = mix(col, uHorizonColor, uHaze * pow(1.0 - clamp(abs(h), 0.0, 1.0), 2.0) * 0.5);

          // zon
          float sd = dot(dir, normalize(uSunDir));
          col += uSunColor * pow(clamp(sd, 0.0, 1.0), 900.0) * 1.6;
          col += uSunColor * pow(clamp(sd, 0.0, 1.0), 24.0) * 0.30;
          col += uSunColor * pow(clamp(sd, 0.0, 1.0), 5.0) * 0.12;

          // maan
          float md = dot(dir, normalize(uMoonDir));
          col += vec3(0.85, 0.9, 1.0) * pow(clamp(md, 0.0, 1.0), 1600.0) * 1.1;
          col += vec3(0.5, 0.6, 0.85) * pow(clamp(md, 0.0, 1.0), 40.0) * 0.12;

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
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 400;
    const ext = 90;
    sunLight.shadow.camera.left = -ext; sunLight.shadow.camera.right = ext;
    sunLight.shadow.camera.top = ext; sunLight.shadow.camera.bottom = -ext;
    sunLight.shadow.bias = -0.0006;
    sunLight.shadow.normalBias = 0.5;
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
  };

  function buildClouds() {
    if (clouds) { scene.remove(clouds); clouds.geometry.dispose(); clouds.material.dispose(); clouds = null; }
    if (!G.settings.clouds) return;
    const COUNT = 140;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false, fog: false,
    });
    clouds = new THREE.InstancedMesh(geo, mat, COUNT);
    clouds.frustumCulled = false;
    cloudData = [];
    const rng = Noise.rng(G.seed ^ 0x9e3779b9);
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) {
      const d = {
        x: (rng() - 0.5) * 800,
        z: (rng() - 0.5) * 800,
        y: 105 + rng() * 14,
        w: 14 + rng() * 34,
        d: 10 + rng() * 26,
        h: 2.5 + rng() * 2,
      };
      cloudData.push(d);
      m.makeScale(d.w, d.h, d.d);
      m.setPosition(d.x, d.y, d.z);
      clouds.setMatrixAt(i, m);
    }
    scene.add(clouds);
  }
  S.rebuildClouds = buildClouds;

  const _m4 = new THREE.Matrix4();
  const _sunDir = new THREE.Vector3();

  // Weer-modulatie wordt door weather.js gezet
  S.weatherMod = { fogMul: 1, skyDesat: 0, lightMul: 1, hazeAdd: 0, cloudOpacity: 0.42 };

  S.update = function (dt, playerPos) {
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

    hemiLight.color.copy(S.uniforms.uTopColor.value).lerp(cA.setRGB(1, 1, 1), 0.35);
    hemiLight.groundColor.setRGB(0.32, 0.36, 0.28).lerp(cA.setRGB(0.04, 0.05, 0.09), nightAmt);
    hemiLight.intensity = 0.16 + (1 - nightAmt) * 0.62;

    ambient.intensity = 0.10 + (1 - nightAmt) * 0.14;
    ambient.color.setRGB(0.35 + nightAmt * 0.05, 0.38, 0.55);

    renderer.toneMappingExposure = expo * (1 - wm.skyDesat * 0.15);

    // mist gekoppeld aan kijkafstand, weer en instelling
    const viewDist = G.settings.renderDist * G.CS;
    const fog = scene.fog;
    fog.color.copy(S.uniforms.uHorizonColor.value);
    const fm = G.settings.fogMul * wm.fogMul;
    fog.near = Math.max(8, viewDist * 0.28 / fm);
    fog.far = Math.max(24, viewDist * 1.0 / fm);

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

    // koepel en wolken volgen de speler
    skyMesh.position.copy(playerPos);

    if (clouds) {
      clouds.material.opacity = wm.cloudOpacity * (0.3 + 0.7 * (1 - nightAmt));
      clouds.material.color.setRGB(1, 1, 1).lerp(cA.setRGB(0.35, 0.4, 0.55), nightAmt);
      const drift = G.timeSec * 1.6;
      for (let i = 0; i < cloudData.length; i++) {
        const d = cloudData[i];
        let x = d.x + drift;
        // wolkenveld herhaalt zich rond de speler
        x = ((x - playerPos.x + 400) % 800 + 800) % 800 - 400 + playerPos.x;
        const z = ((d.z - playerPos.z + 400) % 800 + 800) % 800 - 400 + playerPos.z;
        _m4.makeScale(d.w, d.h, d.d);
        _m4.setPosition(x, d.y, z);
        clouds.setMatrixAt(i, _m4);
      }
      clouds.instanceMatrix.needsUpdate = true;
    }

    return { elevation: e, nightAmt, sunDir: _sunDir };
  };

  return S;
})();
