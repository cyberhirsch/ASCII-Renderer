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
  // shafts: helical stair wells, one candidate per SHAFT_E cell per band
  // pair. Compact by design so the field only ever checks its own cell.
  SHAFT_E: 48,     // placement cell size; anchor jitter keeps R inside it
  SHAFT_R: 3.0,    // outer radius of the stair well
  SHAFT_RIN: 0.75, // central column radius (keeps the stair "supported")
  SHAFT_PITCH: 3.4,// vertical drop per full turn; grade ~16 deg mid-stair
  SHAFT_OPEN: 0.7, // open fraction of each turn (headroom 2.4, slab 1.0)
  // carved halls: one candidate per HALL_E cell per band; flat-floored
  // rotated rooms with a pillar lattice, entered wherever the natural
  // passage network punctures their walls
  HALL_E: 96,      // placement cell size
  PIL_S: 3.5,      // pillar lattice spacing inside halls
  PIL_R: 0.45,     // pillar half-width (square pillars, Chebyshev metric)
  // edits: sparse voxel-delta overlay (digging); see js/edits.js
  EDIT_CHUNK: 32,      // voxels per chunk edge
  EDIT_VOX: 0.5,       // voxel size, world units
  EDIT_SCALE: 0.03125, // stored i8 -> density units (1/32; range ~±4)
  EDIT_WORDS: 8192,    // u32 words per chunk (32^3 / 4)
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

