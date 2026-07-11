// Procedureel gegenereerde pixel-art textures in Minecraft-stijl.
// Alles wordt in één atlas-canvas getekend; geen externe assets nodig.
window.Textures = (function () {
  const T = {};
  const TILE = 16;      // pixels per tegel
  const COLS = 8, ROWS = 8;
  const B = G.B;

  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext('2d');

  // ---- hulpjes -------------------------------------------------------------
  function px(tx, ty, x, y, r, g, b, a) {
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a === undefined ? 1 : a})`;
    ctx.fillRect(tx * TILE + x, ty * TILE + y, 1, 1);
  }
  function fillNoise(tx, ty, base, vary, rng) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const v = (rng() - 0.5) * 2 * vary;
      px(tx, ty, x, y, base[0] + v, base[1] + v, base[2] + v);
    }
  }
  function speckle(tx, ty, color, count, rng) {
    for (let i = 0; i < count; i++) {
      px(tx, ty, (rng() * TILE) | 0, (rng() * TILE) | 0, color[0], color[1], color[2], color[3] !== undefined ? color[3] : 1);
    }
  }
  function clearTile(tx, ty) {
    ctx.clearRect(tx * TILE, ty * TILE, TILE, TILE);
  }

  // ---- tegel-tekening --------------------------------------------------------
  const TI = T.TI = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
    PLANKS: 8, COBBLE: 9, SNOW: 10, PATH: 11, FARMLAND: 12, GRAVEL: 13, TORCH: 14, TALLGRASS: 15,
    FLOWER_RED: 16, FLOWER_YELLOW: 17, FLOWER_BLUE: 18, FLOWER_WHITE: 19, CROP: 20,
    BIRCH_SIDE: 21, BIRCH_TOP: 22, LEAVES_BIRCH: 23, LEAVES_PINE: 24, FLAME: 25, SNOW_SIDE: 26,
  };

  function draw() {
    const R = Noise.rng(20240711);

    // GRAS-TOP: bijna-wit groen zodat vertex-tint de kleur en variatie bepaalt
    fillNoise(TI.GRASS_TOP % COLS, (TI.GRASS_TOP / COLS) | 0, [178, 210, 130], 26, R);

    // GRAS-ZIJKANT: aarde met groene rand bovenaan
    {
      const tx = TI.GRASS_SIDE % COLS, ty = (TI.GRASS_SIDE / COLS) | 0;
      fillNoise(tx, ty, [134, 96, 67], 18, R);
      for (let x = 0; x < TILE; x++) {
        const depth = 2 + ((R() * 3) | 0);
        for (let y = 0; y < depth; y++) {
          const v = (R() - 0.5) * 30;
          px(tx, ty, x, y, 116 + v, 168 + v, 76 + v);
        }
      }
    }

    fillNoise(TI.DIRT % COLS, (TI.DIRT / COLS) | 0, [134, 96, 67], 20, R);
    speckle(TI.DIRT % COLS, (TI.DIRT / COLS) | 0, [98, 68, 45], 14, R);

    fillNoise(TI.STONE % COLS, (TI.STONE / COLS) | 0, [128, 128, 130], 14, R);
    speckle(TI.STONE % COLS, (TI.STONE / COLS) | 0, [104, 104, 108], 18, R);

    fillNoise(TI.SAND % COLS, (TI.SAND / COLS) | 0, [219, 206, 160], 13, R);
    speckle(TI.SAND % COLS, (TI.SAND / COLS) | 0, [199, 184, 136], 12, R);

    // LOG (eik): verticale schorslijnen
    {
      const tx = TI.LOG_SIDE % COLS, ty = (TI.LOG_SIDE / COLS) | 0;
      fillNoise(tx, ty, [104, 82, 50], 10, R);
      for (let x = 0; x < TILE; x += 2 + ((R() * 2) | 0)) {
        for (let y = 0; y < TILE; y++) {
          if (R() < 0.8) px(tx, ty, x, y, 78, 60, 36);
        }
      }
    }
    {
      const tx = TI.LOG_TOP % COLS, ty = (TI.LOG_TOP / COLS) | 0;
      fillNoise(tx, ty, [104, 82, 50], 8, R);
      ctx.fillStyle = 'rgb(178,148,98)';
      ctx.fillRect(tx * TILE + 3, ty * TILE + 3, 10, 10);
      ctx.strokeStyle = 'rgb(140,112,70)';
      ctx.strokeRect(tx * TILE + 5.5, ty * TILE + 5.5, 5, 5);
    }

    // BLADEREN (eik): neutraal groen + gaatjes (alphaTest)
    function leavesTile(idx, base, holes) {
      const tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        if (R() < holes) continue; // gaatje
        const v = (R() - 0.5) * 44;
        px(tx, ty, x, y, base[0] + v, base[1] + v, base[2] + v);
      }
    }
    leavesTile(TI.LEAVES, [96, 150, 66], 0.10);
    leavesTile(TI.LEAVES_BIRCH, [122, 168, 84], 0.13);
    leavesTile(TI.LEAVES_PINE, [64, 110, 74], 0.07);

    // PLANKEN
    {
      const tx = TI.PLANKS % COLS, ty = (TI.PLANKS / COLS) | 0;
      fillNoise(tx, ty, [176, 142, 88], 9, R);
      for (const y of [3, 7, 11, 15]) for (let x = 0; x < TILE; x++) px(tx, ty, x, y, 132, 104, 62);
      for (const [x, y] of [[4, 1], [12, 5], [2, 9], [10, 13]]) px(tx, ty, x, y, 120, 95, 56);
    }

    // KEIEN (cobblestone)
    {
      const tx = TI.COBBLE % COLS, ty = (TI.COBBLE / COLS) | 0;
      fillNoise(tx, ty, [116, 116, 118], 10, R);
      for (let i = 0; i < 7; i++) {
        const cx = R() * TILE, cy = R() * TILE, rr = 2 + R() * 3;
        const shade = 96 + R() * 52;
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
          const dx = Math.min(Math.abs(x - cx), TILE - Math.abs(x - cx));
          const dy = Math.min(Math.abs(y - cy), TILE - Math.abs(y - cy));
          if (dx * dx + dy * dy < rr * rr) px(tx, ty, x, y, shade + (R() - 0.5) * 14, shade + (R() - 0.5) * 14, shade + 2);
        }
      }
    }

    fillNoise(TI.SNOW % COLS, (TI.SNOW / COLS) | 0, [238, 242, 248], 7, R);

    // PAD: platgetreden aarde
    fillNoise(TI.PATH % COLS, (TI.PATH / COLS) | 0, [156, 132, 92], 14, R);
    speckle(TI.PATH % COLS, (TI.PATH / COLS) | 0, [128, 106, 70], 16, R);

    // AKKER (farmland): donkere natte aarde met voren
    {
      const tx = TI.FARMLAND % COLS, ty = (TI.FARMLAND / COLS) | 0;
      fillNoise(tx, ty, [96, 66, 44], 12, R);
      for (const y of [2, 6, 10, 14]) for (let x = 0; x < TILE; x++) px(tx, ty, x, y, 70, 46, 30);
    }

    fillNoise(TI.GRAVEL % COLS, (TI.GRAVEL / COLS) | 0, [138, 132, 126], 22, R);

    // FAKKEL: stokje met gloeiende kop (op transparante tegel)
    {
      const tx = TI.TORCH % COLS, ty = (TI.TORCH / COLS) | 0;
      clearTile(tx, ty);
      for (let y = 6; y < 16; y++) for (let x = 7; x < 9; x++) px(tx, ty, x, y, 110, 86, 52);
      for (let y = 3; y < 6; y++) for (let x = 7; x < 9; x++) px(tx, ty, x, y, 255, 200, 80);
      px(tx, ty, 7, 2, 255, 240, 160); px(tx, ty, 8, 2, 255, 240, 160);
    }

    // HOOG GRAS (neutraal, wordt getint)
    {
      const tx = TI.TALLGRASS % COLS, ty = (TI.TALLGRASS / COLS) | 0;
      clearTile(tx, ty);
      for (let i = 0; i < 9; i++) {
        const bx = 1 + ((R() * 14) | 0);
        const h = 6 + ((R() * 9) | 0);
        for (let y = 0; y < h; y++) {
          const sway = (y > h * 0.6 && R() < 0.4) ? (R() < 0.5 ? -1 : 1) : 0;
          const v = (R() - 0.5) * 40;
          px(tx, ty, Noise.clamp(bx + sway, 0, 15), 15 - y, 150 + v, 195 + v, 105 + v);
        }
      }
    }

    // BLOEMEN
    function flower(idx, petal, center) {
      const tx = idx % COLS, ty = (idx / COLS) | 0;
      clearTile(tx, ty);
      for (let y = 8; y < 16; y++) px(tx, ty, 7 + (y % 2 === 0 ? 0 : 1) * 0, y, 62, 122, 48);
      px(tx, ty, 6, 10, 62, 122, 48); px(tx, ty, 9, 12, 70, 132, 52);
      const cx = 7, cy = 5;
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        px(tx, ty, cx + dx, cy + dy, petal[0], petal[1], petal[2]);
        if (R() < 0.6) px(tx, ty, cx + dx + (R() < 0.5 ? 1 : 0), cy + dy, petal[0] * 0.9, petal[1] * 0.9, petal[2] * 0.9);
      }
      px(tx, ty, cx, cy, center[0], center[1], center[2]);
      px(tx, ty, cx + 1, cy, center[0], center[1], center[2]);
    }
    flower(TI.FLOWER_RED, [216, 62, 62], [250, 220, 110]);
    flower(TI.FLOWER_YELLOW, [242, 208, 70], [190, 150, 40]);
    flower(TI.FLOWER_BLUE, [110, 140, 235], [240, 240, 250]);
    flower(TI.FLOWER_WHITE, [240, 240, 244], [250, 220, 110]);

    // GEWAS (tarwe)
    {
      const tx = TI.CROP % COLS, ty = (TI.CROP / COLS) | 0;
      clearTile(tx, ty);
      for (let i = 0; i < 6; i++) {
        const bx = 1 + i * 2 + ((R() * 2) | 0);
        const h = 9 + ((R() * 6) | 0);
        for (let y = 0; y < h; y++) {
          const v = (R() - 0.5) * 26;
          const ripe = y > h - 4;
          px(tx, ty, Noise.clamp(bx, 0, 15), 15 - y,
            ripe ? 212 + v : 128 + v, ripe ? 188 + v : 178 + v, ripe ? 96 + v : 84 + v);
        }
      }
    }

    // BERK
    {
      const tx = TI.BIRCH_SIDE % COLS, ty = (TI.BIRCH_SIDE / COLS) | 0;
      fillNoise(tx, ty, [222, 220, 210], 10, R);
      for (let i = 0; i < 9; i++) {
        const x = (R() * TILE) | 0, y = (R() * TILE) | 0, w = 1 + ((R() * 3) | 0);
        for (let k = 0; k < w; k++) px(tx, ty, Math.min(15, x + k), y, 40, 40, 38);
      }
    }
    {
      const tx = TI.BIRCH_TOP % COLS, ty = (TI.BIRCH_TOP / COLS) | 0;
      fillNoise(tx, ty, [222, 220, 210], 8, R);
      ctx.fillStyle = 'rgb(196,178,128)';
      ctx.fillRect(tx * TILE + 3, ty * TILE + 3, 10, 10);
    }

    // VLAM (voor fakkels, additief)
    {
      const tx = TI.FLAME % COLS, ty = (TI.FLAME / COLS) | 0;
      clearTile(tx, ty);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const dx = (x - 7.5) / 5, dy = (y - 9) / 7;
        const d = dx * dx + dy * dy * 1.4;
        if (d < 1) {
          const a = (1 - d) * (0.65 + R() * 0.35);
          const hot = 1 - Math.min(1, d * 1.6);
          px(tx, ty, x, y, 255, 150 + hot * 100, 40 + hot * 140, a);
        }
      }
    }

    // BESNEEUWD GRAS-ZIJKANT
    {
      const tx = TI.SNOW_SIDE % COLS, ty = (TI.SNOW_SIDE / COLS) | 0;
      fillNoise(tx, ty, [134, 96, 67], 16, R);
      for (let x = 0; x < TILE; x++) {
        const depth = 3 + ((R() * 3) | 0);
        for (let y = 0; y < depth; y++) px(tx, ty, x, y, 236 + (R() - 0.5) * 10, 240, 246);
      }
    }
  }
  draw();

  // ---- three.js texture -------------------------------------------------------
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace && (texture.colorSpace = THREE.SRGBColorSpace);
  if (!texture.colorSpace) texture.encoding = THREE.sRGBEncoding;

  T.canvas = canvas;
  T.texture = texture;
  T.TILE = TILE; T.COLS = COLS; T.ROWS = ROWS;

  // UV-rechthoek voor een tegel, met halve pixel inzet tegen bleeding
  T.uv = function (tile) {
    const tx = tile % COLS, ty = (tile / COLS) | 0;
    const eps = 0.02 / COLS;
    return [
      tx / COLS + eps, 1 - (ty + 1) / ROWS + eps,
      (tx + 1) / COLS - eps, 1 - ty / ROWS - eps,
    ];
  };

  // Welke tegel hoort bij welk blokvlak?  face: 0 +x 1 -x 2 +y 3 -y 4 +z 5 -z
  T.texFor = function (block, face) {
    const B = G.B, TI2 = TI;
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

  // Tekent een tegel op een klein canvas (voor hotbar-iconen)
  T.drawIcon = function (targetCanvas, block) {
    const c = targetCanvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    const tile = T.texFor(block, block === G.B.TORCH || G.isCross(block) ? 0 : 2);
    const tx = tile % COLS, ty = (tile / COLS) | 0;
    c.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    c.drawImage(canvas, tx * TILE, ty * TILE, TILE, TILE, 0, 0, targetCanvas.width, targetCanvas.height);
    // Grastegel groen tinten in het icoon
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
