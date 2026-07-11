// Hoofdmodule: renderer, scene, spelloop en spelstatus (nieuw spel / laden / pauze).
window.Main = (function () {
  const M = {};

  let renderer, scene, camera;
  let lastFrame = 0;
  let autosaveTimer = 0;
  let elapsed = 0;
  let loadingWorld = false;

  // ---- opstarten ----
  function boot() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.getElementById('app').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(G.settings.fov, window.innerWidth / window.innerHeight, 0.08, 1400);
    scene.add(camera);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

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

    renderer.setAnimationLoop(loop);
  }

  // ---- wereld starten ----
  function initWorld(seed, saveData) {
    loadingWorld = true;
    UI.hideAll();
    UI.setLoading(true, 0, 'Wereld wordt opgebouwd…');

    World.init(seed);
    G.clearEdits();
    G.timeSec = saveData ? (saveData.timeSec || 0) : G.settings.dayMinutes * 60 * 0.12; // begin in de ochtend
    Weather.deserialize(saveData ? saveData.weather : null);

    if (saveData && saveData.edits) {
      for (const [x, y, z, id] of saveData.edits) G.recordEdit(x, y, z, id);
    }

    Chunks.reset ? Chunks.reset() : null;
    Chunks.init(scene);
    Entities.reset();

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
      if (pending > 0 && done < 300) {
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
      renderer.render(scene, camera);
      return;
    }
    if (G.state !== 'playing') {
      renderer.render(scene, camera);
      return;
    }

    elapsed += dt;
    Chunks.timeUniform.value = elapsed;

    // wereld-streaming (tijdbudget per frame)
    Chunks.update(Player.pos.x, Player.pos.z, 5);

    Player.update(dt, elapsed);

    const sunInfo = Sky.update(dt, Player.pos);
    const rainLevel = Weather.update(dt, Player.pos, sunInfo.nightAmt);
    Entities.update(dt, elapsed, Player.pos, sunInfo, camera);

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

    UI.updateClock();

    // autosave elke 60 s
    autosaveTimer += dt;
    if (autosaveTimer > 60) {
      autosaveTimer = 0;
      UI.saveGame('auto');
    }

    renderer.render(scene, camera);
  }

  // ---- init op laden van de pagina ----
  window.addEventListener('DOMContentLoaded', () => {
    boot();
    // modules die de scene nodig hebben
    Sky.init(scene, camera, renderer);
    Weather.init(scene, 1);
    Entities.init(scene, 1);
    Player.init(camera, renderer.domElement, scene);
    World.init(1337);
    Chunks.init(scene);
  });

  return M;
})();
