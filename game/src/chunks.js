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

  const opaqueMat = new THREE.MeshStandardMaterial({
    map: Textures.texture, vertexColors: true, alphaTest: 0.5,
    roughness: 0.95, metalness: 0.0,
  });

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
  };

  const flameMat = new THREE.MeshBasicMaterial({
    map: Textures.texture, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });

  // ---- water-shader -----------------------------------------------------------------
  const waterUniforms = {
    uTime: sway,
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uSkyColor: { value: new THREE.Color(0.5, 0.7, 0.9) },
    uHorizonColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    uCamPos: { value: new THREE.Vector3() },
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
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 1.3 + position.x * 0.6 + position.z * 0.4) * 0.035
             + sin(uTime * 2.1 - position.x * 0.35 + position.z * 0.8) * 0.02;
        vWorld = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir, uSunColor, uSkyColor, uHorizonColor, uCamPos;
      uniform vec3 fogColor;
      uniform float fogNear, fogFar;
      varying vec3 vWorld;

      // golfhoogte-veld voor normalen
      float wave(vec2 p) {
        return sin(p.x * 0.9 + uTime * 1.4) * 0.5
             + sin(p.y * 1.1 - uTime * 1.1 + p.x * 0.4) * 0.35
             + sin((p.x + p.y) * 0.5 + uTime * 0.7) * 0.4
             + sin(length(p * 0.35) * 2.2 - uTime * 0.9) * 0.25;
      }

      void main() {
        vec2 wp = vWorld.xz;
        float e = 0.35;
        float hC = wave(wp);
        float hX = wave(wp + vec2(e, 0.0));
        float hZ = wave(wp + vec2(0.0, e));
        vec3 n = normalize(vec3((hC - hX) * 0.35, 1.0, (hC - hZ) * 0.35));

        vec3 viewDir = normalize(uCamPos - vWorld);
        float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
        fresnel = clamp(fresnel, 0.04, 1.0);

        vec3 deep = vec3(0.05, 0.22, 0.32) * (0.5 + uSkyColor * 0.9);
        vec3 refl = mix(uHorizonColor, uSkyColor, clamp(n.y, 0.0, 1.0));
        vec3 col = mix(deep, refl, fresnel * 0.9);

        // zonneglinstering
        vec3 hv = normalize(viewDir + normalize(uSunDir));
        float spec = pow(max(dot(n, hv), 0.0), 140.0);
        col += uSunColor * spec * 2.2 * clamp(uSunDir.y + 0.05, 0.0, 1.0);
        float glit = pow(max(dot(n, hv), 0.0), 700.0);
        col += uSunColor * glit * 4.0 * clamp(uSunDir.y + 0.05, 0.0, 1.0);

        float alpha = clamp(0.72 + fresnel * 0.24, 0.0, 0.95);

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
  const AO_CURVE = [1.0, 0.72, 0.58, 0.45];

  // ---- blok-toegang -------------------------------------------------------------------
  C.getChunk = function (cx, cz) { return chunks.get(ck(cx, cz)); };

  C.getBlock = function (wx, wy, wz) {
    if (wy < 0 || wy >= CH) return B.AIR;
    const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
    const ch = chunks.get(ck(cx, cz));
    if (!ch) return undefined;            // nog niet gegenereerd
    return ch.blocks[lidx(wx - cx * CS, wy, wz - cz * CS)];
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
      if (id !== B.AIR && !G.isCross(id) && id !== B.TORCH) { top = y; break; }
    }
    chObj.heightmap[lx + lz * CS] = top;
  }

  function buildHeightmap(chObj) {
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) rebuildHeightColumn(chObj, lx, lz);
  }

  // ---- blok wijzigen (speler / gameplay) -----------------------------------------------
  C.setBlock = function (wx, wy, wz, id, recordEdit) {
    if (wy < 0 || wy >= CH) return false;
    const cx = Math.floor(wx / CS), cz = Math.floor(wz / CS);
    const chObj = chunks.get(ck(cx, cz));
    if (!chObj) return false;
    const lx = wx - cx * CS, lz = wz - cz * CS;
    chObj.blocks[lidx(lx, wy, lz)] = id;
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
  function grassTint(wx, wz, out) {
    const n = Noise.fbm2(wx * 0.015 + 12.3, wz * 0.015 - 7.7, 2);
    const n2 = Noise.hash2(wx | 0, wz | 0) - 0.5;
    out[0] = 0.42 + n * 0.10 + n2 * 0.05;
    out[1] = 0.72 + n * 0.09 + n2 * 0.04;
    out[2] = 0.28 + n * 0.06;
  }
  function leafTint(wx, wy, wz, out) {
    const n = Noise.fbm2(wx * 0.02 + 99.1, wz * 0.02 + 3.3, 2);
    const n2 = Noise.hash3(wx | 0, wy | 0, wz | 0) - 0.5;
    out[0] = 0.60 + n * 0.14 + n2 * 0.10;
    out[1] = 0.86 + n * 0.10 + n2 * 0.08;
    out[2] = 0.50 + n * 0.10;
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
    const oPos = [], oNrm = [], oUv = [], oCol = [], oIdx = [];
    const fPos = [], fNrm = [], fUv = [], fCol = [], fSway = [], fIdx = [];
    const wPos = [], wIdx = [];
    const flPos = [], flUv = [], flIdx = [];
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

    function emitFlame(x, y, z) {
      const [u0, v0, u1, v1] = Textures.uv(Textures.TI.FLAME);
      const s = 0.30;
      const quadsF = [
        [[x + 0.5 - s, z + 0.5], [x + 0.5 + s, z + 0.5]],
        [[x + 0.5, z + 0.5 - s], [x + 0.5, z + 0.5 + s]],
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
            const above = get(wx, y + 1, wz);
            if (above !== B.WATER && G.occludes(above) === false) {
              // bovenvlak
              const base = wPos.length / 3;
              const wy = y + 0.86;
              wPos.push(wx, wy, wz, wx + 1, wy, wz, wx, wy, wz + 1, wx + 1, wy, wz + 1);
              wIdx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
            }
            // zijvlakken tegen lucht
            for (const f of FACES) {
              if (f.dir[1] !== 0) continue;
              const nb = get(wx + f.dir[0], y + f.dir[1], wz + f.dir[2]);
              if (nb === B.AIR) {
                const base = wPos.length / 3;
                for (const c of f.corners) {
                  wPos.push(wx + c[0], y + c[1] * 0.86, wz + c[2]);
                }
                wIdx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
              }
            }
            continue;
          }

          if (G.isCross(id)) {
            if (id === B.TALLGRASS) { grassTint(wx, wz, tint); emitCross(wx, y, wz, Textures.texFor(id, 0), tint, 1, 0.85); }
            else if (id === B.CROP) { emitCross(wx, y, wz, Textures.texFor(id, 0), [1, 1, 1], 0.6, 0.8); }
            else { emitCross(wx, y, wz, Textures.texFor(id, 0), [1, 1, 1], 0.5, 0.9); }
            continue;
          }

          if (id === B.TORCH) {
            emitCross(wx, y, wz, Textures.TI.TORCH, [1, 1, 1], 0, 0.85);
            emitFlame(wx, y + 0.62, wz);
            torches.push({ x: wx + 0.5, y: y + 0.85, z: wz + 0.5 });
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

          // ---- normale blokken --------------------------------------------------
          const isLeaf = (id === B.LEAVES || id === B.LEAVES_BIRCH || id === B.LEAVES_PINE);
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
            }

            const base = oPos.length / 3;
            for (const c of f.corners) {
              oPos.push(wx + c[0], y + c[1], wz + c[2]);
              oNrm.push(f.dir[0], f.dir[1], f.dir[2]);
              oUv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);

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

    function makeMesh(pos, nrm, uv, col, idxArr, mat, extra) {
      if (idxArr.length === 0) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (nrm) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (col) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (extra) geo.setAttribute('aSway', new THREE.Float32BufferAttribute(extra, 1));
      geo.setIndex(idxArr);
      if (!nrm) geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      chObj.meshes.push(mesh);
      return mesh;
    }

    const om = makeMesh(oPos, oNrm, oUv, oCol, oIdx, opaqueMat);
    if (om) { om.castShadow = true; om.receiveShadow = true; }
    const fm = makeMesh(fPos, fNrm, fUv, fCol, fIdx, foliageMat, fSway);
    if (fm) { fm.receiveShadow = true; }
    makeMesh(wPos, null, null, null, wIdx, waterMat);
    makeMesh(flPos, null, flUv, null, flIdx, flameMat);

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
        if (d2 < md2) out.push({ x: t.x, y: t.y, z: t.z, d2 });
      }
    });
    return out;
  };

  return C;
})();
