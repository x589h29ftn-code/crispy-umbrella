// Globale namespace en constanten voor Blokkenwereld.
window.G = (function () {
  const G = {};

  // Wereldafmetingen
  G.CS = 16;          // chunkbreedte (x/z)
  G.CH = 160;         // wereldhoogte (ruimte voor hoge bergketens)
  G.SEA = 30;         // zeeniveau

  // Blok-id's
  G.B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5,
    LOG: 6, LEAVES: 7, PLANKS: 8, COBBLE: 9, SNOW: 10, PATH: 11,
    FARMLAND: 12, FENCE: 13, TORCH: 14,
    TALLGRASS: 15, FLOWER_RED: 16, FLOWER_YELLOW: 17, FLOWER_BLUE: 18, CROP: 19,
    LEAVES_BIRCH: 20, LOG_BIRCH: 21, LEAVES_PINE: 22, GRAVEL: 23, FLOWER_WHITE: 24,
    STONE_BRICK: 25, STONE_BRICK_MOSSY: 26, GLASS: 27,
    STAIRS: 28, SLAB: 29, DOOR: 30, CAMPFIRE: 31,
    FERN: 32, MUSHROOM: 33, LILYPAD: 34, PEBBLES: 35, LEAVES_WILLOW: 36,
  };
  const B = G.B;

  // Kruisvormige plantjes (geen collision, in het foliage-mesh met wind)
  G.CROSS_BLOCKS = new Set([B.TALLGRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.FLOWER_BLUE, B.FLOWER_WHITE, B.CROP,
    B.FERN, B.MUSHROOM]);
  // Bladeren (krijgen doorschijnende backlight-shading)
  G.LEAF_BLOCKS = new Set([B.LEAVES, B.LEAVES_BIRCH, B.LEAVES_PINE, B.LEAVES_WILLOW]);
  // Blokken waar je doorheen kunt lopen
  G.NON_SOLID = new Set([B.AIR, B.WATER, B.TORCH, B.TALLGRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.FLOWER_BLUE, B.FLOWER_WHITE, B.CROP, B.CAMPFIRE,
    B.FERN, B.MUSHROOM, B.LILYPAD, B.PEBBLES]);
  // Blokken die het vlak van hun buurman NIET volledig bedekken
  G.NON_OCCLUDING = new Set([B.AIR, B.WATER, B.LEAVES, B.LEAVES_BIRCH, B.LEAVES_PINE, B.LEAVES_WILLOW, B.TORCH, B.FENCE,
    B.TALLGRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.FLOWER_BLUE, B.FLOWER_WHITE, B.CROP, B.GLASS,
    B.STAIRS, B.SLAB, B.DOOR, B.CAMPFIRE, B.FERN, B.MUSHROOM, B.LILYPAD, B.PEBBLES]);
  // Blokken met een eigen vorm (deels gevuld) — collision via Chunks.solidShapeAt
  G.SHAPED = new Set([B.STAIRS, B.SLAB, B.DOOR]);

  G.isSolid = (id) => id !== undefined && !G.NON_SOLID.has(id);
  G.isCross = (id) => G.CROSS_BLOCKS.has(id);
  G.occludes = (id) => id !== undefined && !G.NON_OCCLUDING.has(id);

  // Namen voor de hotbar
  G.BLOCK_NAMES = {
    [B.GRASS]: 'Gras', [B.DIRT]: 'Aarde', [B.STONE]: 'Steen', [B.SAND]: 'Zand',
    [B.PLANKS]: 'Planken', [B.LOG]: 'Boomstam', [B.COBBLE]: 'Keien', [B.FENCE]: 'Hekje', [B.TORCH]: 'Fakkel',
    [B.STONE_BRICK]: 'Bakstenen', [B.STONE_BRICK_MOSSY]: 'Bemoste bakstenen', [B.GLASS]: 'Glas',
    [B.STAIRS]: 'Trap', [B.SLAB]: 'Plaat / bankje', [B.DOOR]: 'Deur', [B.CAMPFIRE]: 'Kampvuur',
  };
  // Bouw-set voorop op 1–9; overige blokken via scrollwiel
  G.HOTBAR = [B.STONE_BRICK, B.STONE_BRICK_MOSSY, B.STAIRS, B.SLAB, B.PLANKS, B.DOOR, B.GLASS, B.FENCE, B.TORCH,
    B.CAMPFIRE, B.COBBLE, B.LOG, B.GRASS, B.DIRT, B.SAND];

  // Instellingen (met persistentie)
  const DEFAULTS = {
    dayMinutes: 15, renderDist: 10, fogMul: 1.0, fov: 75,
    musicVol: 0.55, sfxVol: 0.8, shadows: true, clouds: true, seasonDays: 2,
    renderScale: 1.0, postFX: true, bloom: true, vignette: true, godrays: true, showFps: false,
  };

  // Grafische kwaliteitspresets
  G.QUALITY_PRESETS = {
    low: { renderScale: 0.75, postFX: false, bloom: false, vignette: false, godrays: false, shadows: false, clouds: false, renderDist: 6 },
    med: { renderScale: 1.0, postFX: true, bloom: true, vignette: true, godrays: false, shadows: true, clouds: true, renderDist: 8 },
    high: { renderScale: 1.5, postFX: true, bloom: true, vignette: true, godrays: true, shadows: true, clouds: true, renderDist: 12 },
  };
  G.settings = Object.assign({}, DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem('bw_settings') || '{}');
    Object.assign(G.settings, s);
  } catch (e) { /* verse start */ }
  G.saveSettings = function () {
    try { localStorage.setItem('bw_settings', JSON.stringify(G.settings)); } catch (e) {}
  };

  // Spelstatus
  G.state = 'menu';        // 'menu' | 'playing' | 'paused'
  G.seed = 1337;
  G.timeSec = 0;           // verstreken cyclustijd in seconden
  G.dayNumber = 1;

  // Speler-bewerkingen aan de wereld (voor opslaan/laden en her-genereren van chunks)
  G.worldEdits = new Map();   // "x,y,z" -> blok-id
  G.editIndex = new Map();    // "cx,cz" -> [[wx,wy,wz,id], ...]
  G.recordEdit = function (wx, wy, wz, id) {
    G.worldEdits.set(wx + ',' + wy + ',' + wz, id);
    const key = Math.floor(wx / G.CS) + ',' + Math.floor(wz / G.CS);
    let list = G.editIndex.get(key);
    if (!list) { list = []; G.editIndex.set(key, list); }
    // bestaande entry voor dezelfde positie vervangen
    const i = list.findIndex((e) => e[0] === wx && e[1] === wy && e[2] === wz);
    if (i >= 0) list[i][3] = id; else list.push([wx, wy, wz, id]);
  };
  G.clearEdits = function () {
    G.worldEdits.clear();
    G.editIndex.clear();
    G.meta.clear();
  };

  // Blok-metadata (oriëntatie/staat) voor gevormde blokken zoals trappen en deuren.
  // Klein geheel getal per positie; los van de blok-id's.
  //   trap:  bits0-1 = richting (0..3)
  //   deur:  bit0 = open, bits1-2 = richting, bit3 = bovenste helft
  G.meta = new Map();      // "x,y,z" -> int
  G.getMeta = function (x, y, z) { return G.meta.get(x + ',' + y + ',' + z) || 0; };
  G.setMeta = function (x, y, z, v) {
    const k = x + ',' + y + ',' + z;
    if (v) G.meta.set(k, v); else G.meta.delete(k);
  };

  // ---- seizoenen ----
  G.SEASON_NAMES = ['Lente', 'Zomer', 'Herfst', 'Winter'];
  // grasp/blad-kleurvermenigvuldigers per seizoen (RGB)
  G.SEASON_GRASS = [
    [1.05, 1.10, 0.90], [1.00, 1.00, 1.00], [1.30, 0.92, 0.40], [0.92, 0.96, 1.00],
  ];
  G.SEASON_LEAF = [
    [1.02, 1.08, 0.92], [1.00, 1.00, 1.00], [1.72, 0.78, 0.30], [0.86, 0.88, 0.90],
  ];
  // winter legt een rijp/sneeuw-waas over gras en blad (mengen naar lichtwit)
  G.SEASON_FROST = [0, 0, 0, 0.55];
  G.season = { idx: 1, name: 'Zomer', t: 0, grass: [1, 1, 1], leaf: [1, 1, 1], frost: 0 };
  G.seasonInfo = function () {
    const dpS = Math.max(0.25, G.settings.seasonDays);
    const totalDays = G.timeSec / G.cycleLen();
    const f = totalDays / dpS;
    const idx = ((Math.floor(f) % 4) + 4) % 4;
    return { idx, name: G.SEASON_NAMES[idx], t: f - Math.floor(f), grass: G.SEASON_GRASS[idx], leaf: G.SEASON_LEAF[idx], frost: G.SEASON_FROST[idx] };
  };

  // Verhouding nacht t.o.v. dag
  G.NIGHT_RATIO = 0.45;

  // Tijd-van-dag helpers.  fase 0..1: 0=zonsopkomst, 0.5=zonsondergang begint nacht
  G.cycleLen = function () {
    const day = G.settings.dayMinutes * 60;
    return day + day * G.NIGHT_RATIO;
  };
  // Geeft {sunUp, phase} — phase 0..1 binnen dag óf nacht
  G.timeOfDay = function () {
    const cyc = G.cycleLen();
    const day = G.settings.dayMinutes * 60;
    const t = ((G.timeSec % cyc) + cyc) % cyc;
    if (t < day) return { sunUp: true, phase: t / day, t };
    return { sunUp: false, phase: (t - day) / (cyc - day), t };
  };
  // Zonhoogte -1..1 (negatief = nacht)
  G.sunElevation = function () {
    const tod = G.timeOfDay();
    if (tod.sunUp) return Math.sin(tod.phase * Math.PI);
    return -Math.sin(tod.phase * Math.PI);
  };

  return G;
})();
