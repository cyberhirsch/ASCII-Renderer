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
};

// Cave void field: positive inside carved space, negative in rock and in the
// open air above ground. Mirror of WGSL caveV. Stub until the cave phase
// lands; -1e9 makes solidD degenerate to the plain heightfield exactly.
function caveV(x, y, z) {
  return -1e9;
}

// Layered density, the one authority on what is solid: positive in rock,
// negative in air. Mirror of WGSL solidD. KEEP IN SYNC.
function solidD(x, y, z) {
  return Math.min(terrainH(x, y) - z, -caveV(x, y, z));
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