// Natural banded void: positive inside carved space (roughly world-unit
// magnitude), very negative elsewhere. Passages are the near-median isolines
// of a per-band value noise - the median level set of a random field
// percolates, so the network is connected across the infinite plane. gz is
// terrainH(x, y), passed in because every caller already has it.
// Mirror of WGSL naturalV. KEEP IN SYNC.
function naturalV(x, y, z, gz) {
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

// Shaft candidate for placement cell (cx, cy) and band pair j (0 = surface
// into band -1, j >= 1 = band -j into band -(j+1)). Presence requires a
// passage at the anchor in the destination band (both bands for j >= 1), so
// a shaft always daylights into the network. When (px, py) is given, the
// cheap position/distance precheck runs before any expensive validation -
// the order the WGSL twin relies on. Mirror of WGSL shaftAt. KEEP IN SYNC.
function shaftAt(cx, cy, j, px, py) {
  const s = CFG.SEED >>> 0;
  const sj = (s ^ (0x51F7 + j * 0x9101)) >>> 0;
  if (hash01(cx, cy, sj) >= (j === 0 ? 0.55 : 0.8)) return null;
  const h2 = hash2i(cx, cy, (sj ^ 0x2C55) >>> 0);
  const ax = cx * CAVES.SHAFT_E + 10 + h2[0] * 28;
  const ay = cy * CAVES.SHAFT_E + 10 + h2[1] * 28;
  if (px !== undefined) {
    const dx = px - ax, dy = py - ay;
    if (dx * dx + dy * dy > (CAVES.SHAFT_R + 2.0) * (CAVES.SHAFT_R + 2.0)) {
      return null;
    }
  }
  const gz = terrainH(ax, ay);
  let zTop, zBot;
  if (j === 0) {
    if (gz < CFG.SEA_LEVEL + 1.2 || gz > 11.0) return null;
    zTop = gz;
    zBot = caveFloor(-1, ax, ay);
    if (naturalV(ax, ay, zBot + 1.2, gz) < 0.15) return null;
  } else {
    zTop = caveFloor(-j, ax, ay) + 0.2;
    zBot = caveFloor(-j - 1, ax, ay);
    if (naturalV(ax, ay, zTop + 1.0, gz) < 0.15) return null;
    if (naturalV(ax, ay, zBot + 1.2, gz) < 0.15) return null;
  }
  const phase = hash01(cx, cy, (sj ^ 0x77AD) >>> 0);
  return { ax, ay, zTop, zBot, phase };
}

// Helical stair carve for one shaft: an annulus between the central column
// and the outer wall, with a helicoid floor - SHAFT_OPEN of every turn is
// air, the rest is the stair slab. Open to the sky just above the mouth;
// the bottom join is the band's own passage carving through the outer wall.
// Returns [void, slab]: slab > 0 marks stair steps that must STAY rock even
// where a tall passage or chamber would carve them away - without it the
// last turns of the stair dissolve into the band void and leave a drop.
// Mirror of WGSL helixV. KEEP IN SYNC.
function helixV(x, y, z, a) {
  const dx = x - a.ax, dy = y - a.ay;
  const r = Math.hypot(dx, dy);
  const radial = Math.min(CAVES.SHAFT_R - r, r - CAVES.SHAFT_RIN);
  const u = (a.zTop - z) / CAVES.SHAFT_PITCH +
            Math.atan2(dy, dx) / (2 * Math.PI) + a.phase;
  const su = u - Math.floor(u);
  const sv = Math.min(su, CAVES.SHAFT_OPEN - su) * CAVES.SHAFT_PITCH;
  let v = Math.min(radial, sv);
  // entry apron: a flat ledge ring around the mouth, stepped into from any
  // rim angle; the stair top emerges from it and winds down
  const apron = Math.min(CAVES.SHAFT_R + 1.8 - r,
                         z - (a.zTop - 0.45));
  v = Math.max(v, apron);
  v = Math.min(v, a.zTop + 1.5 - z, z - (a.zBot - 0.2));
  const slab = Math.min(radial,
    Math.min(su - CAVES.SHAFT_OPEN, 1 - su) * CAVES.SHAFT_PITCH,
    Math.min(z - (a.zBot - 0.2), (a.zTop - 0.45) - z));
  return [v, slab];
}

// All shafts near (x, y): anchors are jittered to keep the well inside its
// own placement cell, so only that one cell is ever checked - the cheap
// presence hash is all the hot march loops pay when no shaft is near.
// Returns [void, slab] aggregated over the band pairs.
// Mirror of WGSL shaftV. KEEP IN SYNC.
function shaftV(x, y, z, gz) {
  if (z > gz + 1.5) return [-1e9, -1e9];
  const cx = Math.floor(x / CAVES.SHAFT_E);
  const cy = Math.floor(y / CAVES.SHAFT_E);
  let v = -1e9, slab = -1e9;
  for (let j = 0; j < 3; j++) {
    const a = shaftAt(cx, cy, j, x, y);
    if (!a) continue;
    if (z > a.zTop + 1.5 || z < a.zBot - 0.5) continue;
    const h = helixV(x, y, z, a);
    if (h[0] > v) v = h[0];
    if (h[1] > slab) slab = h[1];
  }
  return [v, slab];
}

// Hall candidate for placement cell (cx, cy) in band k. Presence requires a
// passage at the anchor, so the network's own tunnels puncture the walls -
// those punctures are the doorways. The floor is FLAT: it sits at the
// anchor's band-floor height across the whole room, which against the noisy
// passages is what reads as "someone carved this".
// Mirror of WGSL hallAt. KEEP IN SYNC.
function hallAt(cx, cy, k, px, py) {
  const s = CFG.SEED >>> 0;
  const sk = (s ^ (0xB00B + (8 + k) * 0x8121)) >>> 0;
  if (hash01(cx, cy, sk) >= 0.5) return null;
  const h2 = hash2i(cx, cy, (sk ^ 0x39D1) >>> 0);
  const ax = cx * CAVES.HALL_E + 16 + h2[0] * 64;
  const ay = cy * CAVES.HALL_E + 16 + h2[1] * 64;
  if (px !== undefined) {
    const dx = px - ax, dy = py - ay;
    if (dx * dx + dy * dy > 17 * 17) return null;
  }
  const h3 = hash2i(cx, cy, (sk ^ 0x5A5A) >>> 0);
  const gz = terrainH(ax, ay);
  const fz0 = caveFloor(k, ax, ay);
  if (naturalV(ax, ay, fz0 + 1.2, gz) < 0.15) return null;
  const ang = hash01(cx, cy, (sk ^ 0x11EF) >>> 0) * Math.PI;
  return {
    ax, ay,
    hx: 6 + h3[0] * 5,
    hy: 5 + h3[1] * 3,
    hgt: 3.2 + h3[0] * 1.3,
    fz0,
    ca: Math.cos(ang), sa: Math.sin(ang),
  };
}

// Hall carve near (x, y, z): returns [void, slab]. The room void is a plain
// rotated box; the flat floor slab and the pillar lattice ride the slab
// channel, so neither a chamber below nor one overlapping can dissolve them
// - freestanding pillars in a cavern are exactly the ruin look wanted.
// Mirror of WGSL hallV. KEEP IN SYNC.
function hallV(x, y, z, gz) {
  if (z >= CAVES.TOP || z < CAVES.BOT) return [-1e9, -1e9];
  const k = Math.floor(z / CAVES.BAND);
  const cx = Math.floor(x / CAVES.HALL_E);
  const cy = Math.floor(y / CAVES.HALL_E);
  const a = hallAt(cx, cy, k, x, y);
  if (!a) return [-1e9, -1e9];
  const dx = x - a.ax, dy = y - a.ay;
  const lx = a.ca * dx + a.sa * dy;
  const ly = -a.sa * dx + a.ca * dy;
  const inBox = Math.min(a.hx - Math.abs(lx), a.hy - Math.abs(ly));
  const v = Math.min(inBox, z - a.fz0, a.fz0 + a.hgt - z);
  // pillar lattice in the local frame (kept clear of the walls)
  const S = CAVES.PIL_S;
  const frac = t => t - Math.floor(t);
  const mx = Math.abs(frac(lx / S + 0.5) - 0.5) * S;
  const my = Math.abs(frac(ly / S + 0.5) - 0.5) * S;
  const cheb = Math.max(mx, my);
  const pillar = Math.min(CAVES.PIL_R - cheb, inBox - 1.2,
                          z - (a.fz0 - 0.1), a.fz0 + a.hgt - z);
  const floorSlab = Math.min(inBox, a.fz0 - z, z - (a.fz0 - 0.9));
  return [v, Math.max(pillar, floorSlab)];
}

// Cave void field: natural banded passages plus carved shafts and halls,
// minus the protected solids (stair slabs, hall floors, pillars), which win
// over every carve. Mirror of WGSL caveV. KEEP IN SYNC.
function caveV(x, y, z, gz) {
  const sv = shaftV(x, y, z, gz);
  const hv = hallV(x, y, z, gz);
  const v = Math.max(naturalV(x, y, z, gz), sv[0], hv[0]);
  return Math.min(v, -Math.max(sv[1], hv[1]));
}

// Layered density, the one authority on what is solid: positive in rock,
// negative in air. The sparse edit overlay (digging) adds on top - the
// typeof guard keeps this file loadable before js/edits.js and in node
// tests that do not exercise edits. Mirror of WGSL solidD. KEEP IN SYNC.
function solidD(x, y, z) {
  const gz = terrainH(x, y);
  let d = Math.min(gz - z, -caveV(x, y, z, gz));
  if (typeof Edits !== 'undefined' && Edits.bounds) d += Edits.sample(x, y, z);
  return d;
}

// -------- 3D value noise — mirror of WGSL vnoise --------
// Used by the shader for canopy erosion and glow lichen; mirrored here so
// the examine system can recognise a lichen patch at a hit point.
function jsUhash3(x, y, z) {
  return jsUhash(jsUhash(x >>> 0, y >>> 0) >>> 0, z >>> 0) >>> 0;
}

function vnoise(px, py, pz) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const s = 1 / 4294967296;
  const c000 = jsUhash3(ix, iy, iz) * s;
  const c100 = jsUhash3(ix + 1, iy, iz) * s;
  const c010 = jsUhash3(ix, iy + 1, iz) * s;
  const c110 = jsUhash3(ix + 1, iy + 1, iz) * s;
  const c001 = jsUhash3(ix, iy, iz + 1) * s;
  const c101 = jsUhash3(ix + 1, iy, iz + 1) * s;
  const c011 = jsUhash3(ix, iy + 1, iz + 1) * s;
  const c111 = jsUhash3(ix + 1, iy + 1, iz + 1) * s;
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

// -------- ground materials: what the world is made of, per point --------
// Shared constants, interpolated into the WGSL template in
// js/webgpu/shaders.js so shader and mirror cannot disagree (scripts/
// verify.js enforces the no-literals convention for MAT_ too).
const MATS = {
  DIRT: 0, STONE: 1, ORE: 2, GEM: 3,
  SOIL_MAX: 2.4,    // soil depth on dead-flat ground, world units
  SOIL_STEEP: 0.55, // slope where soil runs out entirely (bare rock)
  SOIL_FLAT: 0.12,  // slope below which soil is at full depth
  SOIL_F: 0.09,     // soil-depth variation frequency
  SOIL_VAR: 1.2,    // soil-depth variation amplitude
  ORE_F: 0.021,     // ore-region frequency: most rock holds nothing
  ORE_GATE: 0.62,   // region noise above this can carry veins
  VEIN_F: 0.15,     // vein frequency; two isosurfaces meet in curves
  VEIN_W: 0.05,     // vein half-width in noise-value units
  GEM_CORE: 0.22,   // fraction of the vein width that is gem, not ore
  GEM_Z: -6.0,      // gems only form below this depth
  IRON_Z: -14.0,    // ore below this is iron, above it copper
};

// Soil depth below the surface at (x, y): deep on flats, zero on steep
// ground - which is why hillsides read as bare rock. Mirror of WGSL
// soilDepth. KEEP IN SYNC.
function soilDepth(x, y) {
  const e = 0.5;
  const hx = terrainH(x + e, y) - terrainH(x - e, y);
  const hy = terrainH(x, y + e) - terrainH(x, y - e);
  const slope = Math.hypot(hx, hy) / (2 * e);
  const d = smoothstep(MATS.SOIL_STEEP, MATS.SOIL_FLAT, slope) * MATS.SOIL_MAX +
    (vn2(x * MATS.SOIL_F, y * MATS.SOIL_F, (CFG.SEED ^ 0xD117) >>> 0) - 0.5) *
    MATS.SOIL_VAR;
  return Math.max(d, 0);
}

// What a point of rock is: plain stone, an ore vein, or a gem pocket. Two
// value-noise isosurfaces intersect along CURVES, not sheets - that is what
// makes veins read as branching tubes threading the stone rather than
// slabs. Gems sit in the very core of a deep vein. Mirror of WGSL rockMat.
// KEEP IN SYNC.
function rockMat(x, y, z) {
  const o = (CFG.SEED & 0xff) * 0.7;
  const reg = vnoise(x * MATS.ORE_F + 13 + o, y * MATS.ORE_F + 13,
                     z * MATS.ORE_F + 13);
  if (reg < MATS.ORE_GATE) return MATS.STONE;
  const strength = (reg - MATS.ORE_GATE) / (1 - MATS.ORE_GATE);
  const n1 = vnoise(x * MATS.VEIN_F + o, y * MATS.VEIN_F, z * MATS.VEIN_F);
  const n2 = vnoise(x * MATS.VEIN_F + 41 + o, y * MATS.VEIN_F + 17,
                    z * MATS.VEIN_F + 73);
  const w = MATS.VEIN_W * strength;
  const d1 = Math.abs(n1 - 0.5), d2 = Math.abs(n2 - 0.5);
  if (d1 >= w || d2 >= w) return MATS.STONE;
  if (z < MATS.GEM_Z && d1 < w * MATS.GEM_CORE && d2 < w * MATS.GEM_CORE) {
    return MATS.GEM;
  }
  return MATS.ORE;
}

// Material at a world point. gz is terrainH(x, y) - every caller has it.
// Mirror of WGSL matAt. KEEP IN SYNC.
function matAt(x, y, z, gz) {
  if (z > gz - soilDepth(x, y)) return MATS.DIRT;
  return rockMat(x, y, z);
}

// which ore this depth yields
function oreItem(z) { return z < MATS.IRON_Z ? 'iron' : 'copper'; }

// species index for the tree anchored in cell (ix, iy) - deterministic,
// independent of the placement hash so size and species do not correlate
function treeSpecies(ix, iy) {
  return Math.min(2, Math.floor(hash01(ix, iy, (CFG.SEED ^ 0x5EED) >>> 0) * 3));
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
