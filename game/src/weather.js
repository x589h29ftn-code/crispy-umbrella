// Weersysteem: helder, mist, regen en onweer — met vloeiende overgangen.
// Regen valt niet door daken: elke druppel checkt de hoogtekaart (incl. gebouwde blokken).
window.Weather = (function () {
  const W = {};
  let scene = null;

  W.current = 'clear';       // 'clear' | 'mist' | 'rain' | 'storm'
  W.rainbow = 0;             // 0..1 sterkte van de regenboog
  W._rainbowT = 0;
  W._wasRaining = false;
  W.next = 'clear';
  W.intensity = 0;           // 0..1 van het huidige weertype
  let stateTimer = 60;       // seconden tot mogelijke weersverandering
  let transition = 1;        // 0..1 overgang naar W.current
  let rng = Math.random;

  // ---- regen als lijnsegmenten ----
  const RAIN_COUNT = 900;
  const RAIN_R = 26;
  let rainLines = null, rainPos = null, rainVel = null;

  // ---- bliksem ----
  let flashLight = null;
  let flashTime = 0;
  let nextBolt = 8;

  W.init = function (theScene, seed) {
    scene = theScene;
    rng = Noise.rng((seed ^ 0xabcdef) >>> 0);
    W.current = 'clear'; W.intensity = 0; transition = 1;
    stateTimer = 110 + rng() * 90;   // begin met een ruime zonnige periode

    if (!rainLines) {
      const geo = new THREE.BufferGeometry();
      rainPos = new Float32Array(RAIN_COUNT * 6);
      rainVel = new Float32Array(RAIN_COUNT);
      geo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xa8c4dd, transparent: true, opacity: 0.35, fog: true,
      });
      rainLines = new THREE.LineSegments(geo, mat);
      rainLines.frustumCulled = false;
      rainLines.visible = false;
      scene.add(rainLines);
    }
    if (!flashLight) {
      flashLight = new THREE.DirectionalLight(0xcfd8ff, 0);
      scene.add(flashLight);
      scene.add(flashLight.target);
    }
  };

  function pickNext() {
    const r = rng();
    // rustig spel: standaard zonnig, af en toe een buitje
    if (W.current === 'clear') {
      if (r < 0.72) return 'clear';
      if (r < 0.80) return 'mist';
      if (r < 0.95) return 'rain';
      return 'storm';
    }
    if (W.current === 'rain') {
      if (r < 0.62) return 'clear';
      if (r < 0.80) return 'rain';
      if (r < 0.90) return 'storm';
      return 'mist';
    }
    if (W.current === 'storm') {
      return r < 0.7 ? 'rain' : 'clear';
    }
    // mist
    return r < 0.75 ? 'clear' : (r < 0.88 ? 'mist' : 'rain');
  }

  function respawnDrop(i, px, py, pz, randomY) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * RAIN_R;
    const x = px + Math.cos(a) * rr;
    const z = pz + Math.sin(a) * rr;
    const y = py + 14 + rng() * (randomY ? 26 : 10);
    const o = i * 6;
    rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
    rainPos[o + 3] = x; rainPos[o + 4] = y - 0.9; rainPos[o + 5] = z;
    rainVel[i] = 26 + rng() * 10;
  }

  W.update = function (dt, playerPos, nightAmt) {
    // ---- toestandsmachine ----
    stateTimer -= dt;
    if (stateTimer <= 0) {
      const nxt = pickNext();
      if (nxt !== W.current) { W.current = nxt; transition = 0; }
      stateTimer = 50 + rng() * 100;
      if (W.current === 'storm') stateTimer = 35 + rng() * 45;
    }
    transition = Math.min(1, transition + dt / 12);   // ~12 s overgang

    const raining = (W.current === 'rain' || W.current === 'storm');
    const target = raining ? (W.current === 'storm' ? 1 : 0.6) : 0;
    W.intensity += (target - W.intensity) * Math.min(1, dt / 6);

    // ---- regenboog: verschijnt kort nadat de bui overtrekt, overdag ----
    const daytime = nightAmt < 0.35;
    if (W._wasRaining && W.intensity < 0.06 && daytime) W._rainbowT = 45;
    W._wasRaining = W.intensity > 0.35;
    if (W._rainbowT > 0) {
      W._rainbowT -= dt;
      W.rainbow = Math.min(1, W._rainbowT / 6) * (daytime ? 1 : 0);   // uitfaden aan het eind
    } else W.rainbow = 0;

    // ---- Sky-modulatie ----
    const wm = Sky.weatherMod;
    if (W.current === 'mist') {
      const t = transition;
      wm.fogMul = Noise.lerp(1, 0.35, t);
      wm.skyDesat = 0.45 * t;
      wm.lightMul = Noise.lerp(1, 0.75, t);
      wm.hazeAdd = 0.5 * t;
      wm.cloudOpacity = 0.5;
    } else if (raining) {
      const t = transition * (W.current === 'storm' ? 1 : 0.7);
      wm.fogMul = Noise.lerp(1, 0.55, t);
      wm.skyDesat = Noise.lerp(0, W.current === 'storm' ? 0.85 : 0.6, t);
      wm.lightMul = Noise.lerp(1, W.current === 'storm' ? 0.45 : 0.7, t);
      wm.hazeAdd = 0.25 * t;
      wm.cloudOpacity = 0.75;
    } else {
      const t = transition;
      wm.fogMul = Noise.lerp(wm.fogMul, 1, Math.min(1, dt));
      wm.skyDesat = Noise.lerp(wm.skyDesat, 0, Math.min(1, dt * 0.4));
      wm.lightMul = Noise.lerp(wm.lightMul, 1, Math.min(1, dt * 0.4));
      wm.hazeAdd = Noise.lerp(wm.hazeAdd, 0, Math.min(1, dt * 0.4));
      wm.cloudOpacity = 0.42;
    }

    // ---- regendruppels ----
    if (W.intensity > 0.02) {
      rainLines.visible = true;
      rainLines.material.opacity = 0.12 + W.intensity * 0.3;
      const active = Math.floor(RAIN_COUNT * W.intensity);
      for (let i = 0; i < RAIN_COUNT; i++) {
        const o = i * 6;
        if (i >= active) { rainPos[o + 1] = -100; rainPos[o + 4] = -100; continue; }
        if (rainPos[o + 1] <= -50) { respawnDrop(i, playerPos.x, playerPos.y, playerPos.z, true); continue; }
        const fall = rainVel[i] * dt;
        rainPos[o + 1] -= fall;
        rainPos[o + 4] -= fall;
        // occlusie: druppel stopt op het hoogste blok (ook zelfgebouwde daken)
        const top = Chunks.topBlockY(Math.floor(rainPos[o]), Math.floor(rainPos[o + 2]));
        if (rainPos[o + 1] < top + 1.05 || rainPos[o + 1] < playerPos.y - 20) {
          respawnDrop(i, playerPos.x, playerPos.y, playerPos.z, false);
        }
      }
      rainLines.geometry.attributes.position.needsUpdate = true;
    } else {
      rainLines.visible = false;
    }

    // ---- onweer ----
    if (W.current === 'storm' && transition > 0.5) {
      nextBolt -= dt;
      if (nextBolt <= 0) {
        flashTime = 0.18 + rng() * 0.15;
        nextBolt = 4 + rng() * 14;
        const a = rng() * Math.PI * 2;
        flashLight.position.set(playerPos.x + Math.cos(a) * 80, 120, playerPos.z + Math.sin(a) * 80);
        flashLight.target.position.copy(playerPos);
        if (window.Sfx) Sfx.thunder(1.2 + rng() * 2.5);
      }
    }
    if (flashTime > 0) {
      flashTime -= dt;
      flashLight.intensity = flashTime > 0 ? (2.2 + Math.sin(flashTime * 60) * 1.2) : 0;
    } else flashLight.intensity = 0;

    // ---- audio-parameters ----
    if (window.Sfx) Sfx.setRainLevel(W.intensity);

    return W.intensity;
  };

  // Voor opslaan/laden
  W.serialize = function () {
    return { current: W.current, intensity: W.intensity, timer: stateTimer };
  };
  W.deserialize = function (d) {
    if (!d) return;
    W.current = d.current || 'clear';
    W.intensity = d.intensity || 0;
    stateTimer = d.timer || 60;
    transition = 1;
  };

  return W;
})();
