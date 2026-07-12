// Procedureel gegenereerde textures in Minecraft-stijl, op 32×32 per tegel met
// organische, meerlagige detaillering (gladde ruis + fijne korrel + kenmerken).
// Geen externe assets nodig; alles wordt in één atlas-canvas getekend.
window.Textures = (function () {
  const T = {};
  const TILE = 32;      // pixels per tegel (hoge kwaliteit)
  const COLS = 8, ROWS = 8;
  const B = G.B;

  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext('2d');

  const R = Noise.rng(20240711);

  // ---- hulpjes -------------------------------------------------------------
  function px(tx, ty, x, y, r, g, b, a) {
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a === undefined ? 1 : a})`;
    ctx.fillRect(tx * TILE + x, ty * TILE + y, 1, 1);
  }
  function clearTile(tx, ty) { ctx.clearRect(tx * TILE, ty * TILE, TILE, TILE); }

  // gladde value-noise in tegel-ruimte, 0..1
  function vn(tx, ty, x, y, scale, off) {
    return (Noise.noise2((tx * TILE + x) * scale + tx * 31.7 + (off || 0),
                         (ty * TILE + y) * scale + ty * 17.3 - (off || 0)) + 1) * 0.5;
  }

  // Rijk oppervlak: macro-patches + micro-variatie + fijne korrel → natuurlijke look
  function fill(idx, base, o) {
    o = o || {};
    const tx = idx % COLS, ty = (idx / COLS) | 0;
    const macroS = o.macroS || 0.10, microS = o.microS || 0.34;
    const macroA = o.macro === undefined ? 0.14 : o.macro;
    const microA = o.micro === undefined ? 0.07 : o.micro;
    const grainA = o.grain === undefined ? 0.05 : o.grain;
    const warm = o.warm || 0;   // lichte kleurzweem in schaduw/licht
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const m = (vn(tx, ty, x, y, macroS) - 0.5) * 2 * macroA;
      const mi = (vn(tx, ty, x, y, microS, 50) - 0.5) * 2 * microA;
      const g = (R() - 0.5) * 2 * grainA;
      const l = 1 + m + mi + g;
      px(tx, ty, x, y, base[0] * l + m * warm * 40, base[1] * l, base[2] * l - m * warm * 30);
    }
  }
  function speckle(idx, color, count) {
    const tx = idx % COLS, ty = (idx / COLS) | 0;
    for (let i = 0; i < count; i++) {
      px(tx, ty, (R() * TILE) | 0, (R() * TILE) | 0, color[0], color[1], color[2],
         color[3] !== undefined ? color[3] : 1);
    }
  }

  const TI = T.TI = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
    PLANKS: 8, COBBLE: 9, SNOW: 10, PATH: 11, FARMLAND: 12, GRAVEL: 13, TORCH: 14, TALLGRASS: 15,
    FLOWER_RED: 16, FLOWER_YELLOW: 17, FLOWER_BLUE: 18, FLOWER_WHITE: 19, CROP: 20,
    BIRCH_SIDE: 21, BIRCH_TOP: 22, LEAVES_BIRCH: 23, LEAVES_PINE: 24, FLAME: 25, SNOW_SIDE: 26,
    STONE_BRICK: 27, STONE_BRICK_MOSSY: 28, GLASS: 29, DOOR: 30, EMBER: 31,
  };

  function draw() {
    // GRAS-TOP: neutraal-licht groen (vertex-tint bepaalt de kleur), met graspolletjes
    fill(TI.GRASS_TOP, [176, 205, 128], { macroS: 0.09, macro: 0.10, micro: 0.10, grain: 0.06 });
    {
      const tx = TI.GRASS_TOP % COLS, ty = (TI.GRASS_TOP / COLS) | 0;
      for (let i = 0; i < 60; i++) {
        const x = (R() * TILE) | 0, y = (R() * TILE) | 0;
        const v = R() < 0.5 ? 24 : -22;
        px(tx, ty, x, y, 176 + v, 205 + v, 128 + v * 0.6);
      }
    }

    // GRAS-ZIJKANT: aarde met golvende groene overhang
    {
      const idx = TI.GRASS_SIDE, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [132, 94, 64], { macroS: 0.11, macro: 0.16, grain: 0.06, warm: 0.4 });
      for (let x = 0; x < TILE; x++) {
        const depth = 4 + Math.round(vn(tx, ty, x, 0, 0.2) * 6);
        for (let y = 0; y < depth; y++) {
          const edge = y >= depth - 2;
          const v = (R() - 0.5) * 34;
          px(tx, ty, x, y, (edge ? 96 : 112) + v, (edge ? 150 : 172) + v, (edge ? 60 : 78) + v * 0.6);
        }
        // hangende sprietjes
        if (R() < 0.25) { const v = (R() - 0.5) * 30; px(tx, ty, x, depth, 108 + v, 166 + v, 72); }
      }
    }

    // AARDE
    fill(TI.DIRT, [134, 96, 66], { macroS: 0.12, macro: 0.14, grain: 0.07, warm: 0.5 });
    speckle(TI.DIRT, [98, 68, 44], 60);
    speckle(TI.DIRT, [160, 120, 82, 0.6], 30);

    // STEEN: warme zandsteen met scheurtjes en lagen
    fill(TI.STONE, [143, 133, 118], { macroS: 0.08, macro: 0.13, micro: 0.06, grain: 0.05, warm: 0.6 });
    {
      const tx = TI.STONE % COLS, ty = (TI.STONE / COLS) | 0;
      // horizontale sedimentlagen
      for (let y = 0; y < TILE; y++) {
        if (vn(tx, ty, 0, y, 0.5, 9) > 0.72) for (let x = 0; x < TILE; x++)
          px(tx, ty, x, y, 120, 111, 96, 0.5);
      }
      // scheuren
      for (let i = 0; i < 3; i++) {
        let cx = (R() * TILE) | 0, cy = (R() * TILE) | 0;
        for (let s = 0; s < 10; s++) {
          px(tx, ty, cx, cy, 96, 88, 76);
          cx += (R() * 3 - 1) | 0; cy += (R() < 0.5 ? 1 : 0) + ((R() * 2 - 1) | 0);
          if (cx < 0 || cx >= TILE || cy < 0 || cy >= TILE) break;
        }
      }
    }

    // ZAND: fijne korrel met lichte rimpels
    fill(TI.SAND, [222, 208, 162], { macroS: 0.14, macro: 0.08, micro: 0.05, grain: 0.05 });
    {
      const tx = TI.SAND % COLS, ty = (TI.SAND / COLS) | 0;
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++)
        if (vn(tx, ty, x, y, 0.6, 3) > 0.66) px(tx, ty, x, y, 204, 189, 142, 0.5);
    }

    // EIKENSTAM: verticale schorsgroeven + mos
    {
      const idx = TI.LOG_SIDE, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [110, 84, 52], { macroS: 0.12, macro: 0.10, grain: 0.05, warm: 0.4 });
      for (let x = 0; x < TILE; x++) {
        const groove = vn(tx, ty, x, 0, 0.35, 12);
        if (groove > 0.62) for (let y = 0; y < TILE; y++) {
          const v = (R() - 0.5) * 12;
          px(tx, ty, x, y, 78 + v, 58 + v, 34 + v);
        }
      }
      for (let i = 0; i < 10; i++) px(tx, ty, (R() * TILE) | 0, (R() * TILE) | 0, 96, 118, 62, 0.5);
    }
    {
      const idx = TI.LOG_TOP, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [120, 92, 56], { macro: 0.06, grain: 0.04 });
      // jaarringen
      for (let ring = 3; ring < 15; ring += 3) {
        for (let a = 0; a < 64; a++) {
          const th = a / 64 * Math.PI * 2;
          const x = (TILE / 2 + Math.cos(th) * ring) | 0;
          const y = (TILE / 2 + Math.sin(th) * ring) | 0;
          px(tx, ty, x, y, 158, 128, 82, 0.7);
        }
      }
    }

    // BLADEREN: geclusterde blaadjes met dieptelaag en gaatjes
    function leavesTile(idx, base, holes) {
      const tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const cluster = vn(tx, ty, x, y, 0.28, 20);
        if (cluster < holes) continue;
        const depth = vn(tx, ty, x, y, 0.5, 40);
        const shade = 0.72 + depth * 0.5;
        const v = (R() - 0.5) * 30;
        px(tx, ty, x, y, base[0] * shade + v, base[1] * shade + v, base[2] * shade + v * 0.6);
      }
      // enkele highlight-blaadjes
      for (let i = 0; i < 20; i++) px(tx, ty, (R() * TILE) | 0, (R() * TILE) | 0,
        base[0] * 1.25, base[1] * 1.2, base[2] * 1.1, 0.7);
    }
    leavesTile(TI.LEAVES, [92, 146, 62], 0.30);
    leavesTile(TI.LEAVES_BIRCH, [120, 166, 82], 0.33);
    leavesTile(TI.LEAVES_PINE, [58, 106, 70], 0.24);

    // PLANKEN: houtnerf met naden en knoesten
    {
      const idx = TI.PLANKS, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [180, 145, 90], { macroS: 0.1, macro: 0.06, grain: 0.04, warm: 0.4 });
      // nerflijnen
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const grain = vn(tx, ty, x * 0.4, y, 0.5, 5);
        if (grain > 0.7) px(tx, ty, x, y, 150, 118, 70, 0.4);
      }
      // plankscheiding elke 8px
      for (const y of [0, 8, 16, 24]) for (let x = 0; x < TILE; x++) px(tx, ty, x, y, 120, 92, 54);
      // knoesten
      for (const [kx, ky] of [[6, 4], [22, 12], [12, 20], [26, 28]]) {
        for (let a = 0; a < 20; a++) {
          const th = a / 20 * 6.28;
          px(tx, ty, (kx + Math.cos(th) * 2) | 0, (ky + Math.sin(th) * 2) | 0, 118, 90, 52, 0.7);
        }
      }
      // verticale voegen versprongen
      for (let x = 0; x < TILE; x += 16) for (let y = 0; y < TILE; y++)
        px(tx, ty, x + ((((y / 8) | 0) % 2) * 8), y, 128, 100, 60, 0.6);
    }

    // KEIEN: ronde stenen met donkere voegen
    {
      const idx = TI.COBBLE, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [122, 120, 122], { macro: 0.06, grain: 0.05 });
      // voegen als donker net
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(tx, ty, x, y, 78, 76, 78);
      for (let i = 0; i < 12; i++) {
        const cx = R() * TILE, cy = R() * TILE, rr = 3 + R() * 4.5;
        const shade = 108 + R() * 46;
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
          const dx = x - cx, dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < rr) {
            const lit = 1 - d / rr * 0.5 + (dy < 0 ? 0.15 : -0.1);
            const v = (R() - 0.5) * 12;
            px(tx, ty, x, y, shade * lit + v, shade * lit + v, (shade + 3) * lit + v);
          }
        }
      }
    }

    // SNEEUW: subtiele glinstering
    fill(TI.SNOW, [240, 244, 250], { macro: 0.04, micro: 0.03, grain: 0.03 });
    speckle(TI.SNOW, [255, 255, 255], 24);
    speckle(TI.SNOW, [210, 222, 238, 0.5], 20);

    // PAD: platgetreden aarde met kiezels
    fill(TI.PATH, [158, 134, 94], { macroS: 0.13, macro: 0.13, grain: 0.06, warm: 0.4 });
    speckle(TI.PATH, [128, 106, 70], 50);
    speckle(TI.PATH, [178, 158, 120, 0.6], 24);

    // AKKER: donkere natte aarde met voren
    {
      const idx = TI.FARMLAND, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [98, 68, 44], { macro: 0.1, grain: 0.06, warm: 0.5 });
      for (const y of [4, 12, 20, 28]) for (let x = 0; x < TILE; x++) {
        px(tx, ty, x, y, 68, 44, 28); px(tx, ty, x, y + 1, 120, 88, 58, 0.6);
      }
    }

    // GRIND
    {
      const idx = TI.GRAVEL, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [140, 134, 126], { macro: 0.18, grain: 0.1 });
      for (let i = 0; i < 40; i++) {
        const cx = R() * TILE, cy = R() * TILE, rr = 1.5 + R() * 2.5;
        const sh = 110 + R() * 60;
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 < rr * rr) px(tx, ty, x, y, sh, sh - 4, sh - 10);
      }
    }

    // FAKKEL: stok met gloeiende kop (transparant)
    {
      const idx = TI.TORCH, tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      for (let y = 12; y < 32; y++) for (let x = 14; x < 18; x++) {
        const v = (R() - 0.5) * 16;
        px(tx, ty, x, y, 112 + v, 88 + v, 52 + v);
      }
      for (let y = 6; y < 12; y++) for (let x = 13; x < 19; x++) px(tx, ty, x, y, 255, 200, 80);
      for (let x = 14; x < 18; x++) { px(tx, ty, x, 4, 255, 240, 170); px(tx, ty, x, 5, 255, 224, 130); }
    }

    // HOOG GRAS (getint): meerdere sprieten met buiging
    {
      const idx = TI.TALLGRASS, tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      for (let i = 0; i < 16; i++) {
        let bx = 2 + ((R() * 28) | 0);
        const h = 14 + ((R() * 16) | 0);
        for (let y = 0; y < h; y++) {
          if (y > h * 0.5 && R() < 0.35) bx += (R() < 0.5 ? -1 : 1);
          const v = (R() - 0.5) * 40;
          const tip = y > h - 3;
          px(tx, ty, Noise.clamp(bx, 0, 31), 31 - y, (tip ? 176 : 150) + v, (tip ? 205 : 192) + v, 100 + v);
        }
      }
    }

    // BLOEMEN
    function flower(idx, petal, center) {
      const tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      // steel + blaadje
      for (let y = 16; y < 32; y++) { const v = (R() - 0.5) * 20; px(tx, ty, 15 + (y % 3 === 0 ? 1 : 0), y, 58 + v, 118 + v, 46 + v); }
      px(tx, ty, 13, 21, 62, 122, 48); px(tx, ty, 12, 22, 62, 122, 48);
      px(tx, ty, 18, 24, 70, 132, 52);
      const cx = 15, cy = 10;
      for (let a = 0; a < 8; a++) {
        const th = a / 8 * 6.28;
        for (let r = 2; r <= 5; r++) {
          const x = (cx + Math.cos(th) * r) | 0, y = (cy + Math.sin(th) * r) | 0;
          const v = (R() - 0.5) * 24;
          px(tx, ty, x, y, petal[0] + v, petal[1] + v, petal[2] + v);
        }
      }
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++)
        px(tx, ty, x, y, center[0], center[1], center[2]);
    }
    flower(TI.FLOWER_RED, [214, 60, 60], [250, 220, 110]);
    flower(TI.FLOWER_YELLOW, [242, 206, 68], [188, 148, 40]);
    flower(TI.FLOWER_BLUE, [108, 138, 234], [240, 240, 250]);
    flower(TI.FLOWER_WHITE, [242, 242, 246], [250, 220, 110]);

    // GEWAS (tarwe): rijpe aren
    {
      const idx = TI.CROP, tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      for (let i = 0; i < 8; i++) {
        const bx = 2 + i * 4 + ((R() * 2) | 0);
        const h = 20 + ((R() * 10) | 0);
        for (let y = 0; y < h; y++) {
          const v = (R() - 0.5) * 22;
          const ripe = y > h - 8;
          px(tx, ty, Noise.clamp(bx, 0, 31), 31 - y, (ripe ? 214 : 132) + v, (ripe ? 190 : 178) + v, (ripe ? 96 : 88) + v);
          if (ripe && R() < 0.4) px(tx, ty, Noise.clamp(bx + (R() < 0.5 ? -1 : 1), 0, 31), 31 - y, 224, 198, 104);
        }
      }
    }

    // BERK
    {
      const idx = TI.BIRCH_SIDE, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [224, 222, 212], { macro: 0.05, grain: 0.04 });
      for (let i = 0; i < 16; i++) {
        const x = (R() * TILE) | 0, y = (R() * TILE) | 0, w = 2 + ((R() * 5) | 0);
        for (let k = 0; k < w; k++) px(tx, ty, Math.min(31, x + k), y, 44, 42, 40);
        px(tx, ty, x, y + 1, 44, 42, 40, 0.5);
      }
    }
    {
      const idx = TI.BIRCH_TOP, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [224, 222, 212], { macro: 0.04 });
      for (let ring = 3; ring < 14; ring += 3) for (let a = 0; a < 64; a++) {
        const th = a / 64 * 6.28;
        px(tx, ty, (16 + Math.cos(th) * ring) | 0, (16 + Math.sin(th) * ring) | 0, 196, 178, 128, 0.7);
      }
    }

    // VLAM (additief)
    {
      const idx = TI.FLAME, tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const dx = (x - 15.5) / 9, dy = (y - 18) / 14;
        const d = dx * dx + dy * dy * 1.4;
        if (d < 1) {
          const a = (1 - d) * (0.6 + R() * 0.4);
          const hot = 1 - Math.min(1, d * 1.6);
          px(tx, ty, x, y, 255, 150 + hot * 100, 40 + hot * 150, a);
        }
      }
    }

    // BESNEEUWD GRAS-ZIJKANT
    {
      const idx = TI.SNOW_SIDE, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [134, 96, 66], { macro: 0.14, grain: 0.06, warm: 0.4 });
      for (let x = 0; x < TILE; x++) {
        const depth = 6 + Math.round(vn(tx, ty, x, 0, 0.2) * 6);
        for (let y = 0; y < depth; y++) px(tx, ty, x, y, 236 + (R() - 0.5) * 12, 240, 248);
      }
    }

    // KASTEEL-BAKSTENEN: nette rechthoekige blokken met verzonken voegen
    function stoneBricks(idx, base, mossy) {
      const tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, base, { macroS: 0.09, macro: 0.08, micro: 0.05, grain: 0.05 });
      const mortar = [base[0] * 0.6, base[1] * 0.6, base[2] * 0.62];
      const hi = [base[0] * 1.14, base[1] * 1.14, base[2] * 1.14];
      const rowH = 8;
      for (let ry = 0; ry < TILE; ry += rowH) {
        const offset = (((ry / rowH) | 0) % 2) * 8;   // halfsteens verband
        // horizontale voeg
        for (let x = 0; x < TILE; x++) { px(tx, ty, x, ry, mortar[0], mortar[1], mortar[2]); px(tx, ty, x, ry + 1, mortar[0] * 1.1, mortar[1] * 1.1, mortar[2] * 1.1, 0.6); }
        // verticale voegen
        for (let vx = offset; vx <= TILE; vx += 16) {
          const xx = ((vx) % TILE);
          for (let y = ry; y < ry + rowH && y < TILE; y++) px(tx, ty, xx, y, mortar[0], mortar[1], mortar[2]);
        }
        // lichtrandje bovenaan elke steen
        for (let x = 0; x < TILE; x++) if (R() < 0.5) px(tx, ty, x, ry + 2, hi[0], hi[1], hi[2], 0.4);
      }
      if (mossy) {
        for (let i = 0; i < 5; i++) {
          const cx = R() * TILE, cy = R() * TILE, rr = 2 + R() * 4;
          for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 < rr * rr && R() < 0.7) {
              const v = (R() - 0.5) * 26;
              px(tx, ty, x, y, 72 + v, 104 + v, 54 + v, 0.85);
            }
          }
        }
        // cracks
        for (let i = 0; i < 2; i++) {
          let cx = (R() * TILE) | 0, cy = (R() * TILE) | 0;
          for (let s = 0; s < 8; s++) { px(tx, ty, cx, cy, mortar[0] * 0.7, mortar[1] * 0.7, mortar[2] * 0.7); cx += (R() * 3 - 1) | 0; cy += 1; if (cy >= TILE) break; }
        }
      }
    }
    stoneBricks(TI.STONE_BRICK, [148, 148, 150], false);
    stoneBricks(TI.STONE_BRICK_MOSSY, [138, 140, 136], true);

    // GLAS: doorzichtig met omlijsting en een glansstreep
    {
      const idx = TI.GLASS, tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      // interieur licht doorzichtig
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++)
        px(tx, ty, x, y, 205, 225, 236, 0.16);
      // rand
      for (let i = 0; i < TILE; i++) {
        for (const [x, y] of [[i, 0], [i, 1], [i, TILE - 1], [i, TILE - 2], [0, i], [1, i], [TILE - 1, i], [TILE - 2, i]])
          px(tx, ty, x, y, 214, 232, 240, 0.72);
      }
      // diagonale glansstreep
      for (let i = 4; i < TILE - 4; i++) {
        px(tx, ty, i, i - 2, 255, 255, 255, 0.5);
        px(tx, ty, i, i - 1, 255, 255, 255, 0.35);
      }
    }

    // DEUR: houten paneeldeur met beslag en klink
    {
      const idx = TI.DOOR, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [150, 112, 62], { macroS: 0.1, macro: 0.06, grain: 0.04, warm: 0.4 });
      // verticale nerf
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++)
        if (vn(tx, ty, x * 0.5, y, 0.5, 7) > 0.72) px(tx, ty, x, y, 124, 92, 50, 0.5);
      // paneelranden (twee panelen)
      function panel(x0, y0, x1, y1) {
        for (let x = x0; x <= x1; x++) { px(tx, ty, x, y0, 108, 80, 44); px(tx, ty, x, y1, 108, 80, 44); }
        for (let y = y0; y <= y1; y++) { px(tx, ty, x0, y, 108, 80, 44); px(tx, ty, x1, y, 108, 80, 44); }
      }
      panel(4, 3, 27, 13); panel(4, 17, 27, 29);
      // ijzerbeslag
      for (const by of [4, 27]) for (let x = 2; x < 30; x++) if (x % 2 === 0) px(tx, ty, x, by, 70, 66, 64);
      // klink
      for (let y = 15; y < 18; y++) for (let x = 24; x < 28; x++) px(tx, ty, x, y, 60, 56, 52);
      px(tx, ty, 26, 16, 210, 200, 150);
    }

    // GLOEIENDE SINTELS (voor kampvuur-bodem)
    {
      const idx = TI.EMBER, tx = idx % COLS, ty = (idx / COLS) | 0;
      fill(idx, [40, 34, 30], { macro: 0.2, grain: 0.1 });
      for (let i = 0; i < 60; i++) {
        const x = (R() * TILE) | 0, y = (R() * TILE) | 0;
        const hot = R();
        px(tx, ty, x, y, 255, 90 + hot * 120, 20 + hot * 40, 0.6 + hot * 0.4);
      }
    }
  }
  draw();

  // ---- three.js texture -------------------------------------------------------
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  else texture.encoding = THREE.sRGBEncoding;

  T.canvas = canvas;
  T.texture = texture;
  T.TILE = TILE; T.COLS = COLS; T.ROWS = ROWS;

  // UV-rechthoek voor een tegel, met kleine inzet tegen bleeding
  T.uv = function (tile) {
    const tx = tile % COLS, ty = (tile / COLS) | 0;
    const eps = 0.5 / (COLS * TILE);
    return [
      tx / COLS + eps, 1 - (ty + 1) / ROWS + eps,
      (tx + 1) / COLS - eps, 1 - ty / ROWS - eps,
    ];
  };

  // face: 0 +x 1 -x 2 +y 3 -y 4 +z 5 -z
  T.texFor = function (block, face) {
    const TI2 = TI;
    switch (block) {
      case B.GRASS: return face === 2 ? TI2.GRASS_TOP : (face === 3 ? TI2.DIRT : TI2.GRASS_SIDE);
      case B.DIRT: return TI2.DIRT;
      case B.STONE: return TI2.STONE;
      case B.SAND: return TI2.SAND;
      case B.LOG: return (face === 2 || face === 3) ? TI2.LOG_TOP : TI2.LOG_SIDE;
      case B.LOG_BIRCH: return (face === 2 || face === 3) ? TI2.BIRCH_TOP : TI2.BIRCH_SIDE;
      case B.LEAVES: return TI2.LEAVES;
      case B.LEAVES_BIRCH: return TI2.LEAVES_BIRCH;
      case B.LEAVES_PINE: return TI2.LEAVES_PINE;
      case B.PLANKS: case B.FENCE: return TI2.PLANKS;
      case B.COBBLE: return TI2.COBBLE;
      case B.STONE_BRICK: return TI2.STONE_BRICK;
      case B.STONE_BRICK_MOSSY: return TI2.STONE_BRICK_MOSSY;
      case B.GLASS: return TI2.GLASS;
      case B.STAIRS: return TI2.STONE_BRICK;
      case B.SLAB: return TI2.PLANKS;
      case B.DOOR: return TI2.DOOR;
      case B.CAMPFIRE: return TI2.LOG_SIDE;
      case B.SNOW: return face === 2 ? TI2.SNOW : (face === 3 ? TI2.DIRT : TI2.SNOW_SIDE);
      case B.PATH: return face === 2 ? TI2.PATH : (face === 3 ? TI2.DIRT : TI2.PATH);
      case B.FARMLAND: return face === 2 ? TI2.FARMLAND : TI2.DIRT;
      case B.GRAVEL: return TI2.GRAVEL;
      case B.TORCH: return TI2.TORCH;
      case B.TALLGRASS: return TI2.TALLGRASS;
      case B.FLOWER_RED: return TI2.FLOWER_RED;
      case B.FLOWER_YELLOW: return TI2.FLOWER_YELLOW;
      case B.FLOWER_BLUE: return TI2.FLOWER_BLUE;
      case B.FLOWER_WHITE: return TI2.FLOWER_WHITE;
      case B.CROP: return TI2.CROP;
      default: return TI2.STONE;
    }
  };

  T.drawIcon = function (targetCanvas, block) {
    const c = targetCanvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    const tile = T.texFor(block, block === G.B.TORCH || G.isCross(block) ? 0 : 2);
    const tx = tile % COLS, ty = (tile / COLS) | 0;
    c.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    c.drawImage(canvas, tx * TILE, ty * TILE, TILE, TILE, 0, 0, targetCanvas.width, targetCanvas.height);
    if (block === G.B.GRASS || block === G.B.TALLGRASS) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = 'rgb(120,190,90)';
      c.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(canvas, tx * TILE, ty * TILE, TILE, TILE, 0, 0, targetCanvas.width, targetCanvas.height);
      c.globalCompositeOperation = 'source-over';
    }
  };

  return T;
})();
