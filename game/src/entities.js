// Levende wereld: dorpsbewoners met een dagritme, dieren, vogels en vuurvliegjes.
// Plus de fakkel-lichtpool (een beperkt aantal echte lichten voor de dichtstbijzijnde fakkels).
window.Entities = (function () {
  const E = {};
  let scene = null;
  const B = G.B;

  const villagers = [];
  const animals = [];
  const flocks = [];
  const populatedVillages = new Set();
  let fireflies = null, fireflyData = [];
  let rng = Math.random;

  // ---- gedeelde geometrie & materialen -------------------------------------------
  const geoCache = {};
  function box(w, h, d) {
    const k = w + 'x' + h + 'x' + d;
    if (!geoCache[k]) geoCache[k] = new THREE.BoxGeometry(w, h, d);
    return geoCache[k];
  }
  function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

  // gezichtstextuur voor bewoners
  const faceTex = (function () {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, 16, 16);
    x.fillStyle = '#2b2b30';
    x.fillRect(3, 6, 3, 3); x.fillRect(10, 6, 3, 3);       // ogen
    x.fillStyle = '#7a4a3a';
    x.fillRect(7, 10, 2, 3);                                // neus
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  })();

  const SKIN = [0xe8bd98, 0xd9a878, 0xc28e62, 0xf2ccaa];
  const ROBE = [0x8a6f4d, 0x6f8a5a, 0x5a708a, 0x9a6a5a, 0x77628f, 0xa08a4a];

  // ---- fakkel-lichtpool -------------------------------------------------------------
  const POOL_N = 8;
  const lightPool = [];
  E.extraTorches = [];         // gedragen fakkels van bewoners (elke frame opnieuw gevuld)

  function initLightPool() {
    for (let i = 0; i < POOL_N; i++) {
      const l = new THREE.PointLight(0xffab5e, 0, 13, 2);
      l.visible = false;
      scene.add(l);
      lightPool.push(l);
    }
  }

  function updateLightPool(camPos, t) {
    const cands = Chunks.nearbyTorches(camPos.x, camPos.y, camPos.z, 38);
    for (const et of E.extraTorches) {
      const dx = et.x - camPos.x, dy = et.y - camPos.y, dz = et.z - camPos.z;
      cands.push({ x: et.x, y: et.y, z: et.z, d2: dx * dx + dy * dy + dz * dz });
    }
    cands.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < POOL_N; i++) {
      const l = lightPool[i];
      if (i < cands.length) {
        l.visible = true;
        l.position.set(cands[i].x, cands[i].y + 0.1, cands[i].z);
        l.intensity = 1.15 + Math.sin(t * 9 + i * 2.7) * 0.18 + Math.sin(t * 23 + i) * 0.08;
      } else l.visible = false;
    }
  }

  // ---- dorpsbewoner ------------------------------------------------------------------
  function buildVillagerMesh(seedN) {
    const r = Noise.rng(seedN);
    const skin = SKIN[(r() * SKIN.length) | 0];
    const robe = ROBE[(r() * ROBE.length) | 0];
    const g = new THREE.Group();

    const legs = new THREE.Mesh(box(0.42, 0.55, 0.24), mat(new THREE.Color(robe).multiplyScalar(0.7).getHex()));
    legs.position.y = 0.275; g.add(legs);
    const body = new THREE.Mesh(box(0.5, 0.62, 0.3), mat(robe));
    body.position.y = 0.55 + 0.31; g.add(body);
    const armL = new THREE.Mesh(box(0.13, 0.55, 0.16), mat(robe));
    armL.position.set(-0.32, 1.02, 0); armL.geometry.translate ? null : null; g.add(armL);
    const armR = new THREE.Mesh(box(0.13, 0.55, 0.16), mat(robe));
    armR.position.set(0.32, 1.02, 0); g.add(armR);
    const head = new THREE.Mesh(box(0.42, 0.42, 0.42), mat(skin));
    head.position.y = 1.17 + 0.21; g.add(head);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42),
      new THREE.MeshBasicMaterial({ map: faceTex, transparent: true }));
    face.position.set(0, 0, 0.212); head.add(face);

    // fakkel in de hand (standaard onzichtbaar)
    const torch = new THREE.Group();
    const stick = new THREE.Mesh(box(0.08, 0.34, 0.08), mat(0x6e5634));
    torch.add(stick);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({
        map: Textures.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    const [u0, v0, u1, v1] = Textures.uv(Textures.TI.FLAME);
    const uvA = glow.geometry.attributes.uv;
    uvA.setXY(0, u0, v1); uvA.setXY(1, u1, v1); uvA.setXY(2, u0, v0); uvA.setXY(3, u1, v0);
    glow.position.y = 0.28;
    torch.add(glow);
    torch.position.set(0.34, 1.1, 0.18);
    torch.visible = false;
    g.add(torch);

    g.traverse((o) => { if (o.isMesh && o.material.map !== Textures.texture) { o.castShadow = true; } });
    return { group: g, legs, armL, armR, head, torch, glowPlane: glow };
  }

  function spawnVillage(layout) {
    const vkey = layout.v.key;
    populatedVillages.add(vkey);
    let n = 0;
    for (const sp of layout.spawns) {
      const count = 1 + (Noise.hash2(layout.v.cx + n * 31, layout.v.cz - n * 17) < 0.5 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const seedN = (G.seed ^ (layout.v.cx * 7349) ^ (layout.v.cz * 913) ^ (n * 5471)) >>> 0;
        const parts = buildVillagerMesh(seedN);
        const vr = Noise.rng(seedN + 7);
        const vil = {
          type: 'villager', parts, mesh: parts.group,
          village: layout.v, home: sp.home, door: sp.door,
          x: sp.door.x + (vr() - 0.5) * 4, z: sp.door.z + (vr() - 0.5) * 4, y: 0,
          tx: 0, tz: 0, speed: 1.15 + vr() * 0.5,
          state: 'idle', timer: vr() * 3, phase: vr() * 10,
          carriesTorch: vr() < 0.4,           // loopt 's avonds met fakkel
          workBob: 0, heading: vr() * Math.PI * 2,
        };
        vil.y = Chunks.walkGroundY(vil.x, vil.z, sp.door.y + 1) + 1;
        vil.mesh.position.set(vil.x, vil.y, vil.z);
        scene.add(vil.mesh);
        villagers.push(vil);
        n++;
      }
    }
  }

  function villagePoint(v, r) {
    const a = rng() * Math.PI * 2;
    const rr = 3 + rng() * (r || 22);
    return [v.cx + Math.cos(a) * rr, v.cz + Math.sin(a) * rr];
  }

  function walkable(x, z, refY) {
    const gy = refY !== undefined ? Chunks.walkGroundY(x, z, refY) : Chunks.groundY(x, z);
    const b = Chunks.getBlock(Math.floor(x), gy, Math.floor(z));
    return b !== B.WATER && b !== undefined;
  }

  function updateVillager(v, dt, e, nightAmt, t) {
    v.timer -= dt;
    const isDay = e > 0.1;
    const isDusk = e <= 0.1 && e > -0.08;
    const isNight = e <= -0.08;

    // ---- gedragskeuze ----
    if (v.timer <= 0) {
      if (isDay) {
        const r = rng();
        if (r < 0.55) {
          const p = villagePoint(v.village, 22);
          if (walkable(p[0], p[1])) { v.tx = p[0]; v.tz = p[1]; v.state = 'walk'; }
          v.timer = 4 + rng() * 6;
        } else if (r < 0.8) {
          v.state = 'work'; v.timer = 3 + rng() * 5;
        } else {
          v.state = 'idle'; v.timer = 2 + rng() * 4;
        }
      } else if (isDusk) {
        v.state = 'gohome'; v.tx = v.door.x; v.tz = v.door.z; v.timer = 20;
      } else if (isNight) {
        if (v.carriesTorch && nightAmt < 0.85) {
          // avondwandeling met fakkel
          const p = villagePoint(v.village, 14);
          if (walkable(p[0], p[1])) { v.tx = p[0]; v.tz = p[1]; v.state = 'torchwalk'; }
          v.timer = 5 + rng() * 6;
        } else {
          v.state = 'inside'; v.tx = v.home.x; v.tz = v.home.z; v.timer = 6 + rng() * 8;
        }
      }
    }

    // ---- beweging ----
    const walking = (v.state === 'walk' || v.state === 'gohome' || v.state === 'torchwalk' ||
      (v.state === 'inside' && Math.hypot(v.tx - v.x, v.tz - v.z) > 0.8));
    if (walking) {
      const dx = v.tx - v.x, dz = v.tz - v.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) {
        if (v.state === 'gohome') { v.state = 'inside'; v.tx = v.home.x; v.tz = v.home.z; }
        else v.state = 'idle';
        v.timer = Math.min(v.timer, 1 + rng() * 3);
      } else {
        const step = Math.min(d, v.speed * dt);
        const nx = v.x + (dx / d) * step, nz = v.z + (dz / d) * step;
        const gy = Chunks.walkGroundY(nx, nz, v.y);
        const blockAt = Chunks.getBlock(Math.floor(nx), gy, Math.floor(nz));
        if (blockAt === B.WATER || Math.abs((gy + 1) - v.y) > 1.6) {
          // geblokkeerd: nieuw doel
          const p = villagePoint(v.village, 18);
          v.tx = p[0]; v.tz = p[1];
        } else {
          v.x = nx; v.z = nz;
          v.y += ((gy + 1) - v.y) * Math.min(1, dt * 10);
          v.heading = Math.atan2(dx, dz);
        }
      }
    }

    // ---- animatie ----
    const m = v.mesh;
    m.position.set(v.x, v.y, v.z);
    m.rotation.y += (v.heading - m.rotation.y) * Math.min(1, dt * 8);
    const swing = walking ? Math.sin(t * 7 + v.phase) * 0.5 : 0;
    v.parts.legs.rotation.x = swing * 0.8;
    v.parts.armL.rotation.x = -swing;
    v.parts.armR.rotation.x = swing;
    if (v.state === 'work') {
      v.workBob += dt * 6;
      v.parts.armR.rotation.x = -0.8 + Math.sin(v.workBob) * 0.6;
      m.position.y = v.y + Math.max(0, Math.sin(v.workBob * 0.5)) * 0.03;
    }
    v.parts.head.rotation.y = Math.sin(t * 0.6 + v.phase) * 0.3;

    // ---- fakkel 's nachts ----
    const showTorch = v.carriesTorch && (isNight || (isDusk && v.state !== 'inside')) && v.state !== 'inside';
    v.parts.torch.visible = showTorch;
    if (showTorch) {
      E.extraTorches.push({ x: v.x + Math.sin(v.heading) * 0.3, y: v.y + 1.35, z: v.z + Math.cos(v.heading) * 0.3 });
      v.parts.glowPlane.lookAt(window.__cam ? __cam.position : m.position);
    }

    // binnen: verstop bewoners half onder het maaiveld van hun huis? Nee — gewoon binnen laten staan.
  }

  // ---- dieren --------------------------------------------------------------------------
  function buildSheep(seedN) {
    const r = Noise.rng(seedN);
    const woolC = [0xf2f0ea, 0xe8e2d4, 0xd8cfc0, 0xbfb6a8][(r() * 4) | 0];
    const g = new THREE.Group();
    const bodyM = new THREE.Mesh(box(0.9, 0.62, 1.25), mat(woolC));
    bodyM.position.y = 0.75; bodyM.castShadow = true; g.add(bodyM);
    const headM = new THREE.Mesh(box(0.4, 0.4, 0.42), mat(0xd8c4a8));
    headM.position.set(0, 1.0, 0.75); g.add(headM);
    for (const [lx, lz] of [[-0.28, 0.42], [0.28, 0.42], [-0.28, -0.42], [0.28, -0.42]]) {
      const leg = new THREE.Mesh(box(0.16, 0.45, 0.16), mat(0xcbb79a));
      leg.position.set(lx, 0.225, lz); g.add(leg);
    }
    return g;
  }
  function buildRabbit(seedN) {
    const r = Noise.rng(seedN);
    const c = [0xa8906e, 0x8a7458, 0xc2b39a, 0x6e5f4c][(r() * 4) | 0];
    const g = new THREE.Group();
    const bodyM = new THREE.Mesh(box(0.32, 0.26, 0.44), mat(c));
    bodyM.position.y = 0.2; bodyM.castShadow = true; g.add(bodyM);
    const headM = new THREE.Mesh(box(0.22, 0.22, 0.22), mat(c));
    headM.position.set(0, 0.36, 0.26); g.add(headM);
    for (const ex of [-0.06, 0.06]) {
      const ear = new THREE.Mesh(box(0.06, 0.24, 0.04), mat(c));
      ear.position.set(ex, 0.56, 0.24); g.add(ear);
    }
    return g;
  }

  let animalSpawnTimer = 4;
  function trySpawnAnimal(playerPos) {
    if (animals.length >= 34) return;
    const a = rng() * Math.PI * 2;
    const d = 30 + rng() * 40;
    const x = playerPos.x + Math.cos(a) * d;
    const z = playerPos.z + Math.sin(a) * d;
    const gy = Chunks.groundY(x, z);
    const surf = Chunks.getBlock(Math.floor(x), gy, Math.floor(z));
    if (surf !== B.GRASS) return;
    const kind = rng() < 0.55 ? 'sheep' : 'rabbit';
    const seedN = (Math.floor(x) * 341873 ^ Math.floor(z) * 132897) >>> 0;
    const groupN = kind === 'sheep' ? 1 + ((rng() * 3) | 0) : 1 + ((rng() * 2) | 0);
    for (let i = 0; i < groupN && animals.length < 36; i++) {
      const mesh = kind === 'sheep' ? buildSheep(seedN + i) : buildRabbit(seedN + i);
      const an = {
        type: kind, mesh,
        x: x + (rng() - 0.5) * 4, z: z + (rng() - 0.5) * 4, y: gy + 1,
        tx: x, tz: z, state: 'idle', timer: rng() * 4,
        speed: kind === 'rabbit' ? 2.4 : 0.85, phase: rng() * 10, heading: rng() * 6.28,
        hop: 0,
      };
      an.y = Chunks.groundY(an.x, an.z) + 1;
      mesh.position.set(an.x, an.y, an.z);
      scene.add(mesh);
      animals.push(an);
    }
  }

  function updateAnimal(an, dt, t, playerPos) {
    an.timer -= dt;
    if (an.timer <= 0) {
      const r = rng();
      if (r < 0.45) {
        an.tx = an.x + (rng() - 0.5) * 14;
        an.tz = an.z + (rng() - 0.5) * 14;
        an.state = 'walk';
        an.timer = 3 + rng() * 5;
      } else if (r < 0.75 && an.type === 'sheep') {
        an.state = 'graze'; an.timer = 3 + rng() * 4;
      } else {
        an.state = 'idle'; an.timer = 2 + rng() * 4;
      }
    }
    if (an.state === 'walk') {
      const dx = an.tx - an.x, dz = an.tz - an.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) { an.state = 'idle'; }
      else {
        const step = Math.min(d, an.speed * dt);
        const nx = an.x + (dx / d) * step, nz = an.z + (dz / d) * step;
        const gy = Chunks.walkGroundY(nx, nz, an.y);
        const bl = Chunks.getBlock(Math.floor(nx), gy, Math.floor(nz));
        if (bl === B.WATER || Math.abs((gy + 1) - an.y) > 1.4) { an.state = 'idle'; an.timer = 1; }
        else {
          an.x = nx; an.z = nz;
          an.y += ((gy + 1) - an.y) * Math.min(1, dt * 10);
          an.heading = Math.atan2(dx, dz);
        }
      }
    }
    const m = an.mesh;
    let yOff = 0;
    if (an.type === 'rabbit' && an.state === 'walk') {
      an.hop += dt * 9;
      yOff = Math.abs(Math.sin(an.hop)) * 0.22;
    }
    if (an.state === 'graze') {
      m.children[1].position.y = 0.62 + Math.sin(t * 2 + an.phase) * 0.12 - 0.25;
    } else if (an.type === 'sheep') {
      m.children[1].position.y = 1.0;
    }
    m.position.set(an.x, an.y + yOff, an.z);
    m.rotation.y += (an.heading - m.rotation.y) * Math.min(1, dt * 6);
  }

  // ---- vogels ---------------------------------------------------------------------------
  function buildBird(c) {
    const g = new THREE.Group();
    const bodyM = new THREE.Mesh(box(0.12, 0.1, 0.3), mat(c));
    g.add(bodyM);
    const wingGeo = new THREE.PlaneGeometry(0.42, 0.2);
    const wingMat = new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
    const wl = new THREE.Mesh(wingGeo, wingMat);
    wl.position.x = -0.24; g.add(wl);
    const wr = new THREE.Mesh(wingGeo, wingMat);
    wr.position.x = 0.24; g.add(wr);
    return { g, wl, wr };
  }

  function spawnFlock(playerPos) {
    const colors = [0x3a3f47, 0x6e5a48, 0x8a8f96, 0x4a5568];
    const c = colors[(rng() * colors.length) | 0];
    const n = 4 + ((rng() * 5) | 0);
    const birds = [];
    for (let i = 0; i < n; i++) {
      const b = buildBird(c);
      scene.add(b.g);
      birds.push({ parts: b, off: [(rng() - 0.5) * 6, (rng() - 0.5) * 3, (rng() - 0.5) * 6], phase: rng() * 10 });
    }
    flocks.push({
      birds,
      cx: playerPos.x + (rng() - 0.5) * 120,
      cz: playerPos.z + (rng() - 0.5) * 120,
      r: 20 + rng() * 30,
      h: 22 + rng() * 18,
      a: rng() * Math.PI * 2,
      speed: 0.12 + rng() * 0.12,
    });
  }

  function updateFlocks(dt, t, playerPos, nightAmt) {
    const targetFlocks = nightAmt > 0.5 ? 0 : 3;
    if (flocks.length < targetFlocks && rng() < dt * 0.2) spawnFlock(playerPos);
    for (let i = flocks.length - 1; i >= 0; i--) {
      const f = flocks[i];
      f.a += f.speed * dt;
      // zwerm drijft langzaam mee met de speler
      f.cx += (playerPos.x - f.cx) * dt * 0.01;
      f.cz += (playerPos.z - f.cz) * dt * 0.01;
      const lead = {
        x: f.cx + Math.cos(f.a) * f.r,
        z: f.cz + Math.sin(f.a) * f.r,
      };
      const groundH = Chunks.groundY(lead.x, lead.z);
      const ly = Math.max(groundH + 12, G.SEA + 8) + f.h * 0.4 + Math.sin(f.a * 2.3) * 3;
      let gone = nightAmt > 0.5 || Math.hypot(lead.x - playerPos.x, lead.z - playerPos.z) > 220;
      for (let bi = 0; bi < f.birds.length; bi++) {
        const b = f.birds[bi];
        const bx = lead.x + b.off[0], by = ly + b.off[1], bz = lead.z + b.off[2];
        b.parts.g.position.set(bx, by, bz);
        b.parts.g.rotation.y = -f.a - Math.PI / 2;
        const flap = Math.sin(t * 11 + b.phase) * 0.9;
        b.parts.wl.rotation.z = flap;
        b.parts.wr.rotation.z = -flap;
      }
      if (gone) {
        for (const b of f.birds) scene.remove(b.parts.g);
        flocks.splice(i, 1);
      }
    }
  }

  // ---- vuurvliegjes ------------------------------------------------------------------------
  const FIREFLY_N = 90;
  function initFireflies() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(FIREFLY_N * 3);
    const col = new Float32Array(FIREFLY_N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const fmat = new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    fireflies = new THREE.Points(geo, fmat);
    fireflies.frustumCulled = false;
    scene.add(fireflies);
    fireflyData = [];
    for (let i = 0; i < FIREFLY_N; i++) {
      fireflyData.push({ x: 0, y: -100, z: 0, phase: Math.random() * 10, drift: Math.random() * 2 + 0.4, alive: false });
    }
  }

  function updateFireflies(dt, t, playerPos, nightAmt) {
    const posA = fireflies.geometry.attributes.position;
    const colA = fireflies.geometry.attributes.color;
    const active = nightAmt > 0.25;
    for (let i = 0; i < FIREFLY_N; i++) {
      const f = fireflyData[i];
      if (!f.alive && active && rng() < dt * 0.5) {
        const a = rng() * Math.PI * 2;
        const d = 6 + rng() * 30;
        f.x = playerPos.x + Math.cos(a) * d;
        f.z = playerPos.z + Math.sin(a) * d;
        const gy = Chunks.groundY(f.x, f.z);
        const surf = Chunks.getBlock(Math.floor(f.x), gy, Math.floor(f.z));
        if (surf === B.GRASS) { f.y = gy + 1.4 + rng() * 1.5; f.alive = true; }
      }
      if (f.alive) {
        f.x += Math.sin(t * f.drift + f.phase) * dt * 0.5;
        f.z += Math.cos(t * f.drift * 0.8 + f.phase * 2) * dt * 0.5;
        f.y += Math.sin(t * 1.2 + f.phase) * dt * 0.25;
        const dd = Math.hypot(f.x - playerPos.x, f.z - playerPos.z);
        if (!active || dd > 45) f.alive = false;
        const blink = Math.max(0, Math.sin(t * 1.7 + f.phase * 3)) ** 3;
        const br = blink * nightAmt;
        posA.setXYZ(i, f.x, f.y, f.z);
        colA.setXYZ(i, 0.75 * br, 0.9 * br, 0.35 * br);
      } else {
        posA.setXYZ(i, 0, -100, 0);
        colA.setXYZ(i, 0, 0, 0);
      }
    }
    posA.needsUpdate = true;
    colA.needsUpdate = true;
  }

  // ---- hoofdinterface -------------------------------------------------------------------------
  E.init = function (theScene, seed) {
    scene = theScene;
    rng = Noise.rng((seed ^ 0x51ab3e) >>> 0);
    initLightPool();
    initFireflies();
  };

  E.reset = function () {
    for (const v of villagers) scene.remove(v.mesh);
    villagers.length = 0;
    for (const a of animals) scene.remove(a.mesh);
    animals.length = 0;
    for (const f of flocks) for (const b of f.birds) scene.remove(b.parts.g);
    flocks.length = 0;
    populatedVillages.clear();
    for (const f of fireflyData) f.alive = false;
  };

  E.update = function (dt, t, playerPos, sunInfo, camera) {
    window.__cam = camera;
    const { elevation: e, nightAmt } = sunInfo;
    E.extraTorches.length = 0;

    // dorpen in de buurt bevolken
    const v = World.nearestVillage(playerPos.x, playerPos.z, 130);
    if (v && !populatedVillages.has(v.key) && Chunks.getChunk(Math.floor(v.cx / G.CS), Math.floor(v.cz / G.CS))) {
      spawnVillage(World.villageLayout(v));
    }

    // bewoners
    for (let i = villagers.length - 1; i >= 0; i--) {
      const vil = villagers[i];
      const d = Math.hypot(vil.x - playerPos.x, vil.z - playerPos.z);
      if (d > 190) {
        scene.remove(vil.mesh);
        populatedVillages.delete(vil.village.key);
        villagers.splice(i, 1);
        continue;
      }
      if (d < 110) updateVillager(vil, dt, e, nightAmt, t);
    }

    // dieren
    animalSpawnTimer -= dt;
    if (animalSpawnTimer <= 0) { animalSpawnTimer = 3; trySpawnAnimal(playerPos); }
    for (let i = animals.length - 1; i >= 0; i--) {
      const an = animals[i];
      if (Math.hypot(an.x - playerPos.x, an.z - playerPos.z) > 95) {
        scene.remove(an.mesh);
        animals.splice(i, 1);
        continue;
      }
      updateAnimal(an, dt, t, playerPos);
    }

    updateFlocks(dt, t, playerPos, nightAmt);
    updateFireflies(dt, t, playerPos, nightAmt);
    updateLightPool(camera.position, t);
  };

  return E;
})();
