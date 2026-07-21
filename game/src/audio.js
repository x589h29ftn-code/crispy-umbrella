// Volledig gesynthetiseerde audio (WebAudio): rustige ambient-muziek, wind,
// regen, onweer, vogels, krekels en blokgeluiden. Geen externe bestanden.
window.Sfx = (function () {
  const A = {};
  let ctx = null;
  let master, musicBus, sfxBus, ambBus;
  let rainGain, rainFilter, windGain, campGain, waterGain, waterFilter;
  let started = false;
  let crackleTimer = 0, campLevel = 0;
  // stemming voor adaptieve muziek (tijd van de dag / seizoen / weer)
  const mood = { night: 0, season: 1, rain: 0 };

  function ensureCtx() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return false; }

    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = G.settings.musicVol; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = G.settings.sfxVol; sfxBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = G.settings.sfxVol; ambBus.connect(master);

    // ---- doorlopende ruislagen (wind + regen) ----
    const noiseBuf = makeNoiseBuffer(4);
    // wind
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf; windSrc.loop = true;
    const windF = ctx.createBiquadFilter();
    windF.type = 'lowpass'; windF.frequency.value = 320; windF.Q.value = 0.4;
    windGain = ctx.createGain(); windGain.gain.value = 0.035;
    windSrc.connect(windF); windF.connect(windGain); windGain.connect(ambBus);
    windSrc.start();
    // regen
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuf; rainSrc.loop = true;
    rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass'; rainFilter.frequency.value = 2400; rainFilter.Q.value = 0.35;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(rainFilter); rainFilter.connect(rainGain); rainGain.connect(ambBus);
    rainSrc.start();

    // kampvuur-geroffel (zacht laag geruis, gemoduleerd door nabijheid)
    const fireSrc = ctx.createBufferSource();
    fireSrc.buffer = noiseBuf; fireSrc.loop = true;
    const fireF = ctx.createBiquadFilter();
    fireF.type = 'lowpass'; fireF.frequency.value = 900; fireF.Q.value = 0.5;
    campGain = ctx.createGain(); campGain.gain.value = 0;
    fireSrc.connect(fireF); fireF.connect(campGain); campGain.connect(ambBus);
    fireSrc.start();

    // stromend water (bij meren, rivieren en watervallen) — zacht kabbelend geruis
    const waterSrc = ctx.createBufferSource();
    waterSrc.buffer = noiseBuf; waterSrc.loop = true;
    waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'bandpass'; waterFilter.frequency.value = 1400; waterFilter.Q.value = 0.5;
    waterGain = ctx.createGain(); waterGain.gain.value = 0;
    waterSrc.connect(waterFilter); waterFilter.connect(waterGain); waterGain.connect(ambBus);
    waterSrc.start();

    return true;
  }

  function makeNoiseBuffer(seconds) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // mix van wit en 'bruinig' voor een zachtere ruis
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = w * 0.5 + last * 3.0;
    }
    return buf;
  }

  A.start = function () {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!started) {
      started = true;
      scheduleMusic();
    }
  };
  A.suspend = function () { if (ctx && ctx.state === 'running') ctx.suspend(); };
  A.resume = function () { if (ctx && ctx.state === 'suspended') ctx.resume(); };

  A.applyVolumes = function () {
    if (!ctx) return;
    musicBus.gain.setTargetAtTime(G.settings.musicVol, ctx.currentTime, 0.1);
    sfxBus.gain.setTargetAtTime(G.settings.sfxVol, ctx.currentTime, 0.1);
    ambBus.gain.setTargetAtTime(G.settings.sfxVol, ctx.currentTime, 0.1);
  };

  // ---- rustige ambient-muziek: langzame pads + spaarzame pentatonische klokjes ----
  const CHORDS = [
    [130.81, 164.81, 196.00, 246.94],   // Cmaj7
    [110.00, 130.81, 164.81, 196.00],   // Am7
    [87.31, 130.81, 174.61, 220.00],    // Fmaj7
    [98.00, 146.83, 196.00, 220.00],    // Gsus
    [110.00, 164.81, 196.00, 261.63],   // Am add
    [130.81, 155.56, 196.00, 233.08],   // rustig kleurakkoord
  ];
  // Mellere avond-/nachtakkoorden (lager, ingetogener) voor adaptieve stemming
  const CHORDS_NIGHT = [
    [98.00, 130.81, 155.56, 196.00],    // Cm-kleur, laag
    [87.31, 110.00, 146.83, 174.61],    // warm mineur
    [82.41, 123.47, 164.81, 196.00],    // Em7 laag
    [92.50, 138.59, 185.00, 220.00],    // avondrust
  ];
  const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
  let chordIdx = 0;

  function pad(freq, t0, dur) {
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 1.005;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    // 's nachts donkerder (lagere cutoff), overdag helderder
    f.frequency.value = 1100 - mood.night * 560; f.Q.value = 0.3;
    const peak = 0.03 - mood.night * 0.006;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + dur * 0.35);
    g.gain.setValueAtTime(peak, t0 + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(musicBus);
    o1.start(t0); o2.start(t0);
    o1.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
  }

  function bell(freq, t0) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + 3.2);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o2.connect(g2); g2.connect(g);
    o.connect(g); g.connect(musicBus);
    o.start(t0); o2.start(t0);
    o.stop(t0 + 3.4); o2.stop(t0 + 3.4);
  }

  function scheduleMusic() {
    if (!ctx) return;
    const now = ctx.currentTime;
    // adaptief tempo: 's nachts en in de winter langer/rustiger
    const winter = mood.season === 3 ? 4 : 0;
    const dur = 11 + Math.random() * 5 + mood.night * 6 + winter;
    // akkoordbank kiezen op basis van tijd van de dag
    const bank = mood.night > 0.5 ? CHORDS_NIGHT : CHORDS;
    chordIdx = (chordIdx + 1 + ((Math.random() * 2) | 0)) % bank.length;
    const chord = bank[chordIdx];
    for (const f of chord) pad(f, now + 0.05, dur + 2);
    // klokjes: overdag vaker en helderder, 's nachts spaarzaam en een octaaf lager
    const bellChance = 0.75 - mood.night * 0.4;
    if (Math.random() < bellChance) {
      const nNotes = 1 + ((Math.random() * 3) | 0);
      const oct = mood.night > 0.5 ? 0.5 : 1;
      for (let i = 0; i < nNotes; i++) {
        bell(PENTA[(Math.random() * PENTA.length) | 0] * oct, now + 1 + Math.random() * dur * 0.7);
      }
    }
    setTimeout(scheduleMusic, dur * 1000);
  }

  // Stemming bijwerken vanuit de hoofdloop (nacht 0..1, seizoen 0..3, regen 0..1)
  A.setMood = function (nightAmt, seasonIdx, rainLevel) {
    mood.night = nightAmt;
    mood.season = seasonIdx;
    mood.rain = rainLevel;
  };
  // Zacht kabbelend water in de buurt (meren/rivieren/watervallen)
  A.setWaterLevel = function (v) {
    if (!ctx) return;
    waterGain.gain.setTargetAtTime(Noise.clamp(v, 0, 1) * 0.05, ctx.currentTime, 0.6);
  };

  // ---- omgevingsparameters ----
  A.setRainLevel = function (v) {
    if (!ctx) return;
    rainGain.gain.setTargetAtTime(v * 0.16, ctx.currentTime, 0.8);
  };
  A.setWindLevel = function (v) {
    if (!ctx) return;
    windGain.gain.setTargetAtTime(0.02 + v * 0.06, ctx.currentTime, 1.2);
  };
  A.setCampfireLevel = function (v) {
    if (!ctx) return;
    campLevel = v;
    campGain.gain.setTargetAtTime(v * 0.09, ctx.currentTime, 0.3);
  };
  // korte knapjes wanneer je bij een kampvuur staat
  A.updateCampfire = function (dt) {
    if (!ctx || campLevel < 0.15) return;
    crackleTimer -= dt;
    if (crackleTimer <= 0) {
      crackleTimer = 0.15 + Math.random() * 0.5;
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = 400 + Math.random() * 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.03 * campLevel, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.06);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.frequency.value;
      o.connect(f); f.connect(g); g.connect(sfxBus);
      o.start(t0); o.stop(t0 + 0.08);
    }
  };

  A.thunder = function (delaySec) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delaySec;
    const dur = 2.4 + Math.random() * 1.6;
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(dur + 0.5);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t0);
    f.frequency.exponentialRampToValueAtTime(60, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(ambBus);
    src.start(t0); src.stop(t0 + dur + 0.2);
  };

  // ---- natuurgeluidjes ----
  A.chirp = function () {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator(); o.type = 'sine';
      const base = 2400 + Math.random() * 1400;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.022, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      o.connect(g); g.connect(ambBus);
      o.start(t); o.stop(t + 0.12);
    }
  };

  A.cricket = function () {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * 0.07;
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = 4200 + Math.random() * 400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.006, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.04);
      o.connect(g); g.connect(ambBus);
      o.start(t); o.stop(t + 0.05);
    }
  };

  // ---- speler-geluiden ----
  function thud(freq, vol, decay, type) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
    o.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + decay + 0.05);
    // klein beetje ruis erbij
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(0.1);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq * 4;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.6, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + decay * 0.6);
    src.connect(f); f.connect(g2); g2.connect(sfxBus);
    src.start(t0); src.stop(t0 + 0.12);
  }

  A.place = function (block) {
    const B = G.B;
    if (block === B.PLANKS || block === B.LOG || block === B.FENCE) thud(240, 0.14, 0.14);
    else if (block === B.SAND || block === B.GRAVEL) thud(160, 0.11, 0.18);
    else if (block === B.TORCH) thud(420, 0.08, 0.1);
    else thud(190, 0.13, 0.15);
  };
  A.dig = function (block) {
    const B = G.B;
    if (block === B.STONE || block === B.COBBLE) thud(140, 0.15, 0.2);
    else if (block === B.LEAVES || block === B.LEAVES_BIRCH || block === B.LEAVES_PINE || G.isCross(block)) thud(600, 0.05, 0.08, 'sine');
    else thud(170, 0.12, 0.16);
  };
  A.step = function (block) {
    const B = G.B;
    const v = 0.035 + Math.random() * 0.015;
    if (block === B.SAND) thud(150 + Math.random() * 30, v, 0.09);
    else if (block === B.STONE || block === B.COBBLE || block === B.PATH) thud(220 + Math.random() * 40, v, 0.07);
    else thud(180 + Math.random() * 40, v, 0.08);
  };
  A.splash = function () { thud(300, 0.1, 0.25, 'sine'); };

  // ---- gevecht & beren ----
  A.growl = function (vol) {
    if (!ctx) return;
    const t0 = ctx.currentTime, v = (vol || 1) * 0.5;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t0);
    o.frequency.linearRampToValueAtTime(60, t0 + 0.45);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v * 0.5, t0 + 0.05);
    g.gain.setValueAtTime(v * 0.5, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    o.connect(f); f.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + 0.65);
  };
  A.hurt = function () {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(420, t0);
    o.frequency.exponentialRampToValueAtTime(120, t0 + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
    o.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + 0.3);
  };
  A.swing = function () {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = makeNoiseBuffer(0.2);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(900, t0);
    f.frequency.exponentialRampToValueAtTime(2600, t0 + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + 0.2);
  };
  A.hit = function () {
    if (!ctx) return;
    thud(140, 0.16, 0.14);
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = makeNoiseBuffer(0.1);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + 0.12);
  };

  // zachte uilenroep in de nacht
  A.owl = function () {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const off of [0, 0.55]) {
      const t = t0 + off;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(300, t);
      o.frequency.linearRampToValueAtTime(360, t + 0.08);
      o.frequency.linearRampToValueAtTime(320, t + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
      o.connect(f); f.connect(g); g.connect(ambBus);
      o.start(t); o.stop(t + 0.45);
    }
  };

  // periodieke natuurklanken, aangestuurd vanuit de hoofdloop
  let natureTimer = 2;
  A.updateNature = function (dt, nightAmt, rainLevel) {
    if (!ctx) return;
    natureTimer -= dt;
    if (natureTimer <= 0) {
      natureTimer = 2.5 + Math.random() * 6;
      if (rainLevel > 0.3) return;
      if (nightAmt < 0.3) {
        // dagkoor: meer vogels rond zonsopgang/ochtend
        if (Math.random() < 0.75) A.chirp();
        if (Math.random() < 0.25) A.chirp();
      } else if (nightAmt > 0.6) {
        if (Math.random() < 0.8) A.cricket();
        if (Math.random() < 0.12) A.owl();
      } else {
        // schemer: mix
        if (Math.random() < 0.5) A.chirp(); else A.cricket();
      }
    }
  };

  return A;
})();
