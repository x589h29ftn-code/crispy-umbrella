// Speler: besturing (pointer lock), fysica met blok-collisions, zwemmen,
// blokken plaatsen/weghalen en een fakkel in de hand.
window.Player = (function () {
  const P = {};
  const B = G.B;

  const SIZE = { w: 0.6, h: 1.8, eye: 1.62 };
  const GRAV = 24, JUMP = 8.2, SPEED = 4.4, SPRINT = 6.8, SWIM = 3.0;

  P.pos = new THREE.Vector3(8, 60, 8);
  P.vel = new THREE.Vector3();
  P.yaw = 0; P.pitch = 0;
  P.onGround = false;
  P.inWater = false;
  P.hotbarSel = 0;
  P.holdingTorch = false;
  P.ridingBoat = null;

  let camera = null, dom = null;
  const keys = {};
  let torchLight = null, torchModel = null;
  let stepDist = 0;

  P.init = function (theCamera, theDom, scene) {
    camera = theCamera; dom = theDom;

    // fakkellicht + model in beeld
    torchLight = new THREE.PointLight(0xffa85e, 0, 15, 2);
    torchLight.visible = false;
    scene.add(torchLight);

    torchModel = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x6e5634 }));
    torchModel.add(stick);
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({
        map: Textures.texture, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    const [u0, v0, u1, v1] = Textures.uv(Textures.TI.FLAME);
    const uvA = flame.geometry.attributes.uv;
    uvA.setXY(0, u0, v1); uvA.setXY(1, u1, v1); uvA.setXY(2, u0, v0); uvA.setXY(3, u1, v0);
    flame.position.y = 0.22;
    torchModel.add(flame);
    torchModel.visible = false;
    camera.add(torchModel);
    torchModel.position.set(0.32, -0.28, -0.5);

    // ---- input ----
    document.addEventListener('keydown', (e) => {
      if (G.state !== 'playing') return;
      keys[e.code] = true;
      if (e.code.startsWith('Digit')) {
        const n = +e.code.slice(5);
        if (n >= 1 && n <= G.HOTBAR.length) { P.hotbarSel = n - 1; UI.refreshHotbar(); }
      }
      if (e.code === 'KeyF') {
        P.holdingTorch = !P.holdingTorch;
        UI.hint(P.holdingTorch ? 'Fakkel in de hand 🔥' : 'Fakkel opgeborgen');
      }
      if (e.code === 'F1') { e.preventDefault(); UI.toggleHud(); }
      if (e.code === 'F2') { e.preventDefault(); Main.captureScreenshot(); }
      if (e.code === 'KeyC' && window.Fishing) Fishing.toggle(P.pos, P.yaw);
      if (e.code === 'KeyE') toggleBoat();
      if (e.code === 'KeyB' && !P.ridingBoat) {
        const boat = Boats.placeInFront(P.pos, P.yaw);
        if (boat) UI.hint('Bootje te water gelaten 🛶 — druk op E om in te stappen');
        else UI.hint('Geen open water in de buurt om een bootje neer te zetten.');
      }
    });
    document.addEventListener('keyup', (e) => { keys[e.code] = false; });

    document.addEventListener('mousemove', (e) => {
      if (G.state !== 'playing' || document.pointerLockElement !== dom) return;
      P.yaw -= e.movementX * 0.0023;
      P.pitch -= e.movementY * 0.0023;
      P.pitch = Noise.clamp(P.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    });

    dom.addEventListener('mousedown', (e) => {
      if (G.state !== 'playing' || document.pointerLockElement !== dom) return;
      if (e.button === 0) breakBlock();
      else if (e.button === 2) placeBlock();
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      if (G.state !== 'playing') return;
      P.hotbarSel = (P.hotbarSel + (e.deltaY > 0 ? 1 : -1) + G.HOTBAR.length) % G.HOTBAR.length;
      UI.refreshHotbar();
    });
  };

  P.spawn = function () {
    // vind een mooie plek boven zeeniveau dicht bij de oorsprong
    let sx = 8, sz = 8;
    for (let r = 0; r < 400; r += 8) {
      const h = World.height(sx, sz);
      const rf = World.riverFactor(sx, sz);
      if (h > G.SEA + 2 && h < G.SEA + 22 && rf < 0.2) break;
      sx += 11; sz += 7;
    }
    const h = World.height(sx, sz);
    P.pos.set(sx + 0.5, h + 2.5, sz + 0.5);
    P.vel.set(0, 0, 0);
    P.resting = null;
    P.yaw = Math.PI * 0.25;
    P.pitch = -0.05;
  };

  // ---- collision helpers ----
  function solidAt(x, y, z) {
    return Chunks.solidShapeAt(x, y, z);
  }

  // Kompasrichting waar de speler naar kijkt: 0=-z, 1=+x, 2=+z, 3=-x
  function facingFromYaw(yaw) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
    return fz > 0 ? 2 : 0;
  }

  function collide(px, py, pz) {
    const hw = SIZE.w / 2;
    for (const ox of [-hw, hw]) for (const oz of [-hw, hw]) {
      for (const oy of [0.05, 0.9, SIZE.h - 0.05]) {
        if (solidAt(px + ox, py + oy, pz + oz)) return true;
      }
    }
    return false;
  }

  function blockAtEye() {
    return Chunks.getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y + SIZE.eye - 0.15), Math.floor(P.pos.z));
  }

  // ---- raycast (DDA) voor blok-selectie ----
  const rayDir = new THREE.Vector3();
  P.raycast = function (maxDist) {
    camera.getWorldDirection(rayDir);
    let x = Math.floor(camera.position.x);
    let y = Math.floor(camera.position.y);
    let z = Math.floor(camera.position.z);
    const stepX = rayDir.x > 0 ? 1 : -1;
    const stepY = rayDir.y > 0 ? 1 : -1;
    const stepZ = rayDir.z > 0 ? 1 : -1;
    const tDX = Math.abs(1 / (rayDir.x || 1e-9));
    const tDY = Math.abs(1 / (rayDir.y || 1e-9));
    const tDZ = Math.abs(1 / (rayDir.z || 1e-9));
    let tMaxX = ((stepX > 0 ? (x + 1 - camera.position.x) : (camera.position.x - x))) * tDX;
    let tMaxY = ((stepY > 0 ? (y + 1 - camera.position.y) : (camera.position.y - y))) * tDY;
    let tMaxZ = ((stepZ > 0 ? (z + 1 - camera.position.z) : (camera.position.z - z))) * tDZ;
    let face = [0, 0, 0];
    let t = 0;
    while (t < maxDist) {
      const b = Chunks.getBlock(x, y, z);
      if (b !== undefined && b !== B.AIR && b !== B.WATER) {
        return { x, y, z, block: b, face };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDX; face = [-stepX, 0, 0]; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDY; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDZ; face = [0, 0, -stepZ]; }
    }
    return null;
  };

  function breakBlock() {
    const hit = P.raycast(6);
    if (!hit) return;
    if (hit.y <= 1) { UI.hint('De bodem van de wereld is te hard.'); return; }
    // deur: beide helften weghalen
    if (hit.block === B.DOOR) {
      const m = Chunks.getMeta(hit.x, hit.y, hit.z);
      const by = (m & 8) ? hit.y - 1 : hit.y;
      Chunks.setBlock(hit.x, by, hit.z, B.AIR);
      Chunks.setBlock(hit.x, by + 1, hit.z, B.AIR);
      Sfx.dig(B.PLANKS);
      return;
    }
    Chunks.setBlock(hit.x, hit.y, hit.z, B.AIR);
    // plantje/fakkel bovenop een gesloopt blok verwijderen
    const above = Chunks.getBlock(hit.x, hit.y + 1, hit.z);
    if (above !== undefined && (G.isCross(above) || above === B.TORCH || above === B.CAMPFIRE)) {
      Chunks.setBlock(hit.x, hit.y + 1, hit.z, B.AIR);
    }
    if (window.WaterSim) WaterSim.onEdit(hit.x, hit.y, hit.z);
    Sfx.dig(hit.block);
  }

  // Zitten op een stoel of uitrusten/slapen op bed.  Het lichaam blijft staan;
  // alleen de camera zakt naar de zit-/lighoogte tot je weer beweegt.
  P.resting = null;
  P.sitOn = function (x, y, z, bed) {
    P.resting = { x: x + 0.5, z: z + 0.5, eyeY: y + (bed ? 0.5 : 1.05), bed };
    P.vel.set(0, 0, 0);
    if (bed) {
      const el = G.sunElevation();
      if (el < 0.05) {
        // doorslapen tot zonsopgang (begin van de volgende dagcyclus)
        const cyc = G.cycleLen();
        const tt = ((G.timeSec % cyc) + cyc) % cyc;
        G.timeSec += (cyc - tt) + 0.5;
        G.dayNumber++;
        UI.hint('Je sliep tot zonsopgang ☀️');
      } else {
        UI.hint('Je rust wat uit op bed (beweeg om op te staan)');
      }
    } else {
      UI.hint('Even zitten en genieten 🔥 (beweeg om op te staan)');
    }
  };

  function toggleDoor(hit) {
    const m = Chunks.getMeta(hit.x, hit.y, hit.z);
    const by = (m & 8) ? hit.y - 1 : hit.y;
    const bm = Chunks.getMeta(hit.x, by, hit.z);
    const tm = Chunks.getMeta(hit.x, by + 1, hit.z);
    Chunks.setBlock(hit.x, by, hit.z, B.DOOR, true, bm ^ 1);
    Chunks.setBlock(hit.x, by + 1, hit.z, B.DOOR, true, tm ^ 1);
    Sfx.dig(B.PLANKS);
  }

  function placeBlock() {
    const hit = P.raycast(6);
    if (!hit) return;
    // rechtsklik op een deur/hekpoort = openen/sluiten
    if (hit.block === B.DOOR) { toggleDoor(hit); return; }
    if (hit.block === B.FENCE_GATE) {
      const m = Chunks.getMeta(hit.x, hit.y, hit.z);
      Chunks.setBlock(hit.x, hit.y, hit.z, B.FENCE_GATE, true, m ^ 1);
      Sfx.dig(B.PLANKS);
      return;
    }
    // rechtsklik op stoel = zitten, op bed = uitrusten/slapen
    if (hit.block === B.CHAIR) { P.sitOn(hit.x, hit.y, hit.z, false); return; }
    if (hit.block === B.BED) { P.sitOn(hit.x, hit.y, hit.z, true); return; }

    const id = G.HOTBAR[P.hotbarSel];
    let tx = hit.x + hit.face[0], ty = hit.y + hit.face[1], tz = hit.z + hit.face[2];
    const target = Chunks.getBlock(tx, ty, tz);
    if (target === undefined) return;
    if (target !== B.AIR && target !== B.WATER && !G.isCross(target) && target !== B.TORCH) return;

    // niet in jezelf bouwen (dingen zonder collision mogen wel)
    const solidPlace = G.isSolid(id) && id !== B.CAMPFIRE;
    if (solidPlace) {
      const hw = SIZE.w / 2;
      const px = P.pos.x, py = P.pos.y, pz = P.pos.z;
      if (tx + 1 > px - hw && tx < px + hw && tz + 1 > pz - hw && tz < pz + hw &&
          ty + 1 > py && ty < py + SIZE.h) { return; }
    }

    // fakkel/lantaarn/kampvuur/gewas/meubel/lavendel hebben een dragend blok nodig
    if (id === B.TORCH || id === B.LANTERN || id === B.CAMPFIRE || id === B.CROP ||
        id === B.CHAIR || id === B.TABLE || id === B.BED || id === B.LAVENDER) {
      const below = Chunks.getBlock(tx, ty - 1, tz);
      if (!G.occludes(below) && below !== B.FENCE) {
        UI.hint(id === B.CROP ? 'Graan heeft grond nodig om te groeien.'
          : (id === B.LAVENDER ? 'Lavendel heeft grond nodig.' : 'Dit heeft een stevige ondergrond nodig.'));
        return;
      }
    }

    if (id === B.STAIRS) {
      Chunks.setBlock(tx, ty, tz, id, true, facingFromYaw(P.yaw));
    } else if (id === B.CHAIR) {
      Chunks.setBlock(tx, ty, tz, id, true, facingFromYaw(P.yaw));
    } else if (id === B.FENCE_GATE) {
      Chunks.setBlock(tx, ty, tz, id, true, facingFromYaw(P.yaw) << 1);   // dicht, met richting
    } else if (id === B.DOOR) {
      const above = Chunks.getBlock(tx, ty + 1, tz);
      if (above !== B.AIR && !G.isCross(above)) { UI.hint('Een deur heeft twee blokken hoogte nodig.'); return; }
      const facing = facingFromYaw(P.yaw);
      Chunks.setBlock(tx, ty, tz, id, true, (facing << 1));           // onderste helft
      Chunks.setBlock(tx, ty + 1, tz, id, true, (facing << 1) | 8);  // bovenste helft
    } else if (id === B.CROP) {
      // graan zaaien (fase 1); onder gras/aarde wordt akkergrond
      const below = Chunks.getBlock(tx, ty - 1, tz);
      if (below === B.GRASS || below === B.DIRT) Chunks.setBlock(tx, ty - 1, tz, B.FARMLAND);
      Chunks.setBlock(tx, ty, tz, id, true, 1);
      if (window.Crops) Crops.plant(tx, ty, tz);
      UI.hint('Graan gezaaid 🌾 — het groeit vanzelf');
    } else if (id === B.WATER) {
      // stromend water: plaats een bron
      if (window.WaterSim) WaterSim.placeSource(tx, ty, tz);
      else Chunks.setBlock(tx, ty, tz, B.WATER);
    } else {
      Chunks.setBlock(tx, ty, tz, id);
    }
    if (window.WaterSim && id !== B.WATER) WaterSim.onEdit(tx, ty, tz);
    Sfx.place(id);
  }

  // ---- bootjes ----
  function toggleBoat() {
    if (P.ridingBoat) {
      // uitstappen: zoek een droge, beloopbare plek naast de boot
      const b = P.ridingBoat;
      let placed = false;
      for (let r = 1; r <= 3 && !placed; r++) {
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
          const ex = Math.floor(b.x) + dx + 0.5, ez = Math.floor(b.z) + dz + 0.5;
          if (Boats.isWater(ex, ez)) continue;
          const gy = Chunks.groundY(ex, ez);
          const surf = Chunks.getBlock(Math.floor(ex), gy, Math.floor(ez));
          if (surf !== undefined && surf !== B.WATER) {
            P.pos.set(ex, gy + 1, ez); placed = true; break;
          }
        }
      }
      if (!placed) P.pos.set(b.x, Boats.WATER_Y + 1.2, b.z);
      P.vel.set(0, 0, 0);
      b.active = false;
      Boats.ridden = null;
      P.ridingBoat = null;
      UI.hint('Uitgestapt');
    } else {
      const boat = Boats.nearest(P.pos, 3.6);
      if (boat) {
        P.ridingBoat = boat;
        boat.active = true;
        Boats.ridden = boat;
        P.vel.set(0, 0, 0);
        UI.hint('Varen! W/S peddelen, A/D sturen — E om uit te stappen 🛶');
      }
    }
  }

  function rideBoat(dt, t) {
    const b = P.ridingBoat;
    let fwd = 0, turn = 0;
    if (keys['KeyW']) fwd += 1;
    if (keys['KeyS']) fwd -= 0.6;
    if (keys['KeyA']) turn -= 1;
    if (keys['KeyD']) turn += 1;
    Boats.drive(b, fwd, turn, dt, t);
    const seat = Boats.seat(b);
    P.pos.set(seat.x, seat.y, seat.z);
    camera.position.set(seat.x, seat.y + SIZE.eye - 0.4, seat.z);

    torchModel.visible = P.holdingTorch;
    torchLight.visible = P.holdingTorch;
    if (P.holdingTorch) {
      torchLight.position.set(seat.x, seat.y + 1, seat.z);
      torchLight.intensity = 1.3 + Math.sin(t * 11) * 0.15;
    }
  }

  // ---- hoofd-update ----
  P.update = function (dt, t) {
    dt = Math.min(dt, 0.05);

    // kijkrichting
    camera.rotation.order = 'YXZ';
    camera.rotation.y = P.yaw;
    camera.rotation.x = P.pitch;

    // zittend/rustend: camera op de zithoogte, opstaan bij bewegingsinvoer
    if (P.resting) {
      if (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || keys['Space']) {
        P.resting = null;
      } else {
        const r = P.resting;
        camera.position.set(r.x, r.eyeY, r.z);
        torchModel.visible = false;
        torchLight.visible = false;
        return;
      }
    }

    if (P.ridingBoat && P.ridingBoat.active) { rideBoat(dt, t); return; }

    // waterstatus
    const feet = Chunks.getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y + 0.3), Math.floor(P.pos.z));
    const wasInWater = P.inWater;
    P.inWater = feet === B.WATER;
    if (P.inWater && !wasInWater && Math.abs(P.vel.y) > 4) Sfx.splash();

    // gewenste beweging
    let fw = 0, sd = 0;
    if (keys['KeyW']) fw += 1;
    if (keys['KeyS']) fw -= 1;
    if (keys['KeyD']) sd += 1;
    if (keys['KeyA']) sd -= 1;
    const sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = P.inWater ? SWIM : (sprinting ? SPRINT : SPEED);
    const sin = Math.sin(P.yaw), cos = Math.cos(P.yaw);
    const mx = (-sin * fw + cos * sd);
    const mz = (-cos * fw - sin * sd);
    const mlen = Math.hypot(mx, mz) || 1;

    const accel = P.onGround ? 40 : 12;
    P.vel.x += ((mx / mlen) * speed * (fw || sd ? 1 : 0) - P.vel.x) * Math.min(1, accel * dt / speed);
    P.vel.z += ((mz / mlen) * speed * (fw || sd ? 1 : 0) - P.vel.z) * Math.min(1, accel * dt / speed);

    // zwaartekracht & springen
    if (P.inWater) {
      P.vel.y -= GRAV * 0.25 * dt;
      P.vel.y *= (1 - Math.min(1, dt * 3));
      if (keys['Space']) P.vel.y += 18 * dt;
    } else {
      P.vel.y -= GRAV * dt;
      if (keys['Space'] && P.onGround) { P.vel.y = JUMP; P.onGround = false; }
    }
    P.vel.y = Noise.clamp(P.vel.y, -42, 20);

    // per as bewegen en botsen, met automatisch opstappen (trapjes/platen)
    const canStep = P.onGround || P.inWater;
    let nx = P.pos.x + P.vel.x * dt;
    if (!collide(nx, P.pos.y, P.pos.z)) P.pos.x = nx;
    else if (canStep && !collide(nx, P.pos.y + 0.55, P.pos.z)) { P.pos.x = nx; P.pos.y += 0.52; }
    else P.vel.x = 0;
    let nz = P.pos.z + P.vel.z * dt;
    if (!collide(P.pos.x, P.pos.y, nz)) P.pos.z = nz;
    else if (canStep && !collide(P.pos.x, P.pos.y + 0.55, nz)) { P.pos.z = nz; P.pos.y += 0.52; }
    else P.vel.z = 0;
    let ny = P.pos.y + P.vel.y * dt;
    if (!collide(P.pos.x, ny, P.pos.z)) {
      P.pos.y = ny;
      P.onGround = false;
    } else {
      if (P.vel.y < 0) P.onGround = true;
      P.vel.y = 0;
    }

    // uit de wereld gevallen? terug naar boven
    if (P.pos.y < -10) {
      P.pos.y = World.height(Math.floor(P.pos.x), Math.floor(P.pos.z)) + 3;
      P.vel.set(0, 0, 0);
    }

    // voetstappen
    const hv = Math.hypot(P.vel.x, P.vel.z);
    if (P.onGround && hv > 1) {
      stepDist += hv * dt;
      if (stepDist > 2.1) {
        stepDist = 0;
        const under = Chunks.getBlock(Math.floor(P.pos.x), Math.floor(P.pos.y - 0.5), Math.floor(P.pos.z));
        if (under !== undefined && under !== B.AIR) Sfx.step(under);
      }
    }

    // camera + hoofddobber
    const bob = (P.onGround && hv > 0.5) ? Math.sin(t * 9) * 0.04 * Math.min(1, hv / SPEED) : 0;
    camera.position.set(P.pos.x, P.pos.y + SIZE.eye + bob, P.pos.z);

    // fakkel in de hand
    torchModel.visible = P.holdingTorch;
    torchLight.visible = P.holdingTorch;
    if (P.holdingTorch) {
      torchLight.position.set(
        P.pos.x - Math.sin(P.yaw) * 0.4,
        P.pos.y + SIZE.eye,
        P.pos.z - Math.cos(P.yaw) * 0.4);
      torchLight.intensity = 1.3 + Math.sin(t * 11) * 0.15 + Math.sin(t * 27) * 0.07;
      torchModel.rotation.z = Math.sin(t * 2.2) * 0.05;
    }
  };

  // in-water-effect voor de fog e.d.
  P.eyeInWater = function () {
    return blockAtEye() === B.WATER;
  };

  P.serialize = function () {
    return {
      pos: [P.pos.x, P.pos.y, P.pos.z],
      yaw: P.yaw, pitch: P.pitch,
      hotbarSel: P.hotbarSel, holdingTorch: P.holdingTorch,
    };
  };
  P.deserialize = function (d) {
    if (!d) return;
    P.pos.set(d.pos[0], d.pos[1], d.pos[2]);
    P.yaw = d.yaw || 0; P.pitch = d.pitch || 0;
    P.hotbarSel = d.hotbarSel || 0;
    P.holdingTorch = !!d.holdingTorch;
    P.vel.set(0, 0, 0);
  };

  return P;
})();
