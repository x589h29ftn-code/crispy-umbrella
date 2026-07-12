// Stromend water: geplaatst water zakt omlaag en spreidt naar lager terrein met
// afnemende niveaus (1..8). Bronnen (door de speler geplaatst) blijven voeden.
// Bounded rond de speler; zelf-drainerend als de bron weg is.
window.WaterSim = (function () {
  const W = {};
  const B = G.B;
  const sources = new Set();      // "x,y,z" van bronblokken
  let active = new Set();         // cellen die deze tick herberekend worden
  let timer = 0;
  const STEP = 0.14;              // seconden per simulatiestap
  const MAX_PER_STEP = 700;
  const MAX_ACTIVE = 6000;

  const key = (x, y, z) => x + ',' + y + ',' + z;
  const parse = (k) => k.split(',').map(Number);

  W.reset = function () { sources.clear(); active.clear(); timer = 0; };

  function activate(x, y, z) {
    if (active.size < MAX_ACTIVE) active.add(key(x, y, z));
  }
  W.pokeArea = function (x, y, z) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (Chunks.getBlock(x + dx, y + dy, z + dz) === B.WATER) activate(x + dx, y + dy, z + dz);
    }
    // ook bronnen in de buurt weer wakker maken
    sources.forEach((k) => { const [sx, sy, sz] = parse(k); if (Math.abs(sx - x) + Math.abs(sy - y) + Math.abs(sz - z) < 6) active.add(k); });
  };

  // Waterniveau op een cel: 8 = vol/bron/wereldwater, 1..7 = stromend
  function levelAt(x, y, z) {
    if (Chunks.getBlock(x, y, z) !== B.WATER) return 0;
    if (Chunks.getBlock(x, y + 1, z) === B.WATER) return 8;   // gevoed van boven
    const k = key(x, y, z);
    if (sources.has(k)) return 8;
    const m = G.getMeta(x, y, z);
    return m === 0 ? 8 : m;                                    // meta 0 = wereldwater
  }

  W.placeSource = function (x, y, z) {
    sources.add(key(x, y, z));
    Chunks.setBlock(x, y, z, B.WATER, true, 8);
    W.pokeArea(x, y, z);
    activate(x, y, z);
  };
  // aangeroepen na elke blok-bewerking, zodat water opnieuw gaat stromen
  W.onEdit = function (x, y, z) {
    // als een bron is overschreven, verwijder hem uit de set
    if (Chunks.getBlock(x, y, z) !== B.WATER) sources.delete(key(x, y, z));
    W.pokeArea(x, y, z);
  };

  function setWater(x, y, z, level) {
    Chunks.setWaterCell(x, y, z, B.WATER, level >= 8 ? 8 : level);
  }
  function removeWater(x, y, z) {
    Chunks.setWaterCell(x, y, z, B.AIR, 0);
    sources.delete(key(x, y, z));
  }

  function step() {
    // bronnen blijven actief
    sources.forEach((k) => { if (active.size < MAX_ACTIVE) active.add(k); });
    if (active.size === 0) return;

    const cur = Array.from(active);
    active = new Set();
    let processed = 0;

    for (const k of cur) {
      if (processed++ > MAX_PER_STEP) { active.add(k); continue; }
      const [x, y, z] = parse(k);
      const id = Chunks.getBlock(x, y, z);
      if (id !== B.WATER) continue;
      const isSource = sources.has(k);

      if (!isSource) {
        // ondersteund niveau herberekenen
        let sup;
        if (Chunks.getBlock(x, y + 1, z) === B.WATER) sup = 8;
        else {
          let mx = 0;
          mx = Math.max(mx, levelAt(x + 1, y, z), levelAt(x - 1, y, z), levelAt(x, y, z + 1), levelAt(x, y, z - 1));
          sup = mx - 1;
        }
        const m = G.getMeta(x, y, z);
        const curLvl = m === 0 ? 8 : m;
        if (sup <= 0) {
          removeWater(x, y, z);
          activate(x + 1, y, z); activate(x - 1, y, z); activate(x, y, z + 1); activate(x, y, z - 1);
          activate(x, y + 1, z); activate(x, y - 1, z);
          continue;
        }
        if (sup !== curLvl) { setWater(x, y, z, sup); }
      }

      // uitstromen
      const belowId = Chunks.getBlock(x, y - 1, z);
      if (belowId === B.AIR) {
        setWater(x, y - 1, z, 8);          // vrije val
        activate(x, y - 1, z);
      } else if (belowId === B.WATER && !sources.has(key(x, y - 1, z)) && levelAt(x, y - 1, z) < 8) {
        setWater(x, y - 1, z, 8);
        activate(x, y - 1, z);
      } else {
        // horizontaal spreiden naar lucht
        const lvl = isSource ? 8 : levelAt(x, y, z);
        if (lvl > 1) {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (Chunks.getBlock(x + dx, y, z + dz) === B.AIR) {
              setWater(x + dx, y, z + dz, lvl - 1);
              activate(x + dx, y, z + dz);
            }
          }
        }
      }
    }
  }

  W.update = function (dt) {
    timer += dt;
    let guard = 0;
    while (timer >= STEP && guard++ < 3) { timer -= STEP; step(); }
  };

  // Voor opslaan/laden: bronnen bewaren/herstellen
  W.serialize = function () { return Array.from(sources); };
  W.deserialize = function (arr) {
    sources.clear();
    if (arr) for (const k of arr) { sources.add(k); const [x, y, z] = parse(k); activate(x, y, z); }
  };

  return W;
})();
