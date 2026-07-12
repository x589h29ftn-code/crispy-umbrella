// Deterministische ruis en RNG — alles seedbaar zodat de wereld reproduceerbaar is.
window.Noise = (function () {
  const N = {};

  // Mulberry32 PRNG
  N.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Snelle 2D integer-hash → 0..1
  let SEED = 1337;
  N.setSeed = function (s) { SEED = s >>> 0; };
  N.hash2 = function (x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(SEED, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  N.hash3 = function (x, y, z) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1103515245) + Math.imul(SEED, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function smooth(t) { return t * t * (3 - 2 * t); }

  // Value-noise 2D, output -1..1
  N.noise2 = function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = N.hash2(xi, yi), b = N.hash2(xi + 1, yi);
    const c = N.hash2(xi, yi + 1), d = N.hash2(xi + 1, yi + 1);
    return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) * 2 - 1;
  };

  // Value-noise 3D, output -1..1 (voor grotten e.d.)
  N.noise3 = function (x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = smooth(xf), v = smooth(yf), w = smooth(zf);
    function corner(dx, dy, dz) { return N.hash3(xi + dx, yi + dy, zi + dz); }
    const c000 = corner(0, 0, 0), c100 = corner(1, 0, 0), c010 = corner(0, 1, 0), c110 = corner(1, 1, 0);
    const c001 = corner(0, 0, 1), c101 = corner(1, 0, 1), c011 = corner(0, 1, 1), c111 = corner(1, 1, 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return (y0 + (y1 - y0) * w) * 2 - 1;
  };

  // Fractale ruis (fbm), output ca. -1..1
  N.fbm2 = function (x, y, oct, lac, gain) {
    lac = lac || 2.0; gain = gain || 0.5;
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += N.noise2(x * freq, y * freq) * amp;
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  };

  // Ridged noise voor bergkammen, output 0..1
  N.ridge2 = function (x, y, oct) {
    let sum = 0, amp = 0.55, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(N.noise2(x * freq + i * 17.3, y * freq - i * 9.1));
      sum += n * n * amp;
      norm += amp; amp *= 0.52; freq *= 2.05;
    }
    return sum / norm;
  };

  N.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  N.lerp = (a, b, t) => a + (b - a) * t;
  N.smoothstep = function (a, b, t) {
    t = N.clamp((t - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  return N;
})();
