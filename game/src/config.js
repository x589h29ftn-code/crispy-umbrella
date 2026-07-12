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
  };
  const B = G.B;

  // Kruisvormige plantjes (geen collision, in het foliage-mesh met wind)
  G.CROSS_BLOCKS = new Set([B.TALLGRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.FLOWER_BLUE, B.FLOWER_WHITE, B.CROP]);
  // Blokken waar je doorheen kunt lopen
  G.NON_SOLID = new Set([B.AIR, B.WATER, B.TORCH, B.TALLGRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.FLOWER_BLUE, B.FLOWER_WHITE, B.CROP]);
  // Blokken die het vlak van hun buurman NIET volledig bedekken
  G.NON_OCCLUDING = new Set([B.AIR, B.WATER, B.LEAVES, B.LEAVES_BIRCH, B.LEAVES_PINE, B.TORCH, B.FENCE,
    B.TALLGRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.FLOWER_BLUE, B.FLOWER_WHITE, B.CROP, B.GLASS]);

  G.isSolid = (id) => id !== undefined && !G.NON_SOLID.has(id);
  G.isCross = (id) => G.CROSS_BLOCKS.has(id);
  G.occludes = (id) => id !== undefined && !G.NON_OCCLUDING.has(id);

  // Namen voor de hotbar
  G.BLOCK_NAMES = {
    [B.GRASS]: 'Gras', [B.DIRT]: 'Aarde', [B.STONE]: 'Steen', [B.SAND]: 'Zand',
    [B.PLANKS]: 'Planken', [B.LOG]: 'Boomstam', [B.COBBLE]: 'Keien', [B.FENCE]: 'Hekje', [B.TORCH]: 'Fakkel',
    [B.STONE_BRICK]: 'Bakstenen', [B.STONE_BRICK_MOSSY]: 'Bemoste bakstenen', [B.GLASS]: 'Glas',
  };
  // Kasteel-set voorop op 1–9; gras/aarde/zand via scrollwiel
  G.HOTBAR = [B.STONE_BRICK, B.STONE_BRICK_MOSSY, B.COBBLE, B.STONE, B.PLANKS, B.LOG, B.GLASS, B.FENCE, B.TORCH,
    B.GRASS, B.DIRT, B.SAND];

  // Instellingen (met persistentie)
  const DEFAULTS = {
    dayMinutes: 15, renderDist: 10, fogMul: 1.0, fov: 75,
    musicVol: 0.55, sfxVol: 0.8, shadows: true, clouds: true,
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
