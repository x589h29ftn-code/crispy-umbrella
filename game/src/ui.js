// Alle menu's, HUD, hotbar en het opslaan/laden van werelden (localStorage).
window.UI = (function () {
  const U = {};
  const $ = (id) => document.getElementById(id);

  const SLOTS = ['1', '2', '3'];
  const SAVE_PREFIX = 'bw_save_';
  let hintTimer = null, toastTimer = null;
  let settingsReturnTo = 'mainmenu';

  // ---- overlays ----
  const OVERLAYS = ['mainmenu', 'pausemenu', 'savemenu', 'loadmenu', 'settingsmenu', 'helpmenu'];
  function hideAll() { OVERLAYS.forEach((o) => $(o).classList.remove('visible')); }
  function show(id) { hideAll(); $(id).classList.add('visible'); }
  U.show = show; U.hideAll = hideAll;

  // ---- hotbar ----
  U.buildHotbar = function () {
    const bar = $('hotbar');
    bar.innerHTML = '';
    G.HOTBAR.forEach((block, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const key = document.createElement('span');
      key.className = 'key'; key.textContent = (i + 1);
      const cv = document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      Textures.drawIcon(cv, block);
      slot.appendChild(key); slot.appendChild(cv);
      slot.title = G.BLOCK_NAMES[block] || '';
      bar.appendChild(slot);
    });
    U.refreshHotbar();
  };
  U.refreshHotbar = function () {
    const slots = $('hotbar').children;
    for (let i = 0; i < slots.length; i++) slots[i].classList.toggle('sel', i === Player.hotbarSel);
    U.hint(G.BLOCK_NAMES[G.HOTBAR[Player.hotbarSel]] || '');
  };

  U.hint = function (txt) {
    const h = $('hint');
    h.textContent = txt;
    h.style.opacity = 1;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { h.style.opacity = 0; }, 1600);
  };
  U.toast = function (txt) {
    const t = $('toast');
    t.textContent = txt;
    t.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = 0; }, 2600);
  };

  // ---- pratende tekstballonnen boven bewoners ----
  const bubbles = [];
  const _v3 = { x: 0, y: 0, z: 0 };
  U.speak = function (info) {
    if (!info || U._hudHidden) return;
    const el = document.createElement('div');
    el.className = 'bubble';
    el.innerHTML = '<b></b><span></span>';
    el.querySelector('b').textContent = info.name;
    el.querySelector('span').textContent = info.line;
    document.body.appendChild(el);
    bubbles.push({ el, x: info.x, y: info.y, z: info.z, until: performance.now() + 4200 });
    if (bubbles.length > 4) { const old = bubbles.shift(); old.el.remove(); }
  };
  U.updateBubbles = function (camera) {
    if (!bubbles.length) return;
    const now = performance.now();
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (now > b.until) { b.el.remove(); bubbles.splice(i, 1); continue; }
      _v3.x = b.x; _v3.y = b.y; _v3.z = b.z;
      const p = new THREE.Vector3(b.x, b.y, b.z).project(camera);
      if (p.z > 1 || p.z < -1) { b.el.style.display = 'none'; continue; }
      const sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
      b.el.style.display = 'block';
      b.el.style.left = sx + 'px';
      b.el.style.top = sy + 'px';
      b.el.style.opacity = Math.min(1, (b.until - now) / 600);
    }
  };

  // ---- klok & weer in de HUD ----
  U.updateClock = function () {
    const tod = G.timeOfDay();
    let hour, minute;
    if (tod.sunUp) {
      const dayH = 6 + tod.phase * 14;         // 06:00 → 20:00
      hour = Math.floor(dayH); minute = Math.floor((dayH - hour) * 60);
    } else {
      const nightH = 20 + tod.phase * 10;      // 20:00 → 06:00
      hour = Math.floor(nightH) % 24; minute = Math.floor((nightH - Math.floor(nightH)) * 60);
    }
    const seasonEmoji = ['🌱', '☀️', '🍂', '❄️'][G.season.idx] || '';
    $('clocktxt').textContent = `Dag ${G.dayNumber} — ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} · ${seasonEmoji}${G.season.name}`;
    $('clockicon').textContent = tod.sunUp ? (G.sunElevation() < 0.15 ? '🌅' : '☀️') : '🌙';
    const w = Weather.current;
    $('weathericon').textContent = w === 'rain' ? '🌧' : w === 'storm' ? '⛈' : w === 'mist' ? '🌫' : '';
  };

  // ---- opslaan / laden ----
  function slotMeta(slot) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return { savedAt: d.savedAt, dayNumber: d.dayNumber || 1, seed: d.seed, edits: (d.edits || []).length };
    } catch (e) { return null; }
  }

  function buildSaveData() {
    const edits = [];
    G.worldEdits.forEach((id, k) => {
      const p = k.split(',');
      edits.push([+p[0], +p[1], +p[2], id]);
    });
    const metas = [];
    G.meta.forEach((v, k) => {
      const p = k.split(',');
      metas.push([+p[0], +p[1], +p[2], v]);
    });
    return {
      format: 'blokkenwereld-1',
      savedAt: Date.now(),
      seed: G.seed,
      timeSec: G.timeSec,
      dayNumber: G.dayNumber,
      player: Player.serialize(),
      weather: Weather.serialize(),
      water: window.WaterSim ? WaterSim.serialize() : [],
      edits, metas,
    };
  }
  U.buildSaveData = buildSaveData;

  U.saveGame = function (slot) {
    try {
      localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(buildSaveData()));
      return true;
    } catch (e) {
      U.toast('Opslaan mislukt (opslag vol?)');
      return false;
    }
  };

  // ---- wereld naar/uit een bestand ----
  U.exportToFile = async function () {
    const data = buildSaveData();
    const json = JSON.stringify(data);
    const name = 'Blokkenwereld-dag' + data.dayNumber + '.bw';
    if (window.desktop && window.desktop.isDesktop) {
      const res = await window.desktop.saveWorld(name, json);
      if (res && res.ok) { U.toast('Wereld opgeslagen als bestand 💾'); Main.resume(); }
    } else {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      U.toast('Wereld gedownload 💾');
    }
  };
  U.importFromFile = async function () {
    if (window.desktop && window.desktop.isDesktop) {
      const res = await window.desktop.openWorld();
      if (res && res.ok) {
        try { Main.loadFromData(JSON.parse(res.content)); }
        catch (e) { U.toast('Kon het bestand niet lezen.'); }
      }
    } else {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.bw,.json,application/json';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { try { Main.loadFromData(JSON.parse(r.result)); } catch (e) { U.toast('Kon het bestand niet lezen.'); } };
        r.readAsText(f);
      };
      inp.click();
    }
  };

  // screenshot / fotomodus
  U.takeScreenshot = async function (dataUrl) {
    const name = 'Blokkenwereld-' + Date.now() + '.png';
    if (window.desktop && window.desktop.isDesktop) {
      const res = await window.desktop.saveScreenshot(name, dataUrl);
      if (res && res.ok) U.toast('Foto opgeslagen in Afbeeldingen 📷');
    } else {
      const a = document.createElement('a');
      a.href = dataUrl; a.download = name; a.click();
      U.toast('Foto gedownload 📷');
    }
  };

  U.loadGameData = function (slot) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('nl-NL') + ' ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }

  function renderSlots(containerId, mode) {
    const el = $(containerId);
    el.innerHTML = '';
    const all = mode === 'load' ? ['auto', ...SLOTS] : SLOTS;
    for (const slot of all) {
      const meta = slotMeta(slot);
      const row = document.createElement('div');
      row.className = 'slotrow';
      const info = document.createElement('div');
      info.className = 'info';
      const label = slot === 'auto' ? 'Autosave' : 'Slot ' + slot;
      if (meta) {
        info.innerHTML = `<div>${label} — dag ${meta.dayNumber}</div><div class="meta">${fmtDate(meta.savedAt)} · seed ${meta.seed} · ${meta.edits} wijzigingen</div>`;
      } else {
        info.innerHTML = `<div>${label}</div><div class="meta">— leeg —</div>`;
      }
      row.appendChild(info);
      const btn = document.createElement('button');
      btn.className = 'btn small';
      if (mode === 'save') {
        btn.textContent = meta ? 'Overschrijven' : 'Opslaan';
        btn.onclick = () => {
          if (U.saveGame(slot)) { U.toast('Opgeslagen in ' + label.toLowerCase() + ' 💾'); Main.resume(); }
        };
      } else {
        btn.textContent = 'Laden';
        btn.disabled = !meta;
        if (!meta) btn.style.opacity = 0.4;
        btn.onclick = () => { if (meta) Main.loadGame(slot); };
      }
      row.appendChild(btn);
      if (meta && slot !== 'auto') {
        const del = document.createElement('button');
        del.className = 'btn small danger';
        del.textContent = '✕';
        del.title = 'Verwijderen';
        del.onclick = () => { localStorage.removeItem(SAVE_PREFIX + slot); renderSlots(containerId, mode); };
        row.appendChild(del);
      }
      el.appendChild(row);
    }
  }

  // ---- instellingen ----
  function bindSettings() {
    const s = G.settings;
    const bind = (id, key, fmt, onChange) => {
      const el = $(id), val = $('val-' + id.slice(4));
      el.value = s[key];
      val.textContent = fmt(s[key]);
      el.oninput = () => {
        s[key] = parseFloat(el.value);
        val.textContent = fmt(s[key]);
        G.saveSettings();
        if (onChange) onChange();
      };
    };
    bind('set-daymin', 'dayMinutes', (v) => v + ' min');
    bind('set-seasondays', 'seasonDays', (v) => v + ' d');
    bind('set-dist', 'renderDist', (v) => v + ' chunks', () => Main.onRenderDistChanged());
    bind('set-fog', 'fogMul', (v) => '×' + v.toFixed(2));
    bind('set-fov', 'fov', (v) => v + '°', () => Main.onFovChanged());
    bind('set-music', 'musicVol', (v) => Math.round(v * 100) + '%', () => Sfx.applyVolumes());
    bind('set-sfx', 'sfxVol', (v) => Math.round(v * 100) + '%', () => Sfx.applyVolumes());
    bind('set-scale', 'renderScale', (v) => Math.round(v * 100) + '%', () => Main.applyGraphics());
    $('set-shadows').checked = s.shadows;
    $('set-shadows').onchange = () => { s.shadows = $('set-shadows').checked; G.saveSettings(); };
    $('set-clouds').checked = s.clouds;
    $('set-clouds').onchange = () => { s.clouds = $('set-clouds').checked; G.saveSettings(); Sky.rebuildClouds(); };
    const bindCheck = (id, key, after) => {
      $(id).checked = s[key];
      $(id).onchange = () => { s[key] = $(id).checked; G.saveSettings(); if (after) after(); };
    };
    bindCheck('set-reflections', 'reflections', () => Main.applyGraphics());
    bindCheck('set-postfx', 'postFX', () => Main.applyGraphics());
    bindCheck('set-bloom', 'bloom', () => Main.applyGraphics());
    bindCheck('set-godrays', 'godrays', () => Main.applyGraphics());
    bindCheck('set-ssao', 'ssao', () => Main.applyGraphics());
    bindCheck('set-dof', 'dof', () => Main.applyGraphics());
    bindCheck('set-vignette', 'vignette', () => Main.applyGraphics());
    bindCheck('set-fps', 'showFps', () => U.applyFps());
  }

  U.applyFps = function () {
    $('fps').style.display = G.settings.showFps ? 'block' : 'none';
  };
  U.updateFps = function (v) {
    if (G.settings.showFps) $('fps').textContent = v + ' fps';
  };

  function applyPreset(name) {
    Object.assign(G.settings, G.QUALITY_PRESETS[name]);
    G.saveSettings();
    bindSettings();                 // invoervelden verversen
    Main.applyGraphics();
    Main.onRenderDistChanged();
    Sky.rebuildClouds();
    U.applyFps();
    U.toast('Kwaliteit ingesteld op ' + (name === 'low' ? 'Laag' : name === 'med' ? 'Middel' : 'Hoog'));
  }

  // ---- events ----
  U.init = function () {
    U.buildHotbar();
    bindSettings();
    U.applyFps();
    $('preset-low').onclick = () => applyPreset('low');
    $('preset-med').onclick = () => applyPreset('med');
    $('preset-high').onclick = () => applyPreset('high');

    $('btn-new').onclick = () => {
      const txt = $('seed-input').value.trim();
      let seed;
      if (txt === '') seed = (Math.random() * 0xffffffff) >>> 0;
      else if (/^\d+$/.test(txt)) seed = parseInt(txt, 10) >>> 0;
      else { seed = 0; for (let i = 0; i < txt.length; i++) seed = (seed * 31 + txt.charCodeAt(i)) >>> 0; }
      Main.newGame(seed);
    };
    $('btn-continue').onclick = () => Main.loadGame('auto');
    $('btn-load-menu').onclick = () => { renderSlots('load-slots', 'load'); show('loadmenu'); settingsReturnTo = 'mainmenu'; };
    $('btn-settings-main').onclick = () => { settingsReturnTo = 'mainmenu'; show('settingsmenu'); };

    $('btn-resume').onclick = () => Main.resume();
    $('btn-save-menu').onclick = () => { renderSlots('save-slots', 'save'); show('savemenu'); };
    $('btn-load-menu2').onclick = () => { renderSlots('load-slots', 'load'); show('loadmenu'); settingsReturnTo = 'pausemenu'; };
    $('btn-settings-pause').onclick = () => { settingsReturnTo = 'pausemenu'; show('settingsmenu'); };
    $('btn-quit').onclick = () => Main.toMainMenu();

    $('btn-export-file').onclick = () => U.exportToFile();
    $('btn-import-file').onclick = () => U.importFromFile();
    $('btn-save-back').onclick = () => show('pausemenu');
    $('btn-load-back').onclick = () => show(settingsReturnTo);
    $('btn-settings-back').onclick = () => show(settingsReturnTo);
    $('btn-help-back').onclick = () => { if (G.state === 'paused') Main.resume(); else show('mainmenu'); };

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && (G.state === 'playing' || G.state === 'paused')) {
        if ($('helpmenu').classList.contains('visible')) { Main.resume(); }
        else { Main.pause(true); show('helpmenu'); }
      }
    });

    // "Verdergaan" tonen als er een autosave is
    if (slotMeta('auto')) $('btn-continue').style.display = 'block';
  };

  U.showPause = function () { show('pausemenu'); };
  U.showMain = function () {
    show('mainmenu');
    if (slotMeta('auto')) $('btn-continue').style.display = 'block';
  };

  U.setLoading = function (visible, frac, txt) {
    $('loading').style.display = visible ? 'flex' : 'none';
    if (frac !== undefined) $('load-fill').style.width = Math.round(frac * 100) + '%';
    if (txt) $('load-txt').textContent = txt;
  };

  U._hudHidden = false;
  U.setHud = function (visible) {
    $('hud').style.display = (visible && !U._hudHidden) ? 'block' : 'none';
  };
  U.toggleHud = function () {
    U._hudHidden = !U._hudHidden;
    U.setHud(G.state === 'playing');
    U.hint(U._hudHidden ? 'Fotomodus — HUD verborgen (F1)' : '');
  };

  return U;
})();
