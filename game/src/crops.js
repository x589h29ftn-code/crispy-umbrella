// Gewasgroei: geplant graan groeit in fasen (meta 1..4) over de tijd tot rijp.
// Wereldwater/dorpsgewassen (meta 0) tellen als volgroeid en groeien niet mee.
window.Crops = (function () {
  const C = {};
  const B = G.B;
  const list = [];       // {x,y,z,t}

  C.reset = function () { list.length = 0; };
  C.plant = function (x, y, z) { list.push({ x, y, z, t: 0 }); };

  // bij het laden reeds-geplante, nog niet rijpe gewassen hervatten
  C.track = function (x, y, z) {
    if (Chunks.getBlock(x, y, z) === B.CROP) {
      const m = G.getMeta(x, y, z);
      if (m >= 1 && m < 4) list.push({ x, y, z, t: 0 });
    }
  };

  C.update = function (dt) {
    if (!list.length) return;
    const grow = Math.max(8, (G.settings.dayMinutes * 60) / 3);   // ~1 dag tot rijp
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (Chunks.getBlock(c.x, c.y, c.z) !== B.CROP) { list.splice(i, 1); continue; }
      c.t += dt;
      if (c.t >= grow) {
        c.t = 0;
        const m = G.getMeta(c.x, c.y, c.z) || 1;
        if (m < 4) Chunks.setBlock(c.x, c.y, c.z, B.CROP, true, m + 1);
        if (m + 1 >= 4) list.splice(i, 1);
      }
    }
  };

  return C;
})();
