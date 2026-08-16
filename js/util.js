// Seeded RNG + hashing helpers.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fast integer hash -> [0,1). Deterministic per (x,y,z) triple.
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 2D value noise over hash3, smoothstep-interpolated, range [0,1).
// Deterministic in (x, y, seed) — no sequence state, safe to sample in any order.
function vnoise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash3(xi, yi, seed), b = hash3(xi + 1, yi, seed);
  const c = hash3(xi, yi + 1, seed), d = hash3(xi + 1, yi + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// fractal sum, 3 octaves
function fbm2(x, y, seed) {
  return vnoise2(x, y, seed) * 0.55 +
         vnoise2(x * 2.13, y * 2.13, seed ^ 0x9e37) * 0.28 +
         vnoise2(x * 4.31, y * 4.31, seed ^ 0x51ed) * 0.17;
}
