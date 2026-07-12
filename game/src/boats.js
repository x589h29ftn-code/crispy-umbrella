// Bootjes: houten roeibootjes die op rivieren en meren drijven. Spawnt langs
// oevers, kan door de speler op het water gezet worden, en is bestuurbaar.
window.Boats = (function () {
  const Bo = {};
  const B = G.B, SEA = G.SEA;
  let scene = null;
  let rng = Math.random;
  const boats = [];
  let spawnTimer = 2;

  Bo.ridden = null;
  Bo.WATER_Y = SEA + 0.74;      // drijfhoogte van de bootbodem (op de waterlijn)

  // ---- bootmodel (planken + zitplank) ------------------------------------------
  function plankMat(c) { return new THREE.MeshLambertMaterial({ color: c }); }
  function buildBoatMesh(seedN) {
    const r = Noise.rng(seedN);
    const hull = [0x8a6a3e, 0x9a7648, 0x7d5c34, 0xa07c4a][(r() * 4) | 0];
    const trim = new THREE.Color(hull).multiplyScalar(0.78).getHex();
    const g = new THREE.Group();
    const L = 2.4, W = 1.3, H = 0.5;

    function box(w, h, d, x, y, z, c) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plankMat(c));
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    }
    // bodem
    box(W, 0.14, L, 0, 0, 0, trim);
    // zijwanden
    box(0.12, H, L, -W / 2 + 0.06, H / 2 - 0.02, 0, hull);
    box(0.12, H, L, W / 2 - 0.06, H / 2 - 0.02, 0, hull);
    // boeg en spiegel (met lichte punt vooraan)
    box(W, H, 0.12, 0, H / 2 - 0.02, -L / 2 + 0.06, hull);
    box(W, H, 0.12, 0, H / 2 - 0.02, L / 2 - 0.06, hull);
    const bow = box(W * 0.7, H * 0.9, 0.4, 0, H / 2 - 0.04, -L / 2 - 0.05, hull);
    bow.rotation.x = 0.25;
    // zitplank
    box(W - 0.2, 0.1, 0.5, 0, H - 0.06, 0.1, trim);
    // riemen
    for (const side of [-1, 1]) {
      const oar = box(0.06, 0.06, 1.4, side * (W / 2 + 0.05), H - 0.1, 0.1, 0x6e5636);
      oar.rotation.z = side * 0.5;
      oar.rotation.x = 0.15;
    }
    return g;
  }

  Bo.init = function (theScene, seed) {
    scene = theScene;
    rng = Noise.rng((seed ^ 0x30a7c1) >>> 0);
    Bo.reset();
  };
  Bo.reset = function () {
    for (const b of boats) scene.remove(b.mesh);
    boats.length = 0;
    Bo.ridden = null;
    spawnTimer = 2;
  };

  // ---- water-tests -------------------------------------------------------------
  Bo.isWater = function (x, z) {
    return Chunks.getBlock(Math.floor(x), SEA, Math.floor(z)) === B.WATER;
  };
  // open water: het blok en de vier buren zijn water (voorkomt vastzitten in randen)
  function openWater(x, z) {
    if (!Bo.isWater(x, z)) return false;
    let n = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Bo.isWater(x + dx, z + dz)) n++;
    return n >= 2;
  }

  function spawnBoat(x, z, seedN) {
    const mesh = buildBoatMesh(seedN);
    const boat = {
      mesh, x, z, y: Bo.WATER_Y, yaw: rng() * Math.PI * 2,
      vel: 0, turnVel: 0, bob: rng() * 10, active: false,
    };
    mesh.position.set(x, boat.y, z);
    mesh.rotation.y = boat.yaw;
    scene.add(mesh);
    boats.push(boat);
    return boat;
  }

  // ---- automatisch spawnen langs oevers ----------------------------------------
  function trySpawnNear(playerPos) {
    if (boats.length >= 10) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = rng() * Math.PI * 2;
      const d = 16 + rng() * 40;
      const x = Math.floor(playerPos.x + Math.cos(a) * d) + 0.5;
      const z = Math.floor(playerPos.z + Math.sin(a) * d) + 0.5;
      if (!openWater(x, z)) continue;
      // niet te dicht op een bestaande boot
      let tooClose = false;
      for (const b of boats) if (Math.hypot(b.x - x, b.z - z) < 12) { tooClose = true; break; }
      if (tooClose) continue;
      // alleen spawnen als er land in de buurt is (oever), zodat je 'm kunt bereiken
      let nearShore = false;
      for (let r = 1; r <= 3 && !nearShore; r++)
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]])
          if (!Bo.isWater(x + dx, z + dz)) nearShore = true;
      if (!nearShore) continue;
      spawnBoat(x, z, (Math.floor(x) * 92821 ^ Math.floor(z) * 68917) >>> 0);
      return;
    }
  }

  // ---- speler zet zelf een boot op het water -----------------------------------
  Bo.placeInFront = function (playerPos, yaw) {
    for (let dist = 2; dist <= 7; dist += 0.5) {
      const x = playerPos.x - Math.sin(yaw) * dist;
      const z = playerPos.z - Math.cos(yaw) * dist;
      if (openWater(x, z)) {
        const boat = spawnBoat(Math.floor(x) + 0.5, Math.floor(z) + 0.5,
          (Date_now() ^ (dist * 1000)) >>> 0);
        boat.yaw = yaw;
        boat.mesh.rotation.y = yaw;
        return boat;
      }
    }
    return null;
  };
  // Date.now() is in workflows verboden maar hier draaien we in de browser; toch veilig:
  function Date_now() { try { return Date.now() & 0x7fffffff; } catch (e) { return (rng() * 1e9) | 0; } }

  Bo.nearest = function (pos, range) {
    let best = null, bestD = range * range;
    for (const b of boats) {
      const d = (b.x - pos.x) ** 2 + (b.z - pos.z) ** 2 + (b.y - pos.y) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  };

  // ---- besturing (aangeroepen vanuit player.js als je vaart) -------------------
  // fwd: -1..1, turn: -1..1
  Bo.drive = function (boat, fwd, turn, dt, t) {
    boat.turnVel += (turn * 1.6 - boat.turnVel) * Math.min(1, dt * 3);
    boat.yaw -= boat.turnVel * dt;
    const accel = fwd * 4.5;
    boat.vel += (accel - boat.vel * 1.4) * Math.min(1, dt * 2.5);
    boat.vel = Noise.clamp(boat.vel, -3, 6);

    const nx = boat.x - Math.sin(boat.yaw) * boat.vel * dt;
    const nz = boat.z - Math.cos(boat.yaw) * boat.vel * dt;
    // alleen over water varen; anders afremmen tegen de oever
    if (Bo.isWater(nx, boat.z)) boat.x = nx; else boat.vel *= 0.3;
    if (Bo.isWater(boat.x, nz)) boat.z = nz; else boat.vel *= 0.3;

    boat.bob += dt;
    boat.y = Bo.WATER_Y + Math.sin(boat.bob * 1.6 + boat.x * 0.3) * 0.06;
    boat.mesh.position.set(boat.x, boat.y, boat.z);
    boat.mesh.rotation.y = boat.yaw;
    boat.mesh.rotation.z = -boat.turnVel * 0.15;
    boat.mesh.rotation.x = Math.sin(boat.bob * 1.6) * 0.03 - boat.vel * 0.02;
  };

  // zitpositie (waar de spelercamera-voeten komen)
  Bo.seat = function (boat) {
    return { x: boat.x, y: boat.y + 0.35, z: boat.z };
  };

  // ---- per-frame: spawnen, opruimen, idle-dobberen -----------------------------
  Bo.update = function (dt, playerPos) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = 3.5; trySpawnNear(playerPos); }
    for (let i = boats.length - 1; i >= 0; i--) {
      const b = boats[i];
      if (b === Bo.ridden) continue;
      if (Math.hypot(b.x - playerPos.x, b.z - playerPos.z) > 130) {
        scene.remove(b.mesh);
        boats.splice(i, 1);
        continue;
      }
      b.bob += dt;
      b.y = Bo.WATER_Y + Math.sin(b.bob * 1.3 + b.x * 0.3) * 0.05;
      b.mesh.position.y = b.y;
      b.mesh.rotation.x = Math.sin(b.bob * 1.3) * 0.025;
      b.mesh.rotation.z = Math.cos(b.bob * 1.1 + b.z * 0.2) * 0.025;
    }
  };

  return Bo;
})();
