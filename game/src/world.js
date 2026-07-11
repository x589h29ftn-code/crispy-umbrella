// Wereldgeneratie: terrein, rivieren, meren, stranden, paden, bomen, bloemen en dorpen.
// Alles is deterministisch op basis van de seed, zodat chunks onafhankelijk
// gegenereerd kunnen worden en de wereld oneindig doorloopt.
window.World = (function () {
  const W = {};
  const B = G.B, CS = G.CS, CH = G.CH, SEA = G.SEA;

  const VILLAGE_CELL = 176;      // rasterafstand tussen mogelijke dorpen
  const VILLAGE_R = 30;          // straal van het dorp zelf
  const VILLAGE_BLEND = 46;      // straal waarbinnen terrein wordt vlakgetrokken

  let heightCache = new Map();
  let villageRawCache = new Map();
  let villageLayoutCache = new Map();

  W.init = function (seed) {
    G.seed = seed >>> 0;
    Noise.setSeed(G.seed);
    heightCache = new Map();
    villageRawCache = new Map();
    villageLayoutCache = new Map();
  };

  // ---- basis-terreinhoogte (zonder dorpen) -----------------------------------
  function riverFactor(x, z) {
    const rv = Math.abs(Noise.fbm2(x * 0.0016 + 500.3, z * 0.0016 - 333.7, 3));
    return 1 - Noise.smoothstep(0.0, 0.05, rv);   // 1 = midden van de rivier
  }
  W.riverFactor = riverFactor;

  function baseHeight(x, z) {
    const c = Noise.fbm2(x * 0.0022 + 31.7, z * 0.0022 - 11.3, 4);        // continenten
    const hills = Noise.fbm2(x * 0.009 + 7.1, z * 0.009 + 3.3, 3) * 4.5;  // heuveltjes
    const mMask = Noise.smoothstep(0.02, 0.5, Noise.fbm2(x * 0.0011 + 100.5, z * 0.0011 - 70.2, 3));
    const m = Noise.ridge2(x * 0.0055, z * 0.0055, 4);                    // bergkammen
    let h = SEA + 3.5 + c * 13 + hills + Math.pow(m, 2.1) * mMask * 46;

    // Rivieren uitslijpen — vooral in het laagland, bergen blijven intact
    const rf = riverFactor(x, z);
    if (rf > 0.001) {
      const lowland = Noise.smoothstep(SEA + 34, SEA + 8, h);
      const target = Math.min(h, SEA - 2.2 - rf * 1.5);
      h = Noise.lerp(h, target, rf * rf * lowland);
    }
    return h;
  }
  W.baseHeight = baseHeight;

  // ---- dorpen -----------------------------------------------------------------
  // Fase 1 (goedkoop): bestaat er een dorp in deze cel, en waar?
  function villageRaw(cellX, cellZ) {
    const key = cellX + ',' + cellZ;
    if (villageRawCache.has(key)) return villageRawCache.get(key);
    let v = null;
    const r1 = Noise.hash2(cellX * 7919 + 13, cellZ * 6101 - 7);
    if (r1 < 0.42) {
      const jx = Noise.hash2(cellX * 131 + 3, cellZ * 137 + 5);
      const jz = Noise.hash2(cellX * 139 + 11, cellZ * 149 + 17);
      const cx = cellX * VILLAGE_CELL + 48 + Math.floor(jx * (VILLAGE_CELL - 96));
      const cz = cellZ * VILLAGE_CELL + 48 + Math.floor(jz * (VILLAGE_CELL - 96));
      const h = baseHeight(cx, cz);
      const slope = Math.abs(baseHeight(cx + 14, cz) - baseHeight(cx - 14, cz)) +
                    Math.abs(baseHeight(cx, cz + 14) - baseHeight(cx, cz - 14));
      const river = riverFactor(cx, cz);
      if (h > SEA + 1.5 && h < SEA + 15 && slope < 9 && river < 0.25) {
        v = { cx, cz, groundY: Math.round(h), cellX, cellZ, key };
      }
    }
    villageRawCache.set(key, v);
    return v;
  }
  W.villageRaw = villageRaw;

  // Dichtstbijzijnd dorp rond een positie (of null)
  W.nearestVillage = function (x, z, maxDist) {
    const cX = Math.floor(x / VILLAGE_CELL), cZ = Math.floor(z / VILLAGE_CELL);
    let best = null, bestD = maxDist || 1e9;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const v = villageRaw(cX + dx, cZ + dz);
      if (!v) continue;
      const d = Math.hypot(v.cx - x, v.cz - z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  };

  // ---- uiteindelijke hoogte (terrein + dorps-afvlakking) ------------------------
  W.height = function (x, z) {
    const key = x + ',' + z;
    const c = heightCache.get(key);
    if (c !== undefined) return c;
    let h = baseHeight(x, z);
    const v = W.nearestVillage(x, z, VILLAGE_BLEND);
    if (v) {
      const d = Math.hypot(v.cx - x, v.cz - z);
      const t = Noise.smoothstep(VILLAGE_R * 0.55, VILLAGE_BLEND, d);
      h = Noise.lerp(v.groundY, h, t);
    }
    const hi = Math.max(2, Math.min(CH - 10, Math.round(h)));
    if (heightCache.size > 400000) heightCache.clear();
    heightCache.set(key, hi);
    return hi;
  };

  // ---- dorps-layout (fase 2, duur — wordt gecached) ------------------------------
  function bmSet(bm, x, y, z, id) { bm.set(x + ',' + y + ',' + z, id); }

  function buildHouse(bm, rng, hx, hz, gy, facing, spawns) {
    // afmetingen en materialen variëren per huis
    const w = 5 + ((rng() * 3) | 0);     // breedte (x)
    const d = 5 + ((rng() * 3) | 0);     // diepte (z)
    const wallH = 3 + ((rng() * 2) | 0);
    const wallMat = rng() < 0.6 ? B.PLANKS : B.COBBLE;
    const roofMat = rng() < 0.5 ? B.PLANKS : B.LOG;
    const x0 = hx - (w >> 1), z0 = hz - (d >> 1);
    const y0 = gy + 1;

    // fundering tot op de grond
    for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
      for (let y = gy; y > gy - 4; y--) bmSet(bm, x, y, z, B.DIRT);
      bmSet(bm, x, y0 - 1, z, B.PLANKS);           // vloer
      for (let y = y0; y < y0 + wallH; y++) {
        const edge = (x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1);
        const corner = (x === x0 || x === x0 + w - 1) && (z === z0 || z === z0 + d - 1);
        if (corner) bmSet(bm, x, y, z, B.LOG);
        else if (edge) bmSet(bm, x, y, z, wallMat);
        else bmSet(bm, x, y, z, B.AIR);             // binnenruimte leeg
      }
    }
    // deuropening richting dorpscentrum
    let dx = 0, dz = 0;
    if (facing === 0) { dx = x0 + (w >> 1); dz = z0; }
    else if (facing === 1) { dx = x0 + w - 1; dz = z0 + (d >> 1); }
    else if (facing === 2) { dx = x0 + (w >> 1); dz = z0 + d - 1; }
    else { dx = x0; dz = z0 + (d >> 1); }
    bmSet(bm, dx, y0, dz, B.AIR);
    bmSet(bm, dx, y0 + 1, dz, B.AIR);

    // raampjes
    for (let i = 0; i < 2 + ((rng() * 3) | 0); i++) {
      const side = (rng() * 4) | 0;
      let wx, wz;
      if (side === 0) { wx = x0 + 1 + ((rng() * (w - 2)) | 0); wz = z0; }
      else if (side === 1) { wx = x0 + 1 + ((rng() * (w - 2)) | 0); wz = z0 + d - 1; }
      else if (side === 2) { wx = x0; wz = z0 + 1 + ((rng() * (d - 2)) | 0); }
      else { wx = x0 + w - 1; wz = z0 + 1 + ((rng() * (d - 2)) | 0); }
      if (Math.abs(wx - dx) + Math.abs(wz - dz) > 1) bmSet(bm, wx, y0 + 1, wz, B.AIR);
    }

    // piramidedak met overstek
    let rx0 = x0 - 1, rz0 = z0 - 1, rw = w + 2, rd = d + 2;
    let ry = y0 + wallH;
    while (rw > 0 && rd > 0) {
      for (let x = rx0; x < rx0 + rw; x++) for (let z = rz0; z < rz0 + rd; z++) {
        const edge = (x === rx0 || x === rx0 + rw - 1 || z === rz0 || z === rz0 + rd - 1);
        if (edge || rw <= 2 || rd <= 2) bmSet(bm, x, ry, z, roofMat);
        else if (!bm.has(x + ',' + ry + ',' + z)) bmSet(bm, x, ry, z, B.AIR);
      }
      rx0++; rz0++; rw -= 2; rd -= 2; ry++;
      if (ry > y0 + wallH + 4) break;
    }

    // fakkels: binnen + naast de deur
    const inx = x0 + 1 + ((rng() * (w - 2)) | 0), inz = z0 + 1 + ((rng() * (d - 2)) | 0);
    bmSet(bm, inx, y0, inz, B.TORCH);
    const odx = dx + (facing === 3 ? -1 : facing === 1 ? 1 : (rng() < 0.5 ? -1 : 1));
    const odz = dz + (facing === 0 ? -1 : facing === 2 ? 1 : 0);
    bmSet(bm, odx + (facing === 0 || facing === 2 ? 1 : 0), y0, odz, B.TORCH);

    spawns.push({
      home: { x: hx + 0.5, y: y0, z: hz + 0.5 },
      door: { x: dx + (facing === 3 ? -1.2 : facing === 1 ? 1.2 : 0.5), y: y0, z: dz + (facing === 0 ? -1.2 : facing === 2 ? 1.2 : 0.5) },
    });
  }

  function buildPlot(bm, rng, px, pz, gy) {
    const w = 6 + ((rng() * 3) | 0), d = 5 + ((rng() * 3) | 0);
    const x0 = px - (w >> 1), z0 = pz - (d >> 1);
    const y0 = gy + 1;
    for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
      for (let y = gy - 2; y <= gy; y++) bmSet(bm, x, y, z, B.DIRT);
      const edge = (x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1);
      if (edge) {
        bmSet(bm, x, gy, z, B.GRASS);
        bmSet(bm, x, y0, z, B.FENCE);
      } else if (x === x0 + (w >> 1)) {
        bmSet(bm, x, gy, z, B.WATER);   // irrigatiegeultje
        bmSet(bm, x, y0, z, B.AIR);
      } else {
        bmSet(bm, x, gy, z, B.FARMLAND);
        bmSet(bm, x, y0, z, B.CROP);
      }
      bmSet(bm, x, y0 + 1, z, B.AIR);
    }
    // poortje
    bmSet(bm, x0 + (w >> 1), y0, z0, B.AIR);
  }

  function buildWell(bm, cx, cz, gy) {
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      const edge = !(x === cx && z === cz);
      bmSet(bm, x, gy, z, edge ? B.COBBLE : B.WATER);
      bmSet(bm, x, gy - 1, z, edge ? B.COBBLE : B.WATER);
      bmSet(bm, x, gy - 2, z, B.COBBLE);
      if (edge && (x !== cx && z !== cz)) bmSet(bm, x, gy + 1, z, B.COBBLE);
    }
    bmSet(bm, cx - 1, gy + 1, cz - 1, B.FENCE);
    bmSet(bm, cx + 1, gy + 1, cz + 1, B.FENCE);
  }

  function villageLayout(v) {
    if (villageLayoutCache.has(v.key)) return villageLayoutCache.get(v.key);
    const rng = Noise.rng((v.cellX * 92837111) ^ (v.cellZ * 689287499) ^ G.seed);
    const bm = new Map();        // "x,y,z" -> blok-id
    const spawns = [];
    const gy = v.groundY;

    buildWell(bm, v.cx, v.cz, gy);

    const nHouses = 3 + ((rng() * 4) | 0);
    const nPlots = 1 + ((rng() * 3) | 0);
    const total = nHouses + nPlots;
    const a0 = rng() * Math.PI * 2;
    for (let i = 0; i < total; i++) {
      const ang = a0 + (i / total) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const r = 13 + rng() * 11;
      const px = Math.round(v.cx + Math.cos(ang) * r);
      const pz = Math.round(v.cz + Math.sin(ang) * r);
      if (i < nHouses) {
        // deur richting het dorpscentrum
        const toC = Math.atan2(v.cz - pz, v.cx - px);
        let facing;
        if (Math.abs(Math.cos(toC)) > Math.abs(Math.sin(toC))) facing = Math.cos(toC) > 0 ? 1 : 3;
        else facing = Math.sin(toC) > 0 ? 2 : 0;
        buildHouse(bm, rng, px, pz, gy, facing, spawns);
        // pad van huis naar put
        const steps = Math.ceil(Math.hypot(px - v.cx, pz - v.cz));
        for (let s = 2; s < steps - 1; s++) {
          const t = s / steps;
          const lx = Math.round(Noise.lerp(px, v.cx, t)), lz = Math.round(Noise.lerp(pz, v.cz, t));
          const k = lx + ',' + gy + ',' + lz;
          if (!bm.has(k)) {
            bm.set(k, B.PATH);
            if (!bm.has(lx + ',' + (gy + 1) + ',' + lz)) bm.set(lx + ',' + (gy + 1) + ',' + lz, B.AIR);
          }
        }
      } else {
        buildPlot(bm, rng, px, pz, gy);
      }
    }

    // lantaarnpalen (hek + fakkel) langs het plein
    for (let i = 0; i < 3; i++) {
      const ang = rng() * Math.PI * 2;
      const lx = Math.round(v.cx + Math.cos(ang) * (5 + rng() * 5));
      const lz = Math.round(v.cz + Math.sin(ang) * (5 + rng() * 5));
      if (!bm.has(lx + ',' + (gy + 1) + ',' + lz)) {
        bmSet(bm, lx, gy + 1, lz, B.FENCE);
        bmSet(bm, lx, gy + 2, lz, B.TORCH);
      }
    }

    const layout = { blocks: bm, spawns, v };
    villageLayoutCache.set(v.key, layout);
    return layout;
  }
  W.villageLayout = villageLayout;

  // ---- bomen ---------------------------------------------------------------------
  // Deterministisch: bestaat er een boom met voet op kolom (x,z)?
  function treeAt(x, z) {
    const forest = Noise.fbm2(x * 0.004 + 900.2, z * 0.004 + 41.9, 3);      // bosdichtheid
    const density = Noise.clamp(0.006 + Noise.smoothstep(-0.15, 0.55, forest) * 0.055, 0, 0.06);
    const roll = Noise.hash2(x * 3 + 71, z * 3 - 29);
    if (roll > density) return null;
    const h = W.height(x, z);
    if (h <= SEA + 1 || h > 72) return null;
    if (riverFactor(x, z) > 0.35) return null;
    const v = W.nearestVillage(x, z, VILLAGE_R + 8);
    if (v && Math.hypot(v.cx - x, v.cz - z) < VILLAGE_R + 6) return null;

    const r = Noise.hash2(x * 17 + 5, z * 13 - 3);
    const r2 = Noise.hash2(x * 29 - 1, z * 31 + 9);
    let type;
    if (h > 52) type = 'pine';
    else if (r2 < 0.22) type = 'birch';
    else if (r2 < 0.3) type = 'pine';
    else type = 'oak';
    return { x, z, baseY: h + 1, type, size: r };
  }
  W.treeAt = treeAt;

  // Schrijft boomblokken via callback set(wx,wy,wz,id, soft)
  function placeTree(tree, set) {
    const { x, z, baseY, type, size } = tree;
    if (type === 'oak') {
      const th = 4 + Math.floor(size * 3);
      for (let y = 0; y < th; y++) set(x, baseY + y, z, B.LOG, false);
      const cy = baseY + th;
      const rad = 2 + (size > 0.6 ? 1 : 0);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const dd = dx * dx + dz * dz + dy * dy * 1.6;
        if (dd > rad * rad + 1) continue;
        if (dd > rad * rad - 1 && Noise.hash3(x + dx, cy + dy, z + dz) < 0.4) continue;
        set(x + dx, cy + dy, z + dz, B.LEAVES, true);
      }
    } else if (type === 'birch') {
      const th = 5 + Math.floor(size * 3);
      for (let y = 0; y < th; y++) set(x, baseY + y, z, B.LOG_BIRCH, false);
      const cy = baseY + th;
      for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const dd = dx * dx + dz * dz + dy * dy * 1.2;
        if (dd > 4.6) continue;
        if (dd > 3.4 && Noise.hash3(x + dx, cy + dy, z + dz) < 0.45) continue;
        set(x + dx, cy + dy, z + dz, B.LEAVES_BIRCH, true);
      }
    } else { // pine — kegel
      const th = 6 + Math.floor(size * 5);
      for (let y = 0; y < th; y++) set(x, baseY + y, z, B.LOG, false);
      for (let layer = 0; layer < th - 1; layer++) {
        const y = baseY + 2 + layer;
        const rad = Math.max(1, Math.round((th - layer) * 0.34));
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (dx * dx + dz * dz > rad * rad + 0.5) continue;
          if (dx === 0 && dz === 0 && layer < th - 3) continue;
          set(x + dx, y, z + dz, B.LEAVES_PINE, true);
        }
      }
      set(x, baseY + th, z, B.LEAVES_PINE, true);
      set(x, baseY + th + 1, z, B.LEAVES_PINE, true);
    }
  }

  // ---- chunk-generatie -------------------------------------------------------------
  W.genChunk = function (cx, cz) {
    const blocks = new Uint8Array(CS * CH * CS);
    const idx = (x, y, z) => x + z * CS + y * CS * CS;
    const x0 = cx * CS, z0 = cz * CS;

    // 1. terrein per kolom
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const h = W.height(wx, wz);
      const rf = riverFactor(wx, wz);
      const surfNoise = Noise.hash2(wx * 7 + 1, wz * 7 - 4);

      // oppervlakteblok kiezen
      let surf = B.GRASS, under = B.DIRT;
      const snowLine = 66 + surfNoise * 5;
      const stoneLine = 56 + surfNoise * 7;
      if (h >= snowLine) { surf = B.SNOW; under = B.STONE; }
      else if (h >= stoneLine) { surf = B.STONE; under = B.STONE; }
      else if (h <= SEA + 1 + surfNoise * 1.5) { surf = B.SAND; under = B.SAND; }
      else if (rf > 0.25 && h <= SEA + 3) { surf = B.SAND; under = B.SAND; }

      // wandelpaden door het landschap
      if (surf === B.GRASS) {
        const pn = Math.abs(Noise.fbm2(wx * 0.0045 + 77.7, wz * 0.0045 - 123.4, 2));
        if (pn < 0.012) {
          const slope = Math.abs(W.height(wx + 2, wz) - W.height(wx - 2, wz)) +
                        Math.abs(W.height(wx, wz + 2) - W.height(wx, wz - 2));
          if (slope < 4) surf = Noise.hash2(wx, wz) < 0.75 ? B.PATH : B.GRAVEL;
        }
      }

      for (let y = 0; y <= h && y < CH; y++) {
        let id;
        if (y === h) id = surf;
        else if (y >= h - 3) id = under;
        else id = B.STONE;
        blocks[idx(lx, y, lz)] = id;
      }
      // water opvullen tot zeeniveau
      if (h < SEA) {
        for (let y = h + 1; y <= SEA; y++) blocks[idx(lx, y, lz)] = B.WATER;
        // bodem naar zand/grind
        blocks[idx(lx, h, lz)] = surfNoise < 0.5 ? B.SAND : B.GRAVEL;
      }
    }

    const setLocal = (wx, wy, wz, id, soft) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || wy < 0 || wy >= CH) return;
      const i = idx(lx, wy, lz);
      if (soft && blocks[i] !== B.AIR) return;   // bladeren overschrijven niets
      blocks[i] = id;
    };

    // 2. bomen (incl. rand van 3 blokken zodat kronen over chunkgrenzen doorlopen)
    for (let wz = z0 - 3; wz < z0 + CS + 3; wz++) for (let wx = x0 - 3; wx < x0 + CS + 3; wx++) {
      const tr = treeAt(wx, wz);
      if (tr) placeTree(tr, setLocal);
    }

    // 3. gras, bloemen en gewassen op grasoppervlak
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const h = W.height(wx, wz);
      if (h + 1 >= CH) continue;
      if (blocks[idx(lx, h, lz)] !== B.GRASS) continue;
      if (blocks[idx(lx, h + 1, lz)] !== B.AIR) continue;
      const meadow = Noise.fbm2(wx * 0.012 + 55.5, wz * 0.012 - 88.8, 2);
      const roll = Noise.hash2(wx * 11 + 2, wz * 11 + 6);
      const grassP = 0.10 + Noise.smoothstep(-0.3, 0.6, meadow) * 0.38;
      if (roll < grassP) {
        blocks[idx(lx, h + 1, lz)] = B.TALLGRASS;
      } else if (roll < grassP + 0.025) {
        const fpatch = Noise.fbm2(wx * 0.02 + 400, wz * 0.02 + 300, 2);
        const fr = Noise.hash2(wx * 13 - 8, wz * 17 + 4);
        let fl = B.FLOWER_YELLOW;
        if (fpatch > 0.25) fl = B.FLOWER_RED;
        else if (fpatch < -0.25) fl = B.FLOWER_BLUE;
        else if (fr < 0.3) fl = B.FLOWER_WHITE;
        blocks[idx(lx, h + 1, lz)] = fl;
      }
    }

    // 4. dorpsbebouwing eroverheen
    const cellMinX = Math.floor((x0 - VILLAGE_R - 8) / VILLAGE_CELL);
    const cellMaxX = Math.floor((x0 + CS + VILLAGE_R + 8) / VILLAGE_CELL);
    const cellMinZ = Math.floor((z0 - VILLAGE_R - 8) / VILLAGE_CELL);
    const cellMaxZ = Math.floor((z0 + CS + VILLAGE_R + 8) / VILLAGE_CELL);
    for (let vx = cellMinX; vx <= cellMaxX; vx++) for (let vz = cellMinZ; vz <= cellMaxZ; vz++) {
      const v = villageRaw(vx, vz);
      if (!v) continue;
      if (v.cx + VILLAGE_R + 8 < x0 || v.cx - VILLAGE_R - 8 > x0 + CS) continue;
      if (v.cz + VILLAGE_R + 8 < z0 || v.cz - VILLAGE_R - 8 > z0 + CS) continue;
      const layout = villageLayout(v);
      layout.blocks.forEach((id, k) => {
        const p = k.split(',');
        const wx = +p[0], wy = +p[1], wz = +p[2];
        const lx = wx - x0, lz = wz - z0;
        if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || wy < 0 || wy >= CH) return;
        blocks[idx(lx, wy, lz)] = id;
      });
    }

    return blocks;
  };

  return W;
})();
