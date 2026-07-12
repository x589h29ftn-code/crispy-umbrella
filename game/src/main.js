// Hoofdmodule: renderer, scene, spelloop en spelstatus (nieuw spel / laden / pauze).
window.Main = (function () {
  const M = {};

  let renderer, scene, camera;
  let lastFrame = 0;
  let autosaveTimer = 0;
  let elapsed = 0;
  let loadingWorld = false;
  let lastSeasonIdx = -1;
  let frames = 0, fpsTime = 0;
  const _sunV = new THREE.Vector3();

  // ---- opstarten ----
  function boot() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyPixelRatio();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.getElementById('app').appendChild(renderer.domElement);

    // scherpere textures met maximale anisotropie
    try {
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      Textures.texture.anisotropy = Math.min(16, maxAniso);
      Textures.texture.needsUpdate = true;
    } catch (e) {}

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(G.settings.fov, window.innerWidth / window.innerHeight, 0.08, 1400);
    scene.add(camera);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      Post.resize();
      if (reflectRT) sizeReflectRT();
    });

    Post.init(renderer, scene, camera);
    setupReflection();
    camera.layers.enable(1);      // hoofdcamera ziet ook het water (laag 1)
    UI.init();

    // Pointer lock kwijt = pauze; klik op het canvas pakt de lock (weer) op
    let lockGrace = 0;
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== renderer.domElement && G.state === 'playing') {
        // browsers blokkeren re-lock kort na een unlock — dan pauzeren we netjes
        lockGrace = performance.now();
        M.pause();
      }
    });
    renderer.domElement.addEventListener('click', () => {
      if (G.state === 'playing' && document.pointerLockElement !== renderer.domElement &&
          performance.now() - lockGrace > 1200) {
        requestLock();
      }
    });

    applyGraphics();
    renderer.setAnimationLoop(loop);
  }

  function applyPixelRatio() {
    const scale = G.settings.renderScale || 1;
    renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * scale, 2.5));
  }

  // ---- planaire waterreflectie ----
  let reflectCamera, reflectRT, reflectTexMatrix, reflectMirror;
  let reflectionsOn = true;
  const WATER_SURF = G.SEA + 0.86;
  function setupReflection() {
    reflectCamera = new THREE.PerspectiveCamera();
    reflectCamera.matrixAutoUpdate = false;
    reflectCamera.layers.set(0);      // reflectie rendert alles behalve water (laag 1)
    reflectTexMatrix = new THREE.Matrix4();
    reflectMirror = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, -1, 0, 2 * WATER_SURF,
      0, 0, 1, 0,
      0, 0, 0, 1);
    sizeReflectRT();
  }
  function sizeReflectRT() {
    const s = new THREE.Vector2();
    renderer.getDrawingBufferSize(s);
    const w = Math.max(2, (s.x * 0.5) | 0), h = Math.max(2, (s.y * 0.5) | 0);
    if (reflectRT) reflectRT.dispose();
    reflectRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.UnsignedByteType, depthBuffer: true,
    });
  }
  const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  function renderReflection() {
    const wu = Chunks.waterUniforms;
    if (!reflectionsOn || camera.position.y < WATER_SURF + 0.2) { wu.uReflectOn.value = 0; return; }
    // spiegelcamera opbouwen
    reflectCamera.matrixWorld.multiplyMatrices(reflectMirror, camera.matrixWorld);
    reflectCamera.matrixWorldInverse.copy(reflectCamera.matrixWorld).invert();
    reflectCamera.projectionMatrix.copy(camera.projectionMatrix);
    reflectCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    reflectTexMatrix.multiplyMatrices(_bias, reflectCamera.projectionMatrix);
    reflectTexMatrix.multiply(reflectCamera.matrixWorldInverse);

    const gl = renderer.getContext();
    gl.frontFace(gl.CW);          // gespiegelde winding corrigeren
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(reflectRT);
    renderer.clear();
    renderer.render(scene, reflectCamera);
    renderer.setRenderTarget(prevTarget);
    gl.frontFace(gl.CCW);

    wu.uReflect.value = reflectRT.texture;
    wu.uReflectMatrix.value.copy(reflectTexMatrix);
    wu.uReflectOn.value = 1;
  }

  function applyGraphics() {
    Post.enabled = !!G.settings.postFX;
    Post.bloom = !!G.settings.bloom;
    Post.vignette = !!G.settings.vignette;
    Post.godrays = !!G.settings.godrays;
    Post.ssao = !!G.settings.ssao;
    Post.dof = !!G.settings.dof;
    reflectionsOn = !!G.settings.reflections;
    applyPixelRatio();
    Post.resize();
    if (reflectRT) sizeReflectRT();
  }
  M.applyGraphics = applyGraphics;

  // presenteer een frame (via post-processing indien aan)
  function present() { Post.render(); }

  // ---- wereld starten ----
  function initWorld(seed, saveData) {
    loadingWorld = true;
    UI.hideAll();
    UI.setLoading(true, 0, 'Wereld wordt opgebouwd…');

    World.init(seed);
    G.clearEdits();
    G.timeSec = saveData ? (saveData.timeSec || 0) : G.settings.dayMinutes * 60 * 0.12; // begin in de ochtend
    // seizoen meteen zetten zodat de eerste chunks de juiste tint krijgen
    const si0 = G.seasonInfo();
    G.season.idx = si0.idx; G.season.name = si0.name; G.season.t = si0.t;
    G.season.grass = si0.grass; G.season.leaf = si0.leaf; G.season.frost = si0.frost;
    lastSeasonIdx = si0.idx;
    Weather.deserialize(saveData ? saveData.weather : null);

    if (saveData && saveData.edits) {
      for (const [x, y, z, id] of saveData.edits) G.recordEdit(x, y, z, id);
    }
    if (saveData && saveData.metas) {
      for (const [x, y, z, v] of saveData.metas) G.setMeta(x, y, z, v);
    }

    Chunks.reset ? Chunks.reset() : null;
    Chunks.init(scene);
    Entities.reset();
    Boats.reset();
    WaterSim.reset();
    if (saveData && saveData.water) WaterSim.deserialize(saveData.water);
    Crops.reset();

    if (saveData && saveData.player) Player.deserialize(saveData.player);
    else Player.spawn();

    // chunks rond de speler alvast genereren, met voortgangsbalk
    const total = Math.max(1, 60);
    let done = 0;
    const step = () => {
      const t0 = performance.now();
      let pending = 1;
      while (performance.now() - t0 < 40) {
        pending = Chunks.update(Player.pos.x, Player.pos.z, 20);
        if (pending === 0) break;
      }
      done++;
      UI.setLoading(true, Math.min(0.95, done / total), 'Wereld wordt opgebouwd…');
      // alleen de binnenste chunks vooraf laden; de rest streamt tijdens het spelen
      if (pending > 0 && done < 300 && Chunks.map.size < 150) {
        requestAnimationFrame(step);
      } else {
        finishLoad();
      }
    };
    requestAnimationFrame(step);
  }

  function finishLoad() {
    // speler netjes op de grond zetten
    const gy = Chunks.groundY(Player.pos.x, Player.pos.z);
    if (Player.pos.y < gy + 1) Player.pos.y = gy + 2;
    UI.setLoading(false);
    loadingWorld = false;
    M.resume();
    UI.toast('Veel plezier — druk op H voor de besturing 🌿');
  }

  M.newGame = function (seed) {
    initWorld(seed, null);
  };

  M.loadGame = function (slot) {
    const data = UI.loadGameData(slot);
    if (!data) { UI.toast('Geen opgeslagen spel gevonden.'); return; }
    initWorld(data.seed, data);
  };

  M.loadFromData = function (data) {
    if (!data || data.seed === undefined) { UI.toast('Ongeldig wereldbestand.'); return; }
    initWorld(data.seed >>> 0, data);
  };

  // screenshot van het huidige beeld (voor de fotomodus)
  M.captureScreenshot = function () {
    try {
      const dataUrl = renderer.domElement.toDataURL('image/png');
      UI.takeScreenshot(dataUrl);
    } catch (e) { UI.toast('Screenshot mislukt.'); }
  };

  M.toMainMenu = function () {
    UI.saveGame('auto');
    G.state = 'menu';
    UI.setHud(false);
    Sfx.suspend();
    UI.showMain();
  };

  M.pause = function (silent) {
    if (G.state !== 'playing') return;
    G.state = 'paused';
    if (document.pointerLockElement) document.exitPointerLock();
    if (!silent) UI.showPause();
    Sfx.suspend();
  };

  M.resume = function () {
    UI.hideAll();
    G.state = 'playing';
    UI.setHud(true);
    Sfx.start();
    Sfx.resume();
    requestLock();
  };

  // Pointer lock kan alleen binnen een klik-gesture; anders vangt de
  // canvas-klik hem alsnog op.
  function requestLock() {
    try {
      const p = renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => UI.hint('Klik in het spel om rond te kijken'));
    } catch (e) {
      UI.hint('Klik in het spel om rond te kijken');
    }
  }

  M.onRenderDistChanged = function () {
    Chunks.onRenderDistChanged();
  };
  M.onFovChanged = function () {
    camera.fov = G.settings.fov;
    camera.updateProjectionMatrix();
  };

  // ---- spelloop ----
  function loop(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;

    if (G.state === 'menu' && !loadingWorld) {
      // stilstaand achtergrondbeeld in het menu
      present();
      return;
    }
    if (G.state !== 'playing') {
      present();
      return;
    }

    elapsed += dt;
    Chunks.timeUniform.value = elapsed;

    // seizoen bijwerken; bij een wisseling de wereld hertekenen
    const si = G.seasonInfo();
    G.season.idx = si.idx; G.season.name = si.name; G.season.t = si.t;
    G.season.grass = si.grass; G.season.leaf = si.leaf; G.season.frost = si.frost;
    if (si.idx !== lastSeasonIdx) {
      if (lastSeasonIdx !== -1) { Chunks.remeshAll(); UI.toast('Het seizoen wisselt naar ' + si.name.toLowerCase() + ' 🍃'); }
      lastSeasonIdx = si.idx;
    }

    // wereld-streaming (tijdbudget per frame)
    Chunks.update(Player.pos.x, Player.pos.z, 5);

    Player.update(dt, elapsed);
    WaterSim.update(dt);
    Crops.update(dt);

    const sunInfo = Sky.update(dt, Player.pos);
    const rainLevel = Weather.update(dt, Player.pos, sunInfo.nightAmt);
    Entities.update(dt, elapsed, Player.pos, sunInfo, camera);
    Boats.update(dt, Player.pos);

    // onder water: dichte blauwe mist
    if (Player.eyeInWater()) {
      scene.fog.color.setRGB(0.08, 0.22, 0.32);
      scene.fog.near = 1;
      scene.fog.far = 14;
      renderer.toneMappingExposure *= 0.85;
    }

    // audio-omgeving
    Sfx.updateNature(dt, sunInfo.nightAmt, rainLevel);
    Sfx.setWindLevel(Weather.current === 'storm' ? 0.8 : (Weather.current === 'rain' ? 0.4 : 0.12));
    // kampvuur-nabijheid
    const fires = Chunks.nearbyTorches(Player.pos.x, Player.pos.y, Player.pos.z, 14).filter((o) => o.big);
    let fireLvl = 0;
    for (const f of fires) fireLvl = Math.max(fireLvl, 1 - Math.sqrt(f.d2) / 12);
    Sfx.setCampfireLevel(Math.max(0, fireLvl));
    Sfx.updateCampfire(dt);

    UI.updateClock();

    // autosave elke 60 s
    autosaveTimer += dt;
    if (autosaveTimer > 60) {
      autosaveTimer = 0;
      UI.saveGame('auto');
    }

    // zon-schermpositie voor de zonnestralen
    _sunV.copy(camera.position).addScaledVector(sunInfo.sunDir, 500).project(camera);
    const sunVis = sunInfo.sunDir.y > 0.03 && _sunV.z < 1 &&
      _sunV.x > -1.35 && _sunV.x < 1.35 && _sunV.y > -1.35 && _sunV.y < 1.35;
    Post.setSun(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5, sunVis);

    // FPS-teller
    frames++; fpsTime += dt;
    if (fpsTime >= 0.5) { UI.updateFps(Math.round(frames / fpsTime)); frames = 0; fpsTime = 0; }

    camera.updateMatrixWorld();
    renderReflection();
    present();
  }

  // ---- init op laden van de pagina ----
  window.addEventListener('DOMContentLoaded', () => {
    boot();
    // modules die de scene nodig hebben
    Sky.init(scene, camera, renderer);
    Weather.init(scene, 1);
    Entities.init(scene, 1);
    Boats.init(scene, 1);
    Player.init(camera, renderer.domElement, scene);
    World.init(1337);
    Chunks.init(scene);
  });

  return M;
})();
