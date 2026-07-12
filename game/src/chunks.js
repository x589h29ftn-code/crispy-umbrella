// Chunkbeheer: opslag, meshing (met per-vertex ambient occlusion en kleurtinten),
// waterrendering met eigen shader, en streaming van een oneindige wereld.
window.Chunks = (function () {
  const C = {};
  const B = G.B, CS = G.CS, CH = G.CH, SEA = G.SEA;
  const chunks = new Map();          // "cx,cz" -> chunk
  C.map = chunks;

  let scene = null;
  let genQueue = [];                 // te genereren chunkcoords
  let meshQueue = [];                // te (her)meshen chunks
  let lastCenter = null;

  const ck = (cx, cz) => cx + ',' + cz;
  const lidx = (x, y, z) => x + z * CS + y * CS * CS;

  // ---- materialen ------------------------------------------------------------------
  const sway = { value: 0 };         // gedeelde tijd-uniform voor wind
  C.timeUniform = sway;

  // Gedeelde belichtings-uniforms voor doorschijnend (backlit) blad en gras
  const uSunDir = { value: new THREE.Vector3(0, 1, 0) };
  const uSunColor = { value: new THREE.Color(1, 1, 1) };
  C.foliageUniforms = { uSunDir, uSunColor };

  // Injecteert doorschijnende backlight: blad/gras licht op als de zon erachter staat
  function injectBacklight(shader, strength, useAttr) {
    shader.uniforms.uSunDir = uSunDir;
    shader.uniforms.uSunColor = uSunColor;
    const decl = 'uniform vec3 uSunDir; uniform vec3 uSunColor; varying vec3 vBacklight;\n' +
      (useAttr ? 'attribute float aTrans;\n' : '');
    shader.vertexShader = decl + shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      {
        vec3 Vv = normalize(-mvPosition.xyz);
        vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float trans = pow(max(dot(Vv, Lv), 0.0), 3.0);
        float amt = ${useAttr ? 'aTrans' : '1.0'};
        vBacklight = uSunColor * trans * amt * ${strength.toFixed(2)};
      }`);
    shader.fragmentShader = 'varying vec3 vBacklight;\n' + shader.fragmentShader
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb += vBacklight;\n#include <tonemapping_fragment>');
  }

  const opaqueMat = new THREE.MeshStandardMaterial({
    map: Textures.texture, vertexColors: true, alphaTest: 0.5,
    roughness: 0.95, metalness: 0.0,
  });
  opaqueMat.onBeforeCompile = (shader) => injectBacklight(shader, 0.55, true);

  const foliageMat = new THREE.MeshStandardMaterial({
    map: Textures.texture, vertexColors: true, alphaTest: 0.4,
    roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
  });
  foliageMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sway;
    shader.vertexShader = 'uniform float uTime;\nattribute float aSway;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float windA = sin(uTime * 1.7 + position.x * 0.35 + position.z * 0.45);
        float windB = sin(uTime * 2.9 + position.x * 0.9 - position.z * 0.7);
        transformed.x += (windA * 0.06 + windB * 0.02) * aSway;
        transformed.z += (windB * 0.05) * aSway;
      `);
    injectBacklight(shader, 0.7, false);
  };

  const flameMat = new THREE.MeshBasicMaterial({
    map: Textures.texture, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });

  const glassMat = new THREE.MeshStandardMaterial({
    map: Textures.texture, transparent: true, opacity: 1.0,
    roughness: 0.08, metalness: 0.0, depthWrite: true,
  });

  // ---- water-shader -----------------------------------------------------------------
  const waterUniforms = {
    uTime: sway,
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uSkyColor: { value: new THREE.Color(0.5, 0.7, 0.9) },
    uHorizonColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    uCamPos: { value: new THREE.Vector3() },
    uReflect: { value: null },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uReflectOn: { value: 0 },
    fogColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    fogNear: { value: 50 },
    fogFar: { value: 200 },
  };
  C.waterUniforms = waterUniforms;

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    vertexShader: `
      uniform float uTime;
      uniform mat4 uReflectMatrix;
      attribute float aEdge;
      attribute vec2 aFlow;
      varying vec3 vWorld;
      varying vec4 vRefl;
      varying float vEdge;
      varying vec2 vFlow;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 1.3 + position.x * 0.6 + position.z * 0.4) * 0.035
             + sin(uTime * 2.1 - position.x * 0.35 + position.z * 0.8) * 0.02;
        vWorld = p;
        vEdge = aEdge;
        vFlow = aFlow;
        vec4 wpos = modelMatrix * vec4(p, 1.0);
        vRefl = uReflectMatrix * wpos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir, uSunColor, uSkyColor, uHorizonColor, uCamPos;
      uniform vec3 fogColor;
      uniform float fogNear, fogFar, uReflectOn;
      uniform sampler2D uReflect;
      varying vec3 vWorld;
      varying vec4 vRefl;
      varying float vEdge;
      varying vec2 vFlow;

      float wave(vec2 p) {
        return sin(p.x * 0.9 + uTime * 1.4) * 0.5
             + sin(p.y * 1.1 - uTime * 1.1 + p.x * 0.4) * 0.35
             + sin((p.x + p.y) * 0.5 + uTime * 0.7) * 0.4
             + sin(length(p * 0.35) * 2.2 - uTime * 0.9) * 0.25;
      }

      void main() {
        // stromingsverschuiving voor rivieren (lakes: aFlow ~ 0)
        vec2 wp = vWorld.xz - vFlow * uTime * 0.9;
        float e = 0.35;
        float hC = wave(wp);
        float hX = wave(wp + vec2(e, 0.0));
        float hZ = wave(wp + vec2(0.0, e));
        vec3 n = normalize(vec3((hC - hX) * 0.35, 1.0, (hC - hZ) * 0.35));

        vec3 viewDir = normalize(uCamPos - vWorld);
        float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
        fresnel = clamp(fresnel, 0.04, 1.0);

        vec3 deep = vec3(0.05, 0.22, 0.32) * (0.5 + uSkyColor * 0.9);
        vec3 skyRefl = mix(uHorizonColor, uSkyColor, clamp(n.y, 0.0, 1.0));

        // planaire reflectie van de wereld
        vec3 reflection = skyRefl;
        if (uReflectOn > 0.5) {
          vec2 ruv = vRefl.xy / max(vRefl.w, 0.0001);
          ruv += n.xz * 0.03;                       // golfvervorming
          if (ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0) {
            vec3 world = texture2D(uReflect, ruv).rgb;
            reflection = mix(skyRefl, world, 0.85);
          }
        }
        vec3 col = mix(deep, reflection, fresnel * 0.9);

        // zonneglinstering
        vec3 hv = normalize(viewDir + normalize(uSunDir));
        float spec = pow(max(dot(n, hv), 0.0), 140.0);
        col += uSunColor * spec * 2.2 * clamp(uSunDir.y + 0.05, 0.0, 1.0);
        float glit = pow(max(dot(n, hv), 0.0), 700.0);
        col += uSunColor * glit * 4.0 * clamp(uSunDir.y + 0.05, 0.0, 1.0);

        float alpha = clamp(0.72 + fresnel * 0.24, 0.0, 0.95);

        // oeverschuim
        float foamMask = smoothstep(0.35, 0.95, vEdge);
        float foamWave = 0.5 + 0.5 * sin(uTime * 3.0 + vWorld.x * 2.5 + vWorld.z * 2.5 + hC * 3.0);
        float foam = foamMask * (0.55 + 0.45 * foamWave);
        col = mix(col, vec3(0.92, 0.96, 0.98), clamp(foam, 0.0, 0.85));
        alpha = max(alpha, foam * 0.9);

        float dist = distance(uCamPos, vWorld);
        float fogF = smoothstep(fogNear, fogFar, dist);
        col = mix(col, fogColor, fogF);
        alpha = mix(alpha, 1.0, fogF * 0.6);

        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }
    `,
  });
  C.waterMat = waterMat;

  // ---- vlak-definities voor het meshen ------------------------------------------------
  // texFace: index voor Textures.texFor (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z)
  const FACES = [
    { dir: [-1, 0, 0], texFace: 1, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
    { dir: [1, 0, 0], texFace: 0, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
    { dir: [0, -1, 0], texFace: 3, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
    { dir: [0, 1, 0], texFace: 2, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
    { dir: [0, 0, -1], texFace: 5, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
    { dir: [0, 0, 1], texFace: 4, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
  ];
  const AO_CURVE = [1.0, 0.66, 0.50, 0.36];

  // ---- blok-toegang -------------------------------------------------------------------
  C.getChunk = function (cx, cz) { return chunks.get(ck(cx, cz)); };

  C.getBlock = function (wx, wy, wz) {
    if (wy < 0 || wy >= CH) return B.AIR;
    const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
    const ch = chunks.get(ck(cx, cz));
    if (!ch) return undefined;            // nog niet gegenereerd
    return ch.blocks[lidx(wx - cx * CS, wy, wz - cz * CS)];
  };

  C.getMeta = function (wx, wy, wz) { return G.getMeta(wx, wy, wz); };

  // Vorm- en hoogtebewuste collisie-test voor een wereldpunt (floats)
  C.solidShapeAt = function (x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const id = C.getBlock(bx, by, bz);
    if (id === undefined) return true;         // niet-geladen = muur
    if (!G.isSolid(id)) return false;
    if (!G.SHAPED.has(id)) return true;        // volle blokken
    const fx = x - bx, fy = y - by, fz = z - bz;
    if (id === B.SLAB) return fy <= 0.5 + 1e-4;
    if (id === B.DOOR) return (G.getMeta(bx, by, bz) & 1) ? false : true;
    if (id === B.STAIRS) {
      if (fy <= 0.5 + 1e-4) return true;
      const facing = G.getMeta(bx, by, bz) & 3;
      if (facing === 0) return fz <= 0.5;
      if (facing === 2) return fz >= 0.5;
      if (facing === 1) return fx >= 0.5;
      return fx <= 0.5;
    }
    if (id === B.FENCE_GATE) return (G.getMeta(bx, by, bz) & 1) ? false : true;
    // meubels: lage vaste vorm zodat je er vanzelf op stapt / tegenaan botst
    if (id === B.CHAIR) return fy <= 0.5 + 1e-4;
    if (id === B.TABLE) return fy <= 0.86 + 1e-4;
    if (id === B.BED) return fy <= 0.36 + 1e-4;
    return true;
  };

  // Hoogste blok dat regen tegenhoudt (voor regen-occlusie e.d.)
  C.topBlockY = function (wx, wz) {
    const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
    const ch = chunks.get(ck(cx, cz));
    if (!ch) return World.height(Math.floor(wx), Math.floor(wz));
    return ch.heightmap[(wx - cx * CS) + (wz - cz * CS) * CS];
  };

  // Beloopbare vloer gezien vanaf een referentiehoogte (zodat bewoners
  // ónder daken de vloer vinden in plaats van bovenop het dak te lopen)
  C.walkGroundY = function (wx, wz, refY) {
    wx = Math.floor(wx); wz = Math.floor(wz);
    let y = Math.min(CH - 1, Math.floor(refY) + 2);
    while (y > 0) {
      const b = C.getBlock(wx, y, wz);
      if (b === undefined) return World.height(wx, wz);
      if (G.isSolid(b)) return y;
      y--;
    }
    return 0;
  };

  // Hoogste beloopbare blok (voor entiteiten)
  C.groundY = function (wx, wz) {
    wx = Math.floor(wx); wz = Math.floor(wz);
    const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
    const ch = chunks.get(ck(cx, cz));
    if (!ch) return World.height(wx, wz);
    let y = ch.heightmap[(wx - cx * CS) + (wz - cz * CS) * CS];
    const lx = wx - cx * CS, lz = wz - cz * CS;
    while (y > 0 && !G.isSolid(ch.blocks[lidx(lx, y, lz)])) y--;
    return y;
  };

  function rebuildHeightColumn(chObj, lx, lz) {
    let top = 0;
    for (let y = CH - 1; y >= 0; y--) {
      const id = chObj.blocks[lidx(lx, y, lz)];
      if (id !== B.AIR && !G.isCross(id) && id !== B.TORCH && id !== B.LILYPAD && id !== B.PEBBLES && id !== B.RAIL) { top = y; break; }
    }
    chObj.heightmap[lx + lz * CS] = top;
  }

  function buildHeightmap(chObj) {
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) rebuildHeightColumn(chObj, lx, lz);
  }

  // ---- blok wijzigen (speler / gameplay) -----------------------------------------------
  C.setBlock = function (wx, wy, wz, id, recordEdit, meta) {
    if (wy < 0 || wy >= CH) return false;
    const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
    const chObj = chunks.get(ck(cx, cz));
    if (!chObj) return false;
    const lx = wx - cx * CS, lz = wz - cz * CS;
    chObj.blocks[lidx(lx, wy, lz)] = id;
    G.setMeta(wx, wy, wz, meta || 0);        // meta hoort bij dit blok
    if (recordEdit !== false) G.recordEdit(wx, wy, wz, id);
    rebuildHeightColumn(chObj, lx, lz);
    remesh(chObj);
    // buurchunks bijwerken op de rand
    if (lx === 0) remeshAt(cx - 1, cz);
    if (lx === CS - 1) remeshAt(cx + 1, cz);
    if (lz === 0) remeshAt(cx, cz - 1);
    if (lz === CS - 1) remeshAt(cx, cz + 1);
    return true;
  };

  function remeshAt(cx, cz) {
    const chObj = chunks.get(ck(cx, cz));
    if (chObj) remesh(chObj);
  }

  // Lichte set voor de watersimulatie: werkt data + meta bij, markeert de chunk
  // vuil en zet 'm in de mesh-wachtrij (geen directe remesh voor snelheid).
  function markDirtyQ(chObj) { chObj.dirty = true; queueMesh(chObj); }
  C.setWaterCell = function (wx, wy, wz, id, meta) {
    if (wy < 0 || wy >= CH) return false;
    const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
    const chObj = chunks.get(ck(cx, cz));
    if (!chObj) return false;
    const lx = wx - cx * CS, lz = wz - cz * CS;
    chObj.blocks[lidx(lx, wy, lz)] = id;
    G.setMeta(wx, wy, wz, meta || 0);
    G.recordEdit(wx, wy, wz, id);
    markDirtyQ(chObj);
    if (lx === 0) { const n = chunks.get(ck(cx - 1, cz)); if (n) markDirtyQ(n); }
    if (lx === CS - 1) { const n = chunks.get(ck(cx + 1, cz)); if (n) markDirtyQ(n); }
    if (lz === 0) { const n = chunks.get(ck(cx, cz - 1)); if (n) markDirtyQ(n); }
    if (lz === CS - 1) { const n = chunks.get(ck(cx, cz + 1)); if (n) markDirtyQ(n); }
    return true;
  };
  // Waterniveau-factor (1 = vol) op basis van meta en of er water boven staat
  C.waterFactor = function (wx, wy, wz, aboveIsWater) {
    if (aboveIsWater) return 1;
    const m = G.getMeta(wx, wy, wz);
    if (m === 0 || m >= 8) return 1;
    return m / 8;
  };

  // ---- chunk genereren -------------------------------------------------------------------
  function createChunk(cx, cz) {
    const key = ck(cx, cz);
    if (chunks.has(key)) return chunks.get(key);
    const blocks = World.genChunk(cx, cz);
    const chObj = {
      cx, cz, key, blocks,
      heightmap: new Uint8Array(CS * CS),
      meshes: [], torches: [], dirty: true,
    };
    // speler-bewerkingen toepassen
    const editIdx = G.editIndex.get(key);
    if (editIdx) editIdx.forEach(([wx, wy, wz, id]) => {
      blocks[lidx(wx - cx * CS, wy, wz - cz * CS)] = id;
    });
    buildHeightmap(chObj);
    chunks.set(key, chObj);
    // buren opnieuw meshen zodat naadvlakken kloppen
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = chunks.get(ck(cx + dx, cz + dz));
      if (nb && nb.meshes.length) queueMesh(nb);
    }
    return chObj;
  }

  function queueMesh(chObj) {
    if (!chObj.inMeshQueue) { chObj.inMeshQueue = true; meshQueue.push(chObj); }
  }

  // ---- meshing ------------------------------------------------------------------------------
  function frost(out, wx, wz) {
    const f = G.season.frost || 0;
    if (f <= 0) return;
    // ietwat vlekkerige rijp zodat het niet egaal is
    const v = f * (0.75 + 0.25 * Noise.hash2((wx | 0) * 2 + 7, (wz | 0) * 2 - 3));
    out[0] = Noise.lerp(out[0], 0.92, v);
    out[1] = Noise.lerp(out[1], 0.95, v);
    out[2] = Noise.lerp(out[2], 1.02, v);
  }
  function grassTint(wx, wz, out) {
    const n = Noise.fbm2(wx * 0.015 + 12.3, wz * 0.015 - 7.7, 2);
    const n2 = Noise.hash2(wx | 0, wz | 0) - 0.5;
    // levendig, warm lime-groen (lichter dan voorheen)
    const s = G.season.grass;
    out[0] = (0.62 + n * 0.16 + n2 * 0.06) * s[0];
    out[1] = (0.90 + n * 0.09 + n2 * 0.04) * s[1];
    out[2] = (0.34 + n * 0.06) * s[2];
    frost(out, wx, wz);
  }
  function leafTint(wx, wy, wz, out) {
    const n = Noise.fbm2(wx * 0.02 + 99.1, wz * 0.02 + 3.3, 2);
    const n2 = Noise.hash3(wx | 0, wy | 0, wz | 0) - 0.5;
    const s = G.season.leaf;
    out[0] = (0.72 + n * 0.14 + n2 * 0.10) * s[0];
    out[1] = (1.02 + n * 0.10 + n2 * 0.08) * s[1];
    out[2] = (0.56 + n * 0.10) * s[2];
    frost(out, wx, wz);
  }

  function buildMeshes(chObj) {
    const t0 = performance.now();
    const x0 = chObj.cx * CS, z0 = chObj.cz * CS;
    const blocks = chObj.blocks;

    const get = (wx, wy, wz) => {
      if (wy < 0) return B.STONE;
      if (wy >= CH) return B.AIR;
      const lx = wx - x0, lz = wz - z0;
      if (lx >= 0 && lx < CS && lz >= 0 && lz < CS) return blocks[lidx(lx, wy, lz)];
      const v = C.getBlock(wx, wy, wz);
      return v === undefined ? B.STONE : v;   // onbekende buur = dicht (voorkomt gaten)
    };

    // arrays voor de drie geometrieën
    const oPos = [], oNrm = [], oUv = [], oCol = [], oIdx = [], oTrans = [];
    const fPos = [], fNrm = [], fUv = [], fCol = [], fSway = [], fIdx = [];
    const wPos = [], wIdx = [], wEdge = [], wFlow = [];
    const flPos = [], flUv = [], flIdx = [];
    const gPos = [], gNrm = [], gUv = [], gIdx = [];
    const torches = [];
    const tint = [1, 1, 1];

    function quad(arr, idxArr, count) {
      idxArr.push(count, count + 1, count + 2, count + 2, count + 1, count + 3);
    }

    // een sub-box (voor hekjes) met uniforme belichting
    function emitBox(x, y, z, sx0, sy0, sz0, sx1, sy1, sz1, tile) {
      const [u0, v0, u1, v1] = Textures.uv(tile);
      const cshade = 0.85;
      for (const f of FACES) {
        const base = oPos.length / 3;
        for (const c of f.corners) {
          oPos.push(x + (c[0] ? sx1 : sx0), y + (c[1] ? sy1 : sy0), z + (c[2] ? sz1 : sz0));
          oNrm.push(f.dir[0], f.dir[1], f.dir[2]);
          const uu = c[3] ? u1 : u0, vv = c[4] ? v1 : v0;
          oUv.push(uu, vv);
          const l = f.dir[1] === 1 ? 1 : (f.dir[1] === -1 ? 0.6 : cshade);
          oCol.push(l, l, l);
          oTrans.push(0);
        }
        quad(oPos, oIdx, base);
      }
    }

    // kruisvormig plantje / fakkelstok
    function emitCross(x, y, z, tile, tintArr, swayTop, height, targetF) {
      const [u0, v0, u1, v1] = Textures.uv(tile);
      const h = height || 1;
      const quads = [
        [[x + 0.08, z + 0.08], [x + 0.92, z + 0.92]],
        [[x + 0.92, z + 0.08], [x + 0.08, z + 0.92]],
      ];
      for (const q of quads) {
        const base = (targetF ? fPos : fPos).length / 3;
        fPos.push(q[0][0], y, q[0][1], q[1][0], y, q[1][1], q[0][0], y + h, q[0][1], q[1][0], y + h, q[1][1]);
        fNrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        fUv.push(u0, v0, u1, v0, u0, v1, u1, v1);
        for (let i = 0; i < 4; i++) fCol.push(tintArr[0], tintArr[1], tintArr[2]);
        fSway.push(0, 0, swayTop, swayTop);
        fIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }

    function emitFlame(x, y, z, scale) {
      const [u0, v0, u1, v1] = Textures.uv(Textures.TI.FLAME);
      const s = 0.30 * (scale || 1);
      const cx = x + 0.5, cz = z + 0.5;
      const quadsF = [
        [[cx - s, cz], [cx + s, cz]],
        [[cx, cz - s], [cx, cz + s]],
      ];
      for (const q of quadsF) {
        const base = flPos.length / 3;
        flPos.push(q[0][0], y, q[0][1], q[1][0], y, q[1][1], q[0][0], y + s * 2, q[0][1], q[1][0], y + s * 2, q[1][1]);
        flUv.push(u0, v0, u1, v0, u0, v1, u1, v1);
        flIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }

    for (let y = 0; y < CH; y++) {
      for (let lz = 0; lz < CS; lz++) {
        for (let lx = 0; lx < CS; lx++) {
          const id = blocks[lidx(lx, y, lz)];
          if (id === B.AIR) continue;
          const wx = x0 + lx, wz = z0 + lz;

          if (id === B.WATER) {
            // stroomrichting uit het riviergradient (meren ~ 0)
            const rfc = World.riverFactor(wx + 0.5, wz + 0.5);
            let flx = 0, flz = 0;
            if (rfc > 0.05) {
              const gx = World.riverFactor(wx + 1.5, wz + 0.5) - World.riverFactor(wx - 0.5, wz + 0.5);
              const gz = World.riverFactor(wx + 0.5, wz + 1.5) - World.riverFactor(wx + 0.5, wz - 0.5);
              flx = -gz; flz = gx;
              const l = Math.hypot(flx, flz) || 1;
              flx = flx / l * rfc; flz = flz / l * rfc;
            }
            const edgeCorner = (i, j) => {
              for (const di of [i - 1, i]) for (const dj of [j - 1, j]) {
                const bb = get(wx + di, y, wz + dj);
                if (bb !== B.WATER && G.occludes(bb)) return 1;
              }
              return 0;
            };
            const above = get(wx, y + 1, wz);
            const aboveWater = above === B.WATER;
            // vlak, verbonden wateroppervlak: alle water op dezelfde hoogte
            const topH = 0.9;
            if (!aboveWater && G.occludes(above) === false) {
              // bovenvlak, met schuim-hoekwaarden
              const base = wPos.length / 3;
              const wy = y + topH;
              wPos.push(wx, wy, wz, wx + 1, wy, wz, wx, wy, wz + 1, wx + 1, wy, wz + 1);
              wEdge.push(edgeCorner(0, 0), edgeCorner(1, 0), edgeCorner(0, 1), edgeCorner(1, 1));
              wFlow.push(flx, flz, flx, flz, flx, flz, flx, flz);
              wIdx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
            }
            // zijvlakken tegen lucht
            for (const f of FACES) {
              if (f.dir[1] !== 0) continue;
              const nb = get(wx + f.dir[0], y + f.dir[1], wz + f.dir[2]);
              if (nb === B.AIR) {
                const base = wPos.length / 3;
                for (const c of f.corners) {
                  wPos.push(wx + c[0], y + c[1] * topH, wz + c[2]);
                  wEdge.push(1); wFlow.push(flx, flz);
                }
                wIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
              }
            }
            continue;
          }

          if (G.isCross(id)) {
            if (id === B.TALLGRASS) { grassTint(wx, wz, tint); emitCross(wx, y, wz, Textures.texFor(id, 0), tint, 1, 0.85); }
            else if (id === B.FERN) { grassTint(wx, wz, tint); tint[0] *= 0.9; tint[2] *= 0.95; emitCross(wx, y, wz, Textures.TI.FERN, tint, 1, 0.9); }
            else if (id === B.CROP) { const mm = C.getMeta(wx, y, wz); const st = mm === 0 ? 4 : mm; emitCross(wx, y, wz, Textures.TI.CROP, [1, 1, 1], 0.6, 0.28 + st * 0.13); }
            else if (id === B.MUSHROOM) { emitCross(wx, y, wz, Textures.TI.MUSHROOM, [1, 1, 1], 0.15, 0.6); }
            else if (id === B.LAVENDER) { emitCross(wx, y, wz, Textures.TI.LAVENDER, [1, 1, 1], 0.6, 1.15); }
            else { emitCross(wx, y, wz, Textures.texFor(id, 0), [1, 1, 1], 0.5, 0.9); }
            continue;
          }

          if (id === B.LILYPAD) {
            const [u0, v0, u1, v1] = Textures.uv(Textures.TI.LILYPAD);
            const yy = y - 0.08;   // net op het wateroppervlak
            const base = fPos.length / 3;
            fPos.push(wx + 0.05, yy, wz + 0.05, wx + 0.95, yy, wz + 0.05, wx + 0.05, yy, wz + 0.95, wx + 0.95, yy, wz + 0.95);
            fNrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            fUv.push(u0, v0, u1, v0, u0, v1, u1, v1);
            for (let i = 0; i < 4; i++) fCol.push(1, 1, 1);
            fSway.push(0, 0, 0, 0);
            fIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
            continue;
          }

          if (id === B.PEBBLES) {
            const [u0, v0, u1, v1] = Textures.uv(Textures.TI.PEBBLES);
            const yy = y + 0.02;
            const base = fPos.length / 3;
            fPos.push(wx, yy, wz, wx + 1, yy, wz, wx, yy, wz + 1, wx + 1, yy, wz + 1);
            fNrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            fUv.push(u0, v0, u1, v0, u0, v1, u1, v1);
            for (let i = 0; i < 4; i++) fCol.push(1, 1, 1);
            fSway.push(0, 0, 0, 0);
            fIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
            continue;
          }

          if (id === B.RAIL) {
            const [u0, v0, u1, v1] = Textures.uv(Textures.TI.RAIL);
            const yy = y + 0.08;
            const base = fPos.length / 3;
            fPos.push(wx, yy, wz, wx + 1, yy, wz, wx, yy, wz + 1, wx + 1, yy, wz + 1);
            fNrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            // UV draaien afhankelijk van de spoorrichting
            const ri = (window.World && World.roadInfo) ? World.roadInfo(wx, wz) : null;
            const alongX = ri ? Math.abs(ri.n.cx - ri.v.cx) >= Math.abs(ri.n.cz - ri.v.cz) : false;
            if (alongX) fUv.push(u0, v0, u0, v1, u1, v0, u1, v1);
            else fUv.push(u0, v0, u1, v0, u0, v1, u1, v1);
            for (let i = 0; i < 4; i++) fCol.push(1, 1, 1);
            fSway.push(0, 0, 0, 0);
            fIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
            continue;
          }

          if (id === B.TORCH) {
            emitCross(wx, y, wz, Textures.TI.TORCH, [1, 1, 1], 0, 0.85);
            emitFlame(wx, y + 0.62, wz);
            torches.push({ x: wx + 0.5, y: y + 0.85, z: wz + 0.5, big: false });
            continue;
          }

          if (id === B.LANTERN) {
            emitBox(wx, y, wz, 0.32, 0.0, 0.32, 0.68, 0.6, 0.68, Textures.TI.LANTERN);
            torches.push({ x: wx + 0.5, y: y + 0.4, z: wz + 0.5, big: false });
            continue;
          }

          if (id === B.CRYSTAL) {
            // gloeiend kristalcluster met eigen (koel) licht
            emitBox(wx, y, wz, 0.14, 0.0, 0.14, 0.86, 0.9, 0.86, Textures.TI.CRYSTAL);
            emitBox(wx, y, wz, 0.34, 0.0, 0.34, 0.60, 1.0, 0.60, Textures.TI.CRYSTAL);
            torches.push({ x: wx + 0.5, y: y + 0.5, z: wz + 0.5, big: false, crystal: true });
            continue;
          }

          if (id === B.CHAIR) {
            const P = Textures.TI.PLANKS;
            const facing = C.getMeta(wx, y, wz) & 3;
            // poten
            for (const [lx0, lz0] of [[0.14, 0.14], [0.72, 0.14], [0.14, 0.72], [0.72, 0.72]])
              emitBox(wx, y, wz, lx0, 0, lz0, lx0 + 0.14, 0.42, lz0 + 0.14, P);
            // zitting
            emitBox(wx, y, wz, 0.1, 0.42, 0.1, 0.9, 0.54, 0.9, P);
            // rugleuning aan de kant tegenover de kijkrichting
            if (facing === 0) emitBox(wx, y, wz, 0.1, 0.54, 0.86, 0.9, 1.15, 0.98, P);
            else if (facing === 2) emitBox(wx, y, wz, 0.1, 0.54, 0.02, 0.9, 1.15, 0.14, P);
            else if (facing === 1) emitBox(wx, y, wz, 0.02, 0.54, 0.1, 0.14, 1.15, 0.9, P);
            else emitBox(wx, y, wz, 0.86, 0.54, 0.1, 0.98, 1.15, 0.9, P);
            continue;
          }

          if (id === B.TABLE) {
            const P = Textures.TI.PLANKS;
            for (const [lx0, lz0] of [[0.08, 0.08], [0.78, 0.08], [0.08, 0.78], [0.78, 0.78]])
              emitBox(wx, y, wz, lx0, 0, lz0, lx0 + 0.14, 0.74, lz0 + 0.14, P);
            emitBox(wx, y, wz, 0.02, 0.74, 0.02, 0.98, 0.88, 0.98, P);
            continue;
          }

          if (id === B.BED) {
            emitBox(wx, y, wz, 0.02, 0.0, 0.02, 0.98, 0.16, 0.98, Textures.TI.PLANKS);
            emitBox(wx, y, wz, 0.0, 0.16, 0.0, 1.0, 0.34, 1.0, Textures.TI.BED);
            continue;
          }

          if (id === B.SLAB) {
            emitBox(wx, y, wz, 0, 0, 0, 1, 0.5, 1, Textures.TI.PLANKS);
            continue;
          }

          if (id === B.FENCE_GATE) {
            const m = C.getMeta(wx, y, wz);
            const open = m & 1, facing = (m >> 1) & 3;
            const alongX = (facing === 0 || facing === 2);
            const T = Textures.TI.PLANKS;
            if (alongX) {
              emitBox(wx, y, wz, 0.0, 0, 0.42, 0.16, 1.0, 0.58, T);
              emitBox(wx, y, wz, 0.84, 0, 0.42, 1.0, 1.0, 0.58, T);
              if (!open) {
                emitBox(wx, y, wz, 0.16, 0.32, 0.46, 0.84, 0.46, 0.54, T);
                emitBox(wx, y, wz, 0.16, 0.60, 0.46, 0.84, 0.74, 0.54, T);
              } else {
                emitBox(wx, y, wz, 0.02, 0.32, 0.58, 0.14, 0.74, 0.98, T);
                emitBox(wx, y, wz, 0.86, 0.32, 0.58, 0.98, 0.74, 0.98, T);
              }
            } else {
              emitBox(wx, y, wz, 0.42, 0, 0.0, 0.58, 1.0, 0.16, T);
              emitBox(wx, y, wz, 0.42, 0, 0.84, 0.58, 1.0, 1.0, T);
              if (!open) {
                emitBox(wx, y, wz, 0.46, 0.32, 0.16, 0.54, 0.46, 0.84, T);
                emitBox(wx, y, wz, 0.46, 0.60, 0.16, 0.54, 0.74, 0.84, T);
              } else {
                emitBox(wx, y, wz, 0.58, 0.32, 0.02, 0.98, 0.74, 0.14, T);
                emitBox(wx, y, wz, 0.58, 0.32, 0.86, 0.98, 0.74, 0.98, T);
              }
            }
            continue;
          }

          if (id === B.STAIRS) {
            const facing = C.getMeta(wx, y, wz) & 3;
            emitBox(wx, y, wz, 0, 0, 0, 1, 0.5, 1, Textures.TI.STONE_BRICK);   // onderste helft
            let x0 = 0, z0 = 0, x1 = 1, z1 = 1;                                 // bovenste helft
            if (facing === 0) z1 = 0.5;
            else if (facing === 2) z0 = 0.5;
            else if (facing === 1) x0 = 0.5;
            else x1 = 0.5;
            emitBox(wx, y, wz, x0, 0.5, z0, x1, 1, z1, Textures.TI.STONE_BRICK);
            continue;
          }

          if (id === B.DOOR) {
            const m = C.getMeta(wx, y, wz);
            const open = m & 1, facing = (m >> 1) & 3;
            const axisZ = (facing === 0 || facing === 2);
            if (open) {
              if (axisZ) emitBox(wx, y, wz, 0, 0, 0, 0.14, 1, 1, Textures.TI.DOOR);
              else emitBox(wx, y, wz, 0, 0, 0, 1, 1, 0.14, Textures.TI.DOOR);
            } else {
              if (axisZ) emitBox(wx, y, wz, 0, 0, 0.43, 1, 1, 0.57, Textures.TI.DOOR);
              else emitBox(wx, y, wz, 0.43, 0, 0, 0.57, 1, 1, Textures.TI.DOOR);
            }
            continue;
          }

          if (id === B.CAMPFIRE) {
            emitBox(wx, y, wz, 0.12, 0.0, 0.12, 0.88, 0.12, 0.88, Textures.TI.EMBER);
            emitBox(wx, y, wz, 0.08, 0.10, 0.30, 0.92, 0.26, 0.48, Textures.TI.LOG_SIDE);
            emitBox(wx, y, wz, 0.08, 0.10, 0.52, 0.92, 0.26, 0.70, Textures.TI.LOG_SIDE);
            emitBox(wx, y, wz, 0.30, 0.24, 0.08, 0.48, 0.40, 0.92, Textures.TI.LOG_SIDE);
            emitBox(wx, y, wz, 0.52, 0.24, 0.08, 0.70, 0.40, 0.92, Textures.TI.LOG_SIDE);
            emitFlame(wx, y + 0.18, wz, 1.6);
            emitFlame(wx + 0.12, y + 0.14, wz - 0.08, 1.1);
            torches.push({ x: wx + 0.5, y: y + 0.55, z: wz + 0.5, big: true });
            continue;
          }

          if (id === B.FENCE) {
            emitBox(wx, y, wz, 0.375, 0, 0.375, 0.625, 1.0, 0.625, Textures.TI.PLANKS);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nb = get(wx + dx, y, wz + dz);
              if (nb === B.FENCE || G.occludes(nb)) {
                const x0b = dx === 1 ? 0.625 : dx === -1 ? 0 : 0.44;
                const x1b = dx === 1 ? 1 : dx === -1 ? 0.375 : 0.56;
                const z0b = dz === 1 ? 0.625 : dz === -1 ? 0 : 0.44;
                const z1b = dz === 1 ? 1 : dz === -1 ? 0.375 : 0.56;
                emitBox(wx, y, wz, x0b, 0.35, z0b, x1b, 0.55, z1b, Textures.TI.PLANKS);
                emitBox(wx, y, wz, x0b, 0.75, z0b, x1b, 0.95, z1b, Textures.TI.PLANKS);
              }
            }
            continue;
          }

          if (id === B.GLASS) {
            for (let fi = 0; fi < 6; fi++) {
              const f = FACES[fi];
              const nb = get(wx + f.dir[0], y + f.dir[1], wz + f.dir[2]);
              if (G.occludes(nb) || nb === B.GLASS) continue;   // alleen naar open ruimte
              const [u0, v0, u1, v1] = Textures.uv(Textures.TI.GLASS);
              const base = gPos.length / 3;
              for (const c of f.corners) {
                gPos.push(wx + c[0], y + c[1], wz + c[2]);
                gNrm.push(f.dir[0], f.dir[1], f.dir[2]);
                gUv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
              }
              gIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
            }
            continue;
          }

          // ---- normale blokken --------------------------------------------------
          const isLeaf = G.LEAF_BLOCKS.has(id);
          const transVal = isLeaf ? 1 : ((id === B.GRASS) ? 0.55 : 0);
          for (let fi = 0; fi < 6; fi++) {
            const f = FACES[fi];
            const nb = get(wx + f.dir[0], y + f.dir[1], wz + f.dir[2]);
            if (G.occludes(nb)) continue;
            if (isLeaf && nb === id) continue;    // geen vlakken tussen gelijke bladeren

            const tile = Textures.texFor(id, f.texFace);
            const [u0, v0, u1, v1] = Textures.uv(tile);

            // kleurtint
            let tr = 1, tg = 1, tb = 1;
            if (id === B.GRASS && f.texFace === 2) { grassTint(wx, wz, tint); tr = tint[0]; tg = tint[1]; tb = tint[2]; }
            else if (isLeaf) {
              leafTint(wx, y, wz, tint); tr = tint[0]; tg = tint[1]; tb = tint[2];
              if (id === B.LEAVES_PINE) { tr *= 0.75; tg *= 0.9; tb *= 0.85; }
              else if (id === B.LEAVES_WILLOW) { tr *= 1.05; tg *= 1.02; tb *= 0.7; }
              else if (id === B.PALM_LEAVES) {
                // tropisch blad: helder groen, ongevoelig voor seizoen
                const nn = Noise.hash3(wx | 0, y | 0, wz | 0);
                tr = 0.78 + nn * 0.08; tg = 1.08 + nn * 0.06; tb = 0.62 + nn * 0.05;
              }
              else if (id === B.LEAVES_CHERRY) {
                // roze bloesem: eigen tint, negeer de groene seizoenskleur
                const nn = Noise.hash3(wx | 0, y | 0, wz | 0);
                tr = 1.0 + nn * 0.08; tg = 0.72 + nn * 0.08; tb = 0.82 + nn * 0.06;
              }
            }

            const vTrans = isLeaf ? transVal : (id === B.GRASS && f.texFace === 2 ? 0.55 : 0);
            const base = oPos.length / 3;
            for (const c of f.corners) {
              oPos.push(wx + c[0], y + c[1], wz + c[2]);
              oNrm.push(f.dir[0], f.dir[1], f.dir[2]);
              oUv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
              oTrans.push(vTrans);

              // ambient occlusion per hoekpunt
              let ao = 1;
              if (!isLeaf) {
                const d = f.dir;
                const nx = wx + d[0], ny = y + d[1], nz = wz + d[2];
                let ua, va;                  // tangent-assen
                if (d[0] !== 0) { ua = [0, c[1] ? 1 : -1, 0]; va = [0, 0, c[2] ? 1 : -1]; }
                else if (d[1] !== 0) { ua = [c[0] ? 1 : -1, 0, 0]; va = [0, 0, c[2] ? 1 : -1]; }
                else { ua = [c[0] ? 1 : -1, 0, 0]; va = [0, c[1] ? 1 : -1, 0]; }
                const s1 = G.occludes(get(nx + ua[0], ny + ua[1], nz + ua[2])) ? 1 : 0;
                const s2 = G.occludes(get(nx + va[0], ny + va[1], nz + va[2])) ? 1 : 0;
                const cc = G.occludes(get(nx + ua[0] + va[0], ny + ua[1] + va[1], nz + ua[2] + va[2])) ? 1 : 0;
                const occ = (s1 && s2) ? 3 : s1 + s2 + cc;
                ao = AO_CURVE[occ];
              }
              oCol.push(tr * ao, tg * ao, tb * ao);
            }
            oIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }

    // oude meshes opruimen
    disposeMeshes(chObj);
    chObj.torches = torches;

    function makeMesh(pos, nrm, uv, col, idxArr, mat, attrs) {
      if (idxArr.length === 0) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (nrm) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (col) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (attrs) for (const a of attrs) geo.setAttribute(a.name, new THREE.Float32BufferAttribute(a.data, a.size || 1));
      geo.setIndex(idxArr);
      if (!nrm) geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      chObj.meshes.push(mesh);
      return mesh;
    }

    const om = makeMesh(oPos, oNrm, oUv, oCol, oIdx, opaqueMat, [{ name: 'aTrans', data: oTrans }]);
    if (om) { om.castShadow = true; om.receiveShadow = true; }
    const fm = makeMesh(fPos, fNrm, fUv, fCol, fIdx, foliageMat, [{ name: 'aSway', data: fSway }]);
    if (fm) { fm.receiveShadow = true; }
    const wm = makeMesh(wPos, null, null, null, wIdx, waterMat,
      [{ name: 'aEdge', data: wEdge, size: 1 }, { name: 'aFlow', data: wFlow, size: 2 }]);
    if (wm) wm.layers.set(1);            // laag 1: uitgesloten van de reflectie-render
    makeMesh(flPos, null, flUv, null, flIdx, flameMat);
    const gm = makeMesh(gPos, gNrm, gUv, null, gIdx, glassMat);
    if (gm) gm.renderOrder = 1;

    chObj.dirty = false;
    return performance.now() - t0;
  }

  function disposeMeshes(chObj) {
    for (const m of chObj.meshes) {
      scene.remove(m);
      m.geometry.dispose();
    }
    chObj.meshes = [];
  }

  function remesh(chObj) { buildMeshes(chObj); }

  // ---- streaming ---------------------------------------------------------------------------
  let ringOffsets = [];
  function computeRings(dist) {
    ringOffsets = [];
    for (let dx = -dist; dx <= dist; dx++) for (let dz = -dist; dz <= dist; dz++) {
      if (dx * dx + dz * dz <= (dist + 0.4) * (dist + 0.4)) ringOffsets.push([dx, dz, dx * dx + dz * dz]);
    }
    ringOffsets.sort((a, b) => a[2] - b[2]);
  }

  C.init = function (theScene) {
    scene = theScene;
    chunks.clear();
    genQueue = []; meshQueue = [];
    lastCenter = null;
    computeRings(G.settings.renderDist);
  };

  C.reset = function () {
    chunks.forEach(disposeMeshes);
    chunks.clear();
    genQueue = []; meshQueue = [];
    lastCenter = null;
  };

  C.onRenderDistChanged = function () {
    computeRings(G.settings.renderDist);
    lastCenter = null;
  };

  // Alle geladen chunks opnieuw meshen (bv. bij een seizoenswisseling)
  C.remeshAll = function () {
    chunks.forEach((chObj) => { chObj.dirty = true; queueMesh(chObj); });
  };

  // Wordt elke frame aangeroepen; genereert/mesht met een tijdbudget
  C.update = function (px, pz, budgetMs) {
    const ccx = Math.floor(px / CS), ccz = Math.floor(pz / CS);
    if (!lastCenter || lastCenter[0] !== ccx || lastCenter[1] !== ccz) {
      lastCenter = [ccx, ccz];
      genQueue = [];
      for (const [dx, dz] of ringOffsets) {
        const key = ck(ccx + dx, ccz + dz);
        const existing = chunks.get(key);
        if (!existing) genQueue.push([ccx + dx, ccz + dz]);
        else if (existing.dirty) queueMesh(existing);
      }
      // te verre chunks opruimen
      const maxD = (G.settings.renderDist + 2) * (G.settings.renderDist + 2);
      chunks.forEach((chObj, key) => {
        const dx = chObj.cx - ccx, dz = chObj.cz - ccz;
        if (dx * dx + dz * dz > maxD) {
          disposeMeshes(chObj);
          chunks.delete(key);
        }
      });
    }

    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (meshQueue.length) {
        const chObj = meshQueue.shift();
        chObj.inMeshQueue = false;
        if (chunks.has(chObj.key)) buildMeshes(chObj);
      } else if (genQueue.length) {
        const [cx, cz] = genQueue.shift();
        const chObj = createChunk(cx, cz);
        queueMesh(chObj);
      } else break;
    }
    return genQueue.length + meshQueue.length;
  };

  // Synchrone generatie voor het laadscherm
  C.pending = function () { return genQueue.length + meshQueue.length; };

  // Fakkel-posities in de buurt (voor de lichtpool)
  C.nearbyTorches = function (px, py, pz, maxDist) {
    const out = [];
    const md2 = maxDist * maxDist;
    chunks.forEach((chObj) => {
      const dx = chObj.cx * CS + 8 - px, dz = chObj.cz * CS + 8 - pz;
      if (dx * dx + dz * dz > (maxDist + 24) * (maxDist + 24)) return;
      for (const t of chObj.torches) {
        const ddx = t.x - px, ddy = t.y - py, ddz = t.z - pz;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 < md2) out.push({ x: t.x, y: t.y, z: t.z, d2, big: t.big });
      }
    });
    return out;
  };

  return C;
})();
