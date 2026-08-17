// Hashing / noise / terrain — bit-compatible mirrors of the WGSL functions in
// js/webgpu/shaders.js. The GPU draws the world from these functions and the
// CPU collides against them, so any change MUST be made in both places.

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// u32 hash, identical to WGSL uhash (Math.imul == u32 multiply wrap)
function jsUhash(a, b) {
  let n = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return (n ^ (n >>> 16)) >>> 0;
}

function hash01(x, y, s) {
  return jsUhash(jsUhash(x >>> 0, y >>> 0) >>> 0, s >>> 0) / 4294967296;
}

function hash2i(x, y, s) {
  const h = jsUhash(jsUhash(x >>> 0, y >>> 0) >>> 0, s >>> 0);
  return [(h & 0xffff) / 65536, ((h >>> 16) & 0xffff) / 65536];
}

// 2D value noise, smoothstep-interpolated — mirror of WGSL vn2
function vn2(px, py, s) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy, s), b = hash01(ix + 1, iy, s);
  const c = hash01(ix, iy + 1, s), d = hash01(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// -------- terrain height — mirror of WGSL terrainH --------
function terrainH(px, py) {
  const s = CFG.SEED >>> 0;
  const wx = vn2(px * 0.013, py * 0.013, (s ^ 0x77) >>> 0);
  const wy = vn2(px * 0.013 + 37.0, py * 0.013 + 91.0, (s ^ 0x77) >>> 0);
  const qx = px * 0.023 + (wx - 0.5) * 1.4;
  const qy = py * 0.023 + (wy - 0.5) * 1.4;
  let h = vn2(qx, qy, s) * 0.62 +
          vn2(qx * 2.7, qy * 2.7, (s ^ 0x9e37) >>> 0) * 0.26 +
          vn2(qx * 6.1, qy * 6.1, (s ^ 0x51ed) >>> 0) * 0.12;
  h = Math.pow(h, 1.55);
  return h * CFG.TERRAIN_MAX;
}

// -------- caves: shared constants + density mirror --------
// These values are interpolated into the WGSL template in
// js/webgpu/shaders.js, so shader and mirror cannot disagree
// (scripts/verify.js enforces the convention: no literal CAVE_/EDIT_
// constants in the shader source).
const CAVES = {
  STEP: 0.3,     // primary-ray march step through cave air, world units
  STEPS: 200,    // primary-ray march budget (STEP * STEPS = CAVE_VIEW)
  TSTEP: 0.55,   // occlusion-ray march step through cave air
  TSTEPS: 14,    // occlusion-ray march budget
  BAND: 12,      // depth-band height; band k spans [k*BAND, k*BAND+BAND)
  TOP: -1,       // no natural void above this z (highest ceiling is -1.4)
  BOT: -36,      // deepest band floor for the slice; extensible downward
  MASK_F: 0.006, // cave-region mask frequency (regions ~150 u across)
  MASK_LO: 0.62, // mask gate: smoothstep(LO, HI, noise)
  MASK_HI: 0.70,
  FLOOR_F: 0.05, // floor ramp frequency; FLOOR_A * FLOOR_F * 1.5 bounds the
  FLOOR_A: 3.0,  // slope (~0.23 = 13 deg) - walkability is by construction
  PASS_F: 0.045, // passage isoline frequency (winding at ~20 u scale)
  PASS_F2: 0.062,// second isoline family; crossings knit the network together
  CHAM_F: 0.02,  // chamber noise frequency
  PASS_W: 0.06,  // passage half-width in isoline value units
  CHAM_W: 0.15,  // extra half-width inside chambers
  PASS_SCALE: 15,// value units -> approx world units (1 / (1.5 * PASS_F))
};

// Band floor: a low-frequency ramp whose slope is bounded by construction.
// Mirror of WGSL caveFloor. KEEP IN SYNC.
function caveFloor(k, x, y) {
  const s = CFG.SEED >>> 0;
  const bs = (s ^ ((8 + k) * 0x9E37)) >>> 0;
  return k * CAVES.BAND + 1.6 +
         vn2(x * CAVES.FLOOR_F, y * CAVES.FLOOR_F, (bs ^ 0x0F1D) >>> 0) *
         CAVES.FLOOR_A;
}

// Cave void field: positive inside carved space (roughly world-unit
// magnitude), very negative elsewhere. Passages are the near-median isolines
// of a per-band value noise - the median level set of a random field
// percolates, so the network is connected across the infinite plane. gz is
// terrainH(x, y), passed in because every caller already has it.
// Mirror of WGSL caveV. KEEP IN SYNC.
function caveV(x, y, z, gz) {
  if (z >= CAVES.TOP || z < CAVES.BOT) return -1e9;
  const s = CFG.SEED >>> 0;
  const m = vn2(x * CAVES.MASK_F, y * CAVES.MASK_F, (s ^ 0x33AA) >>> 0);
  const gate = smoothstep(CAVES.MASK_LO, CAVES.MASK_HI, m) *
               smoothstep(CFG.SEA_LEVEL + 0.5, CFG.SEA_LEVEL + 1.5, gz);
  if (gate <= 0.001) return -1e9;
  const k = Math.floor(z / CAVES.BAND);
  const bs = (s ^ ((8 + k) * 0x9E37)) >>> 0;
  const fz = caveFloor(k, x, y);
  // two isoline families: each percolates on its own, and their crossings
  // knit isolated contour rings into one network with natural junctions
  const n1 = vn2(x * CAVES.PASS_F, y * CAVES.PASS_F, (bs ^ 0x5EA5) >>> 0);
  const n2 = vn2(x * CAVES.PASS_F2, y * CAVES.PASS_F2, (bs ^ 0x7A3B) >>> 0);
  const iso = Math.min(Math.abs(n1 - 0.5), Math.abs(n2 - 0.5));
  const c = vn2(x * CAVES.CHAM_F, y * CAVES.CHAM_F, (bs ^ 0xC4A6) >>> 0);
  const wide = smoothstep(0.60, 0.85, c);
  const w = (CAVES.PASS_W + wide * CAVES.CHAM_W) * gate;
  const ceilH = 2.6 + wide * 3.4;
  const h = (w - iso) * CAVES.PASS_SCALE;
  const vz = Math.min(z - fz, fz + ceilH - z);
  return Math.min(h, vz);
}

// Layered density, the one authority on what is solid: positive in rock,
// negative in air. Mirror of WGSL solidD. KEEP IN SYNC.
function solidD(x, y, z) {
  const gz = terrainH(x, y);
  return Math.min(gz - z, -caveV(x, y, z, gz));
}

// -------- tree placement — mirror of WGSL treeAt --------
// returns null or { cx, cy, r, trunkH, trunkR }
function treeAt(ix, iy) {
  const s = CFG.SEED >>> 0;
  const forest = vn2(ix * 0.021, iy * 0.021, (s ^ 0xF0F0) >>> 0);
  const density = smoothstep(0.45, 0.72, forest) * 0.16 + 0.004;
  if (hash01(ix, iy, (s ^ 0x7EE7) >>> 0) >= density) return null;
  const h2 = hash2i(ix, iy, (s ^ 0xA11C) >>> 0);
  const r = 1.0 + h2[0] * 0.5;
  return {
    cx: ix + 0.3 + h2[0] * 0.4,
    cy: iy + 0.3 + h2[1] * 0.4,
    r,
    trunkH: 2.6 + h2[1] * 1.2,
    trunkR: 0.085 + r * 0.055,
  };
}
