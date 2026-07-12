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
  let landmarkRawCache = new Map();
  let landmarkLayoutCache = new Map();
  W.waterfallBases = new Map();   // "x,z" -> y : voet van een berg-waterval (voor nevel)

  const LANDMARK_CELL = 208;      // grof raster voor bezienswaardigheden

  W.init = function (seed) {
    G.seed = seed >>> 0;
    Noise.setSeed(G.seed);
    heightCache = new Map();
    villageRawCache = new Map();
    villageLayoutCache = new Map();
    landmarkRawCache = new Map();
    landmarkLayoutCache = new Map();
    W.waterfallBases = new Map();
  };

  // ---- basis-terreinhoogte (zonder dorpen) -----------------------------------
  function riverFactor(x, z) {
    const rv = Math.abs(Noise.fbm2(x * 0.0016 + 500.3, z * 0.0016 - 333.7, 3));
    return 1 - Noise.smoothstep(0.0, 0.05, rv);   // 1 = midden van de rivier
  }
  W.riverFactor = riverFactor;

  // Fijner, dichter net van smalle beekjes (kronkelend door het laagland)
  function brookFactor(x, z) {
    const bv = Math.abs(Noise.fbm2(x * 0.0052 + 812.4, z * 0.0052 - 217.9, 3));
    return 1 - Noise.smoothstep(0.0, 0.022, bv);   // dunner dan een rivier
  }
  W.brookFactor = brookFactor;
  // Gecombineerde "hoeveel water op dit punt" voor collision/lelie-checks
  W.waterFactor = function (x, z) { return Math.max(riverFactor(x, z), brookFactor(x, z) * 0.85); };

  // ---- biomes (temperatuur/vochtigheid) --------------------------------------
  // 'normal' laat de bestaande logica (weides, bossen, lavendel, kersen) intact.
  W.biomeAt = function (x, z) {
    const temp = Noise.fbm2(x * 0.0016 + 12.3, z * 0.0016 - 88.1, 3);
    const humid = Noise.fbm2(x * 0.0016 - 300.7, z * 0.0016 + 210.4, 3);
    const mush = Noise.fbm2(x * 0.006 + 555.5, z * 0.006 - 111.1, 2);
    if (mush > 0.52) return 'mushroom';
    if (temp > 0.34 && humid < -0.04) return 'desert';
    if (temp > 0.22 && humid >= -0.04 && humid < 0.12) return 'savanna';
    if (humid > 0.42 && temp < 0.16) return 'swamp';
    return 'normal';
  };

  function baseHeight(x, z) {
    // Continenten — flink omhoog gebiast zodat het land duidelijk bóven het
    // water uitkomt (geen vlakke, half-ondergelopen wereld meer).
    const cont = Noise.fbm2(x * 0.0018 + 31.7, z * 0.0018 - 11.3, 4);
    const rolling = Noise.fbm2(x * 0.010 + 7.1, z * 0.010 + 3.3, 3);      // glooiende heuvels
    const detail = Noise.fbm2(x * 0.032 - 5.5, z * 0.032 + 9.2, 2);       // fijne oneffenheden
    const mMask = Noise.smoothstep(-0.12, 0.34, Noise.fbm2(x * 0.0012 + 100.5, z * 0.0012 - 70.2, 3));
    const m = Noise.ridge2(x * 0.0042, z * 0.0042, 5);                    // bergkammen
    // hoge, steile kliffen: sterke exponent + tweede scherpe kam bovenop
    const cliff = Math.pow(m, 2.4);
    const spires = Math.pow(Noise.ridge2(x * 0.011 + 9.9, z * 0.011 - 4.4, 3), 3) * 0.4;

    let h = SEA + 8
          + cont * 26                                   // continentaal reliëf, land boven zee
          + rolling * 13                                // heuvels
          + detail * 4                                  // kleine bulten
          + (cliff + spires * cliff) * mMask * 112;     // dramatische bergen

    // Rivieren uitslijpen — vooral in het laagland, bergen blijven intact
    const rf = riverFactor(x, z);
    if (rf > 0.001) {
      const lowland = Noise.smoothstep(SEA + 42, SEA + 10, h);
      const target = Math.min(h, SEA - 2.5 - rf * 1.6);
      h = Noise.lerp(h, target, rf * rf * lowland);
    }
    // Beekjes: smalle, ondiepe geultjes die kronkelen door heuvels en vlakten
    const bf = brookFactor(x, z);
    if (bf > 0.02) {
      const lowland = Noise.smoothstep(SEA + 48, SEA + 4, h);
      const target = Math.min(h, SEA - 0.6);          // ondiep, net onder zeeniveau
      h = Noise.lerp(h, target, bf * bf * lowland * 0.9);
    }
    return Math.min(h, CH - 6);
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

  // Wobbelend punt op een dorpsweg-segment bij parameter t (0..1).
  function roadPoint(v, n, ox, t) {
    const dcx = n.cx - v.cx, dcz = n.cz - v.cz;
    const len = Math.hypot(dcx, dcz) || 1;
    const wob = Noise.noise2(t * 4 + v.cellX * 3.1, v.cellZ * 2.7 + ox) * (len * 0.07);
    return {
      x: v.cx + dcx * t - dcz / len * wob,
      z: v.cz + dcz * t + dcx / len * wob,
      len,
    };
  }
  W.roadPoint = roadPoint;

  // Alle dorpsweg-segmenten in de buurt van (x,z) verzamelen (uniek per paar).
  W.roadSegmentsNear = function (x, z, cellRange) {
    const cX = Math.floor(x / VILLAGE_CELL), cZ = Math.floor(z / VILLAGE_CELL);
    const rr = cellRange || 1;
    const segs = [], seen = new Set();
    for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
      const v = villageRaw(cX + dx, cZ + dz);
      if (!v) continue;
      for (const [ox, oz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const n = villageRaw(v.cellX + ox, v.cellZ + oz);
        if (!n) continue;
        const len = Math.hypot(n.cx - v.cx, n.cz - v.cz);
        if (len < 1 || len > VILLAGE_CELL * 2.1) continue;
        const key = Math.min(v.key, n.key) + '|' + Math.max(v.key, n.key);
        if (seen.has(key)) continue;
        seen.add(key);
        segs.push({ v, n, ox, len, key });
      }
    }
    return segs;
  };

  // Info over de dichtstbijzijnde dorpsweg door (x,z): afstand tot het hart + richting.
  W.roadInfo = function (x, z) {
    const cX = Math.floor(x / VILLAGE_CELL), cZ = Math.floor(z / VILLAGE_CELL);
    let best = null, bestD = 1e9;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const v = villageRaw(cX + dx, cZ + dz);
      if (!v) continue;
      for (const [ox, oz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const n = villageRaw(v.cellX + ox, v.cellZ + oz);
        if (!n) continue;
        const dcx = n.cx - v.cx, dcz = n.cz - v.cz;
        const len = Math.hypot(dcx, dcz);
        if (len < 1 || len > VILLAGE_CELL * 2.1) continue;
        let tPar = ((x - v.cx) * dcx + (z - v.cz) * dcz) / (len * len);
        tPar = Noise.clamp(tPar, 0, 1);
        const p = roadPoint(v, n, ox, tPar);
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < bestD) { bestD = d; best = { dist: d, t: tPar, px: p.x, pz: p.z, v, n, ox, len }; }
      }
    }
    return best;
  };

  // Ligt (x,z) op een verbindingsweg tussen twee naburige dorpen?
  W.onVillageRoad = function (x, z) {
    const info = W.roadInfo(x, z);
    return !!info && info.dist < 1.8;
  };
  // Ligt (x,z) op het spoor (het hart van de weg)?
  W.onRail = function (x, z) {
    const info = W.roadInfo(x, z);
    return !!info && info.dist < 0.8;
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

    // gezellig kampvuurtje met plankbankjes op het plein
    let campfire = null;
    {
      const ang = rng() * Math.PI * 2;
      const fx = Math.round(v.cx + Math.cos(ang) * 6);
      const fz = Math.round(v.cz + Math.sin(ang) * 6);
      bmSet(bm, fx, gy, fz, B.COBBLE);
      bmSet(bm, fx, gy + 1, fz, B.CAMPFIRE);
      for (const [bx, bz] of [[fx - 2, fz], [fx + 2, fz], [fx, fz - 2], [fx, fz + 2]]) {
        bmSet(bm, bx, gy, bz, B.DIRT);
        bmSet(bm, bx, gy + 1, bz, B.SLAB);
      }
      campfire = { x: fx + 0.5, y: gy + 1, z: fz + 0.5 };
    }

    // een gezellig vijvertje met een beekje aan de rand van het plein
    {
      const ang = rng() * Math.PI * 2;
      const px = Math.round(v.cx + Math.cos(ang) * (9 + rng() * 4));
      const pz = Math.round(v.cz + Math.sin(ang) * (9 + rng() * 4));
      const rad = 2 + ((rng() * 2) | 0);
      for (let dx = -rad - 1; dx <= rad + 1; dx++) for (let dz = -rad - 1; dz <= rad + 1; dz++) {
        const d = Math.hypot(dx, dz);
        const x = px + dx, z = pz + dz;
        if (d <= rad) {
          // waterkom (1 diep), zandbodem
          bmSet(bm, x, gy, z, B.WATER);
          bmSet(bm, x, gy - 1, z, B.SAND);
          bmSet(bm, x, gy + 1, z, B.AIR);
          if (d < rad - 1 && rng() < 0.18) bmSet(bm, x, gy + 1, z, B.LILYPAD);
        } else if (d <= rad + 1) {
          // zandige oever + wat riet
          bmSet(bm, x, gy, z, B.SAND);
          if (rng() < 0.25) bmSet(bm, x, gy + 1, z, B.TALLGRASS);
        }
      }
      // een kort beekje dat van de vijver wegkronkelt
      let bx = px, bz = pz;
      const bdir = rng() * Math.PI * 2;
      const blen = 5 + ((rng() * 5) | 0);
      for (let s = 0; s < blen; s++) {
        bx = Math.round(px + Math.cos(bdir) * s + Math.sin(s * 0.9) * 1.2);
        bz = Math.round(pz + Math.sin(bdir) * s - Math.cos(s * 0.9) * 1.2);
        bmSet(bm, bx, gy, bz, B.WATER);
        bmSet(bm, bx, gy - 1, bz, B.SAND);
        bmSet(bm, bx, gy + 1, bz, B.AIR);
        // klein bruggetje halverwege
        if (s === (blen >> 1)) {
          bmSet(bm, bx, gy + 1, bz - 1, B.SLAB);
          bmSet(bm, bx, gy + 1, bz + 1, B.SLAB);
          bmSet(bm, bx, gy + 1, bz, B.SLAB);
        }
      }
    }

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

    // marktkraampjes op het plein (doek-luifel op palen met een toonbank)
    const market = [];
    const nStalls = 2 + ((rng() * 2) | 0);
    for (let i = 0; i < nStalls; i++) {
      const ang = rng() * Math.PI * 2, r = 4 + rng() * 3;
      const mx = Math.round(v.cx + Math.cos(ang) * r), mz = Math.round(v.cz + Math.sin(ang) * r);
      // 4 palen
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { bmSet(bm, mx + ox, gy + 1, mz + oz, B.FENCE); bmSet(bm, mx + ox, gy + 2, mz + oz, B.FENCE); }
      // doek-luifel
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1], [-0.0, 0]]) bmSet(bm, mx + ox, gy + 3, mz + oz, B.CLOTH);
      // toonbank + waar
      bmSet(bm, mx, gy + 1, mz, B.SLAB); bmSet(bm, mx + 1, gy + 1, mz, B.SLAB);
      bmSet(bm, mx, gy + 2, mz, B.CROP);
      market.push({ x: mx + 0.5, z: mz + 0.5, y: gy + 1 });
    }

    // klokkentoren aan de rand van het plein
    {
      const ang = rng() * Math.PI * 2, r = 7 + rng() * 3;
      const tx = Math.round(v.cx + Math.cos(ang) * r), tz = Math.round(v.cz + Math.sin(ang) * r);
      const H = 8;
      for (let y = 1; y <= H; y++) for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        bmSet(bm, tx + ox, gy + y, tz + oz, (y === H) ? B.PLANKS : (Noise.hash3(tx + ox, gy + y, tz + oz) < 0.2 ? B.STONE_BRICK_MOSSY : B.STONE_BRICK));
      }
      // open klokkenverdieping
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) bmSet(bm, tx + ox, gy + H - 1, tz + oz, B.AIR);
      // de klok + spits
      bmSet(bm, tx, gy + H - 1, tz, B.LANTERN);
      bmSet(bm, tx, gy + H + 1, tz, B.PLANKS); bmSet(bm, tx + 1, gy + H + 1, tz + 1, B.PLANKS);
    }

    // omheinde boerderij-wei met een poortje
    {
      const ang = rng() * Math.PI * 2, r = 13 + rng() * 4;
      const fx = Math.round(v.cx + Math.cos(ang) * r), fz = Math.round(v.cz + Math.sin(ang) * r);
      const w = 3, d = 3;
      for (let dx = -w; dx <= w; dx++) for (let dz = -d; dz <= d; dz++) {
        const edge = Math.abs(dx) === w || Math.abs(dz) === d;
        if (edge) bmSet(bm, fx + dx, gy + 1, fz + dz, (dx === 0 && dz === -d) ? B.FENCE_GATE : B.FENCE);
      }
      // wat hooi (doek) en een drinkbak
      bmSet(bm, fx, gy + 1, fz, B.CLOTH);
      bmSet(bm, fx + 1, gy + 1, fz + 1, B.WATER);
      v.pen = { x: fx + 0.5, z: fz + 0.5, y: gy + 1, r: w };
    }

    const layout = { blocks: bm, spawns, v, campfire, market, pen: v.pen };
    villageLayoutCache.set(v.key, layout);
    return layout;
  }
  W.villageLayout = villageLayout;

  // ---- bezienswaardigheden (torens, ruïnes, standbeelden, boogbruggen) ------------
  function landmarkRaw(cellX, cellZ) {
    const key = cellX + ',' + cellZ;
    if (landmarkRawCache.has(key)) return landmarkRawCache.get(key);
    let l = null;
    const r = Noise.hash2(cellX * 8317 + 41, cellZ * 2609 - 13);
    if (r < 0.4) {
      const jx = Noise.hash2(cellX * 53 + 7, cellZ * 97 + 3);
      const jz = Noise.hash2(cellX * 89 + 1, cellZ * 61 + 9);
      const cx = cellX * LANDMARK_CELL + 40 + Math.floor(jx * (LANDMARK_CELL - 80));
      const cz = cellZ * LANDMARK_CELL + 40 + Math.floor(jz * (LANDMARK_CELL - 80));
      const v = W.nearestVillage(cx, cz, VILLAGE_R + 34);
      if (!(v && Math.hypot(v.cx - cx, v.cz - cz) < VILLAGE_R + 34)) {
        const h = baseHeight(cx, cz);
        const river = riverFactor(cx, cz);
        const tsel = Noise.hash2(cellX * 13 - 5, cellZ * 17 + 2);
        let type = null;
        if (river > 0.3 && h < SEA + 5) type = 'bridge';
        else if (h > SEA + 2 && h < SEA + 66 && river < 0.2) type = tsel < 0.4 ? 'tower' : (tsel < 0.75 ? 'ruin' : 'statue');
        if (type) l = { cx, cz, groundY: Math.round(h), type, cellX, cellZ, key, seed: ((cellX * 40009) ^ (cellZ * 70001)) >>> 0 };
      }
    }
    landmarkRawCache.set(key, l);
    return l;
  }
  W.landmarkRaw = landmarkRaw;

  function landmarkLayout(l) {
    if (landmarkLayoutCache.has(l.key)) return landmarkLayoutCache.get(l.key);
    const bm = new Map();
    const set = (x, y, z, id) => { if (y >= 0 && y < CH) bm.set(x + ',' + y + ',' + z, id); };
    const rng = Noise.rng(l.seed);
    const gy = l.groundY, cx = l.cx, cz = l.cz;

    if (l.type === 'tower') {
      const rad = 2, H = 9 + ((rng() * 6) | 0);
      // fundering
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) set(cx + dx, gy, cz + dz, B.COBBLE);
      for (let y = 1; y <= H; y++) {
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dz)) === rad;
          if (!ring) { if (y === H) set(cx + dx, gy + y, cz + dz, B.STONE_BRICK); continue; }  // dak
          const mossy = Noise.hash3(cx + dx, gy + y, cz + dz) < 0.25;
          set(cx + dx, gy + y, cz + dz, mossy ? B.STONE_BRICK_MOSSY : B.STONE_BRICK);
        }
        // ramen
        if (y % 3 === 2) { set(cx + rad, gy + y, cz, B.GLASS); set(cx - rad, gy + y, cz, B.GLASS); set(cx, gy + y, cz + rad, B.GLASS); set(cx, gy + y, cz - rad, B.GLASS); }
      }
      // deuropening
      set(cx, gy + 1, cz + rad, B.AIR); set(cx, gy + 2, cz + rad, B.AIR);
      // kantelen op het dak
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === rad && ((dx + dz) & 1) === 0) set(cx + dx, gy + H + 1, cz + dz, B.STONE_BRICK);
      }
      set(cx, gy + H, cz, B.LANTERN);
    } else if (l.type === 'ruin') {
      const w = 3 + ((rng() * 3) | 0), d = 2 + ((rng() * 3) | 0);
      for (let dx = -w; dx <= w; dx++) for (let dz = -d; dz <= d; dz++) set(cx + dx, gy, cz + dz, rng() < 0.5 ? B.COBBLE : B.STONE_BRICK_MOSSY);
      for (let dx = -w; dx <= w; dx++) for (let dz = -d; dz <= d; dz++) {
        const edge = Math.abs(dx) === w || Math.abs(dz) === d;
        if (!edge) continue;
        const hh = 1 + ((Noise.hash3(cx + dx, 7, cz + dz) * 4) | 0);   // afgebrokkelde muur
        for (let y = 1; y <= hh; y++) if (Noise.hash3(cx + dx, gy + y, cz + dz) > 0.2) set(cx + dx, gy + y, cz + dz, B.STONE_BRICK_MOSSY);
      }
      // een losstaande gebroken zuil
      const px = cx + (w - 1), pz = cz - (d - 1);
      for (let y = 1; y <= 4; y++) set(px, gy + y, pz, B.STONE_BRICK);
    } else if (l.type === 'statue') {
      // sokkel
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { set(cx + dx, gy + 1, cz + dz, B.STONE_BRICK); set(cx + dx, gy + 2, cz + dz, B.STONE_BRICK); }
      // figuur van keien
      set(cx, gy + 3, cz, B.COBBLE); set(cx, gy + 4, cz, B.COBBLE);   // lijf
      set(cx, gy + 5, cz, B.COBBLE);                                   // hoofd
      set(cx + 1, gy + 4, cz, B.COBBLE); set(cx - 1, gy + 4, cz, B.COBBLE);  // armen
    } else if (l.type === 'bridge') {
      // richting bepalen: overspan loodrecht op de rivierloop
      const gX = riverFactor(cx + 2, cz) - riverFactor(cx - 2, cz);
      const gZ = riverFactor(cx, cz + 2) - riverFactor(cx, cz - 2);
      const alongX = Math.abs(gX) <= Math.abs(gZ);   // rivier langs z → brug langs x
      const deckY = SEA + 2, half = 7;
      for (let s = -half; s <= half; s++) {
        const bx = alongX ? cx + s : cx;
        const bz = alongX ? cz : cz + s;
        // dek met lichte boog
        const arch = Math.round((1 - (s * s) / (half * half)) * 2);
        const y = deckY + arch;
        for (const [ox, oz] of alongX ? [[0, -1], [0, 0], [0, 1]] : [[-1, 0], [0, 0], [1, 0]]) set(bx + ox, y, bz + oz, B.STONE_BRICK);
        // leuningen
        const rail = alongX ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
        for (const [ox, oz] of rail) set(bx + ox, y + 1, bz + oz, B.FENCE);
        // pijler in het midden
        if (s === 0) for (let y2 = SEA - 3; y2 < y; y2++) { set(bx, y2, bz, B.COBBLE); }
      }
    }
    const layout = { blocks: bm, l };
    landmarkLayoutCache.set(l.key, layout);
    return layout;
  }
  W.landmarkLayout = landmarkLayout;

  // ---- bomen ---------------------------------------------------------------------
  // Deterministisch: bestaat er een boom met voet op kolom (x,z)?
  function treeAt(x, z) {
    // palmen langs zonnige stranden (zand vlak bij zee) — eigen spawnkans
    {
      const hb = W.height(x, z);
      if (hb >= SEA && hb <= SEA + 2 && riverFactor(x, z) < 0.15) {
        const beach = Noise.fbm2(x * 0.004 - 300.3, z * 0.004 + 120.7, 2);
        if (beach > 0.12 && Noise.hash2(x * 7 + 13, z * 7 - 5) < 0.10) {
          const vv = W.nearestVillage(x, z, VILLAGE_R + 8);
          if (!(vv && Math.hypot(vv.cx - x, vv.cz - z) < VILLAGE_R + 6) && !W.onVillageRoad(x, z))
            return { x, z, baseY: hb + 1, type: 'palm', size: Noise.hash2(x * 17 + 5, z * 13 - 3) };
        }
      }
    }
    const forest = Noise.fbm2(x * 0.004 + 900.2, z * 0.004 + 41.9, 3);      // bosdichtheid
    const density = Noise.clamp(0.006 + Noise.smoothstep(-0.15, 0.55, forest) * 0.055, 0, 0.06);
    const roll = Noise.hash2(x * 3 + 71, z * 3 - 29);
    if (roll > density) return null;
    const h = W.height(x, z);
    if (h <= SEA + 1 || h > 76) return null;
    if (riverFactor(x, z) > 0.35) return null;
    const v = W.nearestVillage(x, z, VILLAGE_R + 8);
    if (v && Math.hypot(v.cx - x, v.cz - z) < VILLAGE_R + 6) return null;
    if (W.onVillageRoad(x, z)) return null;   // geen bomen op de weg

    const r = Noise.hash2(x * 17 + 5, z * 13 - 3);
    const r2 = Noise.hash2(x * 29 - 1, z * 31 + 9);
    // biome-specifieke begroeiing
    const biome = W.biomeAt(x, z);
    if (biome === 'desert') return null;                     // geen bomen (cactussen via veg-stap)
    if (biome === 'savanna') {
      if (roll > density * 0.35) return null;                // schaars
      return { x, z, baseY: h + 1, type: 'acacia', size: r };
    }
    if (biome === 'mushroom') {
      if (roll > density * 0.5) return null;
      return { x, z, baseY: h + 1, type: 'giantmushroom', size: r };
    }
    if (biome === 'swamp') {
      return { x, z, baseY: h + 1, type: 'willow', size: r };   // dicht wilgenmoeras
    }
    // kersenbloesem-gebieden (aparte, zeldzame biome-vlekken in het laagland)
    const blossom = Noise.fbm2(x * 0.0026 - 410.7, z * 0.0026 + 88.3, 3);
    let type;
    if (h <= SEA + 4 && r2 < 0.6) type = 'willow';    // treurwilgen langs het water
    else if (blossom > 0.28 && h > SEA + 2 && h < 52) type = 'cherry';   // kersenbloesem
    else if (h > 54) type = 'pine';
    else if (r2 < 0.22) type = 'birch';
    else if (r2 < 0.3) type = 'pine';
    else if (r > 0.9) type = 'bigoak';                // af en toe een reuzeneik
    else type = 'oak';
    return { x, z, baseY: h + 1, type, size: r };
  }
  W.treeAt = treeAt;

  // Schrijft boomblokken via callback set(wx,wy,wz,id, soft)
  function placeTree(tree, set) {
    const { x, z, baseY, type, size } = tree;
    if (type === 'oak') {
      const th = 6 + Math.floor(size * 4);          // hogere, duidelijk zichtbare stam
      for (let y = 0; y < th; y++) set(x, baseY + y, z, B.LOG, false);
      const cy = baseY + th;
      const rad = 2 + (size > 0.6 ? 1 : 0);
      // kroon bovenop de stam (laagste blad ruim boven de grond)
      for (let dy = -1; dy <= 3; dy++) for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const dd = dx * dx + dz * dz + (dy - 0.5) * (dy - 0.5) * 1.6;
        if (dd > rad * rad + 1) continue;
        if (dd > rad * rad - 1 && Noise.hash3(x + dx, cy + dy, z + dz) < 0.4) continue;
        set(x + dx, cy + dy, z + dz, B.LEAVES, true);
      }
    } else if (type === 'birch') {
      const th = 7 + Math.floor(size * 4);
      for (let y = 0; y < th; y++) set(x, baseY + y, z, B.LOG_BIRCH, false);
      const cy = baseY + th;
      for (let dy = -1; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const dd = dx * dx + dz * dz + (dy - 1) * (dy - 1) * 1.2;
        if (dd > 4.6) continue;
        if (dd > 3.4 && Noise.hash3(x + dx, cy + dy, z + dz) < 0.45) continue;
        set(x + dx, cy + dy, z + dz, B.LEAVES_BIRCH, true);
      }
    } else if (type === 'cherry') {
      const th = 6 + Math.floor(size * 3);
      for (let y = 0; y < th; y++) {
        set(x, baseY + y, z, B.LOG, false);
        if (y === th - 1) { set(x + 1, baseY + y, z, B.LOG, false); set(x - 1, baseY + y, z, B.LOG, false); }
      }
      const cy = baseY + th, rad = 3;
      for (let dy = 0; dy <= 3; dy++) for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const dd = dx * dx + dz * dz + (dy - 1) * (dy - 1) * 1.4;
        if (dd > rad * rad + 1.5) continue;
        if (dd > rad * rad - 1 && Noise.hash3(x + dx, cy + dy, z + dz) < 0.4) continue;
        set(x + dx, cy + dy, z + dz, B.LEAVES_CHERRY, true);
      }
    } else if (type === 'bigoak') {
      const th = 9 + Math.floor(size * 5);
      for (let y = 0; y < th; y++) {
        set(x, baseY + y, z, B.LOG, false);
        if (y > th - 4) { set(x + 1, baseY + y, z, B.LOG, false); set(x, baseY + y, z + 1, B.LOG, false); }
      }
      const cy = baseY + th, rad = 4;
      for (let dy = -2; dy <= 4; dy++) for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const dd = dx * dx + dz * dz + (dy - 1) * (dy - 1) * 1.5;
        if (dd > rad * rad + 2) continue;
        if (dd > rad * rad - 2 && Noise.hash3(x + dx, cy + dy, z + dz) < 0.45) continue;
        set(x + dx, cy + dy, z + dz, B.LEAVES, true);
      }
    } else if (type === 'willow') {
      const th = 6 + Math.floor(size * 3);
      for (let y = 0; y < th; y++) set(x, baseY + y, z, B.LOG, false);
      const cy = baseY + th, rad = 3;
      for (let dy = -1; dy <= 2; dy++) for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (dx * dx + dz * dz + dy * dy > rad * rad + 1) continue;
        set(x + dx, cy + dy, z + dz, B.LEAVES_WILLOW, true);
      }
      // afhangende slierten aan de rand van de kroon
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        const dx = Math.round(Math.cos(ang) * rad), dz = Math.round(Math.sin(ang) * rad);
        const len = 2 + Math.floor(Noise.hash2(x + dx + a, z + dz - a) * 3);
        for (let k = 0; k < len; k++) set(x + dx, cy - 1 - k, z + dz, B.LEAVES_WILLOW, true);
      }
    } else if (type === 'acacia') {
      // savanne-acacia: rechte stam met een brede, platte kroon
      const th = 6 + Math.floor(size * 3);
      const lean = size > 0.5 ? 1 : -1;
      let ax = x, az = z;
      for (let y = 0; y < th; y++) { if (y === (th >> 1)) { ax += lean; } set(ax, baseY + y, az, B.LOG, false); }
      const cy = baseY + th, rad = 3;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (dx * dx + dz * dz > rad * rad + 1) continue;
        set(ax + dx, cy, az + dz, B.LEAVES, true);
        if ((dx * dx + dz * dz) < 2) set(ax + dx, cy + 1, az + dz, B.LEAVES, true);
      }
    } else if (type === 'giantmushroom') {
      // reuzenpaddenstoel: dikke steel met een brede, gloeiende hoed
      const th = 4 + Math.floor(size * 4);
      for (let y = 0; y < th; y++) {
        set(x, baseY + y, z, B.MUSHROOM_STEM, false);
        if (size > 0.5) { set(x + 1, baseY + y, z, B.MUSHROOM_STEM, false); set(x, baseY + y, z + 1, B.MUSHROOM_STEM, false); set(x + 1, baseY + y, z + 1, B.MUSHROOM_STEM, false); }
      }
      const cy = baseY + th, rad = 3 + (size > 0.5 ? 1 : 0);
      const ox = size > 0.5 ? 0.5 : 0;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const dd = dx * dx + dz * dz;
        if (dd > rad * rad + 1) continue;
        const cxr = Math.round(x + ox), czr = Math.round(z + ox);
        set(cxr + dx, cy, czr + dz, B.MUSHROOM_CAP, true);
        // opstaande rand
        if (dd > (rad - 1) * (rad - 1)) set(cxr + dx, cy + 1, czr + dz, B.MUSHROOM_CAP, true);
      }
      set(Math.round(x + ox), cy + 1, Math.round(z + ox), B.MUSHROOM_CAP, true);
    } else if (type === 'palm') {
      // gebogen stam met een kroon van palmbladeren
      const th = 6 + Math.floor(size * 4);
      const lean = size > 0.5 ? 1 : -1;
      let px = x, pz = z;
      const path = [];
      for (let y = 0; y < th; y++) {
        if (y > 2 && y % 3 === 0) { if (Noise.hash2(x + y, z - y) < 0.6) px += lean; }
        set(px, baseY + y, pz, B.PALM_LOG, false);
        path.push([px, baseY + y, pz]);
      }
      const top = path[path.length - 1];
      const tx = top[0], tyv = top[1] + 1, tz = top[2];
      set(tx, tyv, tz, B.PALM_LEAVES, true);
      // kroon: bladeren die naar buiten en omlaag hangen
      for (let a = 0; a < 8; a++) {
        const ang = a / 8 * Math.PI * 2;
        const dxs = Math.cos(ang), dzs = Math.sin(ang);
        const len = 3 + Math.floor(Noise.hash2(x + a, z - a) * 2);
        for (let k = 1; k <= len; k++) {
          const bx = Math.round(tx + dxs * k);
          const bz = Math.round(tz + dzs * k);
          const by = tyv + (k <= 1 ? 1 : -(k - 1));   // eerst iets omhoog, dan afhangend
          set(bx, by, bz, B.PALM_LEAVES, true);
        }
      }
      // een paar kokosnoten
      if (Noise.hash2(x * 3, z * 3) < 0.5) set(tx + lean, tyv - 1, tz, B.PALM_LOG, true);
    } else { // pine — kegel
      const th = 8 + Math.floor(size * 5);
      for (let y = 0; y < th; y++) set(x, baseY + y, z, B.LOG, false);
      for (let layer = 0; layer < th - 1; layer++) {
        const y = baseY + 3 + layer;
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
      const snowLine = 92 + surfNoise * 9;
      const stoneLine = 58 + surfNoise * 12;
      if (h >= snowLine) { surf = B.SNOW; under = B.STONE; }
      else if (h >= snowLine - 10 && Noise.hash2(wx * 5 + 1, wz * 5 - 3) < (h - (snowLine - 10)) / 10) {
        surf = B.SNOW; under = B.STONE;    // rafelige sneeuwrand onder de lijn
      }
      else if (h >= stoneLine) { surf = B.STONE; under = B.STONE; }
      else if (h <= SEA + 1 + surfNoise * 1.5) { surf = B.SAND; under = B.SAND; }
      else if (rf > 0.25 && h <= SEA + 3) { surf = B.SAND; under = B.SAND; }

      // biome-oppervlak (alleen op begaanbaar grasland, niet op sneeuw/steen/strand)
      const biome = (surf === B.GRASS) ? W.biomeAt(wx, wz) : 'normal';
      if (biome === 'desert') { surf = B.SAND; under = B.SAND; }
      else if (biome === 'mushroom') { surf = B.MYCELIUM; }

      // wandelpaden door het landschap
      if (surf === B.GRASS) {
        const pn = Math.abs(Noise.fbm2(wx * 0.0045 + 77.7, wz * 0.0045 - 123.4, 2));
        if (pn < 0.012) {
          const slope = Math.abs(W.height(wx + 2, wz) - W.height(wx - 2, wz)) +
                        Math.abs(W.height(wx, wz + 2) - W.height(wx, wz - 2));
          if (slope < 4) surf = Noise.hash2(wx, wz) < 0.75 ? B.PATH : B.GRAVEL;
        }
      }
      // verbindingsweg tussen dorpen
      if ((surf === B.GRASS || surf === B.STONE) && W.onVillageRoad(wx, wz)) {
        surf = Noise.hash2(wx * 3 + 1, wz * 3 - 2) < 0.8 ? B.PATH : B.GRAVEL;
      }

      for (let y = 0; y <= h && y < CH; y++) {
        let id;
        if (y === h) id = surf;
        else if (y >= h - 3) id = under;
        else id = B.STONE;
        // grotten uithollen in het gesteente (kruisende tunnel-isovlakken)
        if (id === B.STONE && y > 5 && y < h - 4 && h > SEA + 1) {
          const c1 = Noise.noise3(wx * 0.055, y * 0.09 + 31.2, wz * 0.055);
          const c2 = Noise.noise3(wx * 0.055 - 70.5, y * 0.09 - 11.7, wz * 0.055 + 40.3);
          if (Math.abs(c1) < 0.075 && Math.abs(c2) < 0.10) id = B.AIR;
        }
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

    // 1b. gloeiende kristallen op de bodem van grotten (koel, decoratief licht)
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      for (let y = 7; y < SEA + 6 && y < CH - 2; y++) {
        if (blocks[idx(lx, y, lz)] !== B.AIR) continue;
        if (blocks[idx(lx, y - 1, lz)] !== B.STONE) continue;   // op een stenen vloer
        if (blocks[idx(lx, y + 1, lz)] !== B.AIR) continue;     // met ruimte erboven
        if (Noise.hash3(wx, y * 3 + 1, wz) < 0.02) blocks[idx(lx, y, lz)] = B.CRYSTAL;
      }
    }

    // 2. bomen (incl. rand van 3 blokken zodat kronen over chunkgrenzen doorlopen)
    for (let wz = z0 - 3; wz < z0 + CS + 3; wz++) for (let wx = x0 - 3; wx < x0 + CS + 3; wx++) {
      const tr = treeAt(wx, wz);
      if (tr) placeTree(tr, setLocal);
    }

    // 3. gras, bloemen, struiken en riet
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const h = W.height(wx, wz);
      if (h + 1 >= CH) continue;
      const surfId = blocks[idx(lx, h, lz)];
      if (blocks[idx(lx, h + 1, lz)] !== B.AIR) continue;

      // spoorrails op het hart van de dorpsweg
      if ((surfId === B.PATH || surfId === B.GRAVEL) && h > SEA) {
        const ri = W.roadInfo(wx, wz);
        if (ri && ri.dist < 0.75) {
          blocks[idx(lx, h + 1, lz)] = B.RAIL;
          continue;
        }
      }

      const bio = W.biomeAt(wx, wz);
      // woestijn: cactussen en dorre struiken op het zand
      if (surfId === B.SAND && bio === 'desert' && h > SEA + 1) {
        const rr = Noise.hash2(wx * 11 + 2, wz * 11 + 6);
        if (rr < 0.010) {
          const ch = 2 + ((Noise.hash2(wx * 3, wz * 5) * 2) | 0);
          for (let k = 0; k < ch && h + 1 + k < CH; k++) blocks[idx(lx, h + 1 + k, lz)] = B.CACTUS;
        } else if (rr < 0.03) blocks[idx(lx, h + 1, lz)] = B.DEAD_BUSH;
        continue;
      }
      // paddenstoelbiome: mycelium met kleine paddenstoelen
      if (surfId === B.MYCELIUM) {
        const rr = Noise.hash2(wx * 11 + 2, wz * 11 + 6);
        if (rr < 0.14) blocks[idx(lx, h + 1, lz)] = B.MUSHROOM;
        else if (rr < 0.17) blocks[idx(lx, h + 1, lz)] = B.DEAD_BUSH;
        continue;
      }

      // riet langs het water
      if (surfId === B.SAND && h >= SEA && h <= SEA + 2) {
        if (Noise.hash2(wx * 23 + 9, wz * 19 - 2) < 0.12) {
          blocks[idx(lx, h + 1, lz)] = B.TALLGRASS;
        }
        continue;
      }
      if (surfId !== B.GRASS) continue;

      // savanne: droog, spaarzaam gras met een enkele dorre struik
      if (bio === 'savanna') {
        const rr = Noise.hash2(wx * 11 + 2, wz * 11 + 6);
        if (rr < 0.28) blocks[idx(lx, h + 1, lz)] = B.TALLGRASS;
        else if (rr < 0.30) blocks[idx(lx, h + 1, lz)] = B.DEAD_BUSH;
        continue;
      }
      // moeras: paddenstoelen, riet en dorre struiken
      if (bio === 'swamp') {
        const rr = Noise.hash2(wx * 11 + 2, wz * 11 + 6);
        if (rr < 0.16) blocks[idx(lx, h + 1, lz)] = B.MUSHROOM;
        else if (rr < 0.42) blocks[idx(lx, h + 1, lz)] = B.TALLGRASS;
        else if (rr < 0.45) blocks[idx(lx, h + 1, lz)] = B.DEAD_BUSH;
        continue;
      }

      // lavendelvelden — zeldzame paarse biome-vlekken in het glooiende laagland
      const lav = Noise.fbm2(wx * 0.0032 + 220.4, wz * 0.0032 - 660.1, 3);
      if (lav > 0.36 && h > SEA + 2 && h < 58 && !W.onVillageRoad(wx, wz)) {
        const lr = Noise.hash2(wx * 11 + 2, wz * 11 + 6);
        if (lr < 0.62) blocks[idx(lx, h + 1, lz)] = B.LAVENDER;
        else if (lr < 0.72) blocks[idx(lx, h + 1, lz)] = B.TALLGRASS;
        continue;
      }

      const meadow = Noise.fbm2(wx * 0.012 + 55.5, wz * 0.012 - 88.8, 2);
      const forest = Noise.fbm2(wx * 0.004 + 900.2, wz * 0.004 + 41.9, 3);
      const roll = Noise.hash2(wx * 11 + 2, wz * 11 + 6);
      const grassP = 0.18 + Noise.smoothstep(-0.3, 0.6, meadow) * 0.52;   // dichter gras
      if (roll < grassP) {
        // varens in het bos, elders hoog gras
        blocks[idx(lx, h + 1, lz)] =
          (forest > 0.25 && Noise.hash2(wx * 7 - 3, wz * 7 + 1) < 0.35) ? B.FERN : B.TALLGRASS;
      } else if (roll < grassP + 0.03) {
        const fpatch = Noise.fbm2(wx * 0.02 + 400, wz * 0.02 + 300, 2);
        const fr = Noise.hash2(wx * 13 - 8, wz * 17 + 4);
        let fl = B.FLOWER_YELLOW;
        if (fpatch > 0.25) fl = B.FLOWER_RED;
        else if (fpatch < -0.25) fl = B.FLOWER_BLUE;
        else if (fr < 0.3) fl = B.FLOWER_WHITE;
        blocks[idx(lx, h + 1, lz)] = fl;
      } else if (forest > 0.2 && roll > grassP + 0.03 && roll < grassP + 0.05) {
        blocks[idx(lx, h + 1, lz)] = B.MUSHROOM;     // paddenstoel in het bos
      } else if (roll > 0.988 && h < 60) {
        // losse struik
        blocks[idx(lx, h + 1, lz)] = B.LEAVES;
      } else if (roll > 0.978 && roll < 0.984) {
        blocks[idx(lx, h + 1, lz)] = B.PEBBLES;      // steentjes
      }
    }

    // 3b. waterlelies op stil, ondiep meerwater
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const h = W.height(wx, wz);
      if (h >= SEA || SEA - h > 3) continue;                 // alleen ondiep
      if (riverFactor(wx, wz) > 0.15) continue;              // alleen stil water (meren)
      if (SEA + 1 >= CH) continue;
      if (blocks[idx(lx, SEA + 1, lz)] !== B.AIR) continue;
      if (Noise.hash2(wx * 5 + 3, wz * 5 - 7) < 0.06) blocks[idx(lx, SEA + 1, lz)] = B.LILYPAD;
    }

    // 3c. bergwatervallen: zeldzame hoge bronnen die over een klif naar beneden storten
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const h = W.height(wx, wz);
      if (h < SEA + 22 || h > CH - 12) continue;
      if (Noise.hash2(wx * 13 + 7, wz * 13 - 9) > 0.02) continue;   // zeldzaam
      const top = blocks[idx(lx, h, lz)];
      if (top !== B.STONE && top !== B.SNOW && top !== B.GRASS) continue;
      // steilste afdaling naar een buur binnen deze chunk zoeken
      let bestD = 0, bnx = 0, bnz = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nh = W.height(wx + dx, wz + dz);
        const d = h - nh;
        if (d > bestD) { bestD = d; bnx = dx; bnz = dz; }
      }
      if (bestD < 3) continue;      // een lichte richel volstaat voor een cascade
      const nlx = lx + bnx, nlz = lz + bnz;
      if (nlx < 0 || nlx >= CS || nlz < 0 || nlz >= CS) continue;    // val binnen de chunk
      const nh = W.height(wx + bnx, wz + bnz);
      // bronpoeltje bovenaan
      blocks[idx(lx, h, lz)] = B.WATER;
      blocks[idx(lx, h - 1, lz)] = B.WATER;
      // watergordijn in de buurkolom, van de top tot de voet
      for (let y = h; y > nh && y < CH && y >= 0; y--) {
        if (blocks[idx(nlx, y, nlz)] === B.AIR) blocks[idx(nlx, y, nlz)] = B.WATER;
      }
      // klein poeltje aan de voet + nevelpunt registreren
      if (nh + 1 < CH && blocks[idx(nlx, nh + 1, nlz)] === B.AIR) blocks[idx(nlx, nh + 1, nlz)] = B.WATER;
      W.waterfallBases.set((wx + bnx) + ',' + (wz + bnz), nh + 1);
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

    // 5. bezienswaardigheden (torens, ruïnes, standbeelden, bruggen)
    const lmR = 18;
    const lcMinX = Math.floor((x0 - lmR) / LANDMARK_CELL), lcMaxX = Math.floor((x0 + CS + lmR) / LANDMARK_CELL);
    const lcMinZ = Math.floor((z0 - lmR) / LANDMARK_CELL), lcMaxZ = Math.floor((z0 + CS + lmR) / LANDMARK_CELL);
    for (let lxc = lcMinX; lxc <= lcMaxX; lxc++) for (let lzc = lcMinZ; lzc <= lcMaxZ; lzc++) {
      const l = landmarkRaw(lxc, lzc);
      if (!l) continue;
      if (l.cx + lmR < x0 || l.cx - lmR > x0 + CS || l.cz + lmR < z0 || l.cz - lmR > z0 + CS) continue;
      const layout = landmarkLayout(l);
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
