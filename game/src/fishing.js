// Vissen: werp bij water een dobber uit, wacht op een beet en haal binnen.
// Een rustige bezigheid — geen inventaris, gewoon het genoegen van de vangst.
window.Fishing = (function () {
  const F = {};
  const SEA = G.SEA;
  let scene = null, bobber = null;
  let rng = Math.random;
  let active = false, biting = false;
  let biteTimer = 0, biteWindow = 0, t = 0;
  let bx = 0, bz = 0;

  F.init = function (theScene, seed) {
    scene = theScene;
    rng = Noise.rng((seed ^ 0x5a1b0a) >>> 0);
    if (!bobber) {
      bobber = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshLambertMaterial({ color: 0xd8402f }));
      top.position.y = 0.1;
      const bot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12),
        new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
      bobber.add(top); bobber.add(bot);
      bobber.visible = false;
      scene.add(bobber);
    }
  };
  F.reset = function () { active = false; biting = false; if (bobber) bobber.visible = false; };
  F.active = function () { return active; };

  function waterInFront(px, pz, yaw) {
    for (let d = 2; d <= 6; d += 0.5) {
      const x = px - Math.sin(yaw) * d, z = pz - Math.cos(yaw) * d;
      const water = window.Boats ? Boats.isWater(x, z) : (Chunks.getBlock(Math.floor(x), SEA, Math.floor(z)) === G.B.WATER);
      if (water) return { x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5 };
    }
    return null;
  }

  // C: uitwerpen, of binnenhalen als je al vist
  F.toggle = function (playerPos, yaw) {
    if (active) return F.reel();
    const spot = waterInFront(playerPos.x, playerPos.z, yaw);
    if (!spot) { UI.hint('Ga bij het water staan om te vissen 🎣'); return; }
    bx = spot.x; bz = spot.z;
    bobber.position.set(bx, SEA + 0.86, bz);
    bobber.visible = true;
    active = true; biting = false;
    biteTimer = 3 + rng() * 6;
    UI.hint('Lijn uitgeworpen — wacht op een beet… (C om binnen te halen)');
  };

  F.reel = function () {
    if (!active) return;
    active = false; bobber.visible = false;
    if (biting) {
      biting = false;
      if (window.Sfx) Sfx.splash();
      const vis = ['een glinsterende forel', 'een dikke karper', 'een klein baarsje', 'een goudvis', 'een oude laars'];
      UI.toast('Je ving ' + vis[(rng() * vis.length) | 0] + '! 🐟');
    } else {
      UI.hint('Niets gevangen — probeer het nog eens.');
    }
  };

  F.update = function (dt, playerPos) {
    if (!active) return;
    t += dt;
    // te ver weggelopen? lijn kwijt
    if (Math.hypot(bx - playerPos.x, bz - playerPos.z) > 9) { F.reset(); return; }

    if (!biting) {
      bobber.position.y = SEA + 0.86 + Math.sin(t * 2.0) * 0.02;
      biteTimer -= dt;
      if (biteTimer <= 0) {
        biting = true; biteWindow = 2.4;
        if (window.Sfx) Sfx.splash();
        UI.hint('Beet! Haal binnen! (C)');
      }
    } else {
      // dobber duikt op en neer bij een beet
      bobber.position.y = SEA + 0.7 + Math.sin(t * 14) * 0.08;
      biteWindow -= dt;
      if (biteWindow <= 0) { biting = false; biteTimer = 3 + rng() * 6; }   // vis ontsnapt
    }
  };

  return F;
})();
