// WGSL sources.
//
// Pass 1 (compute): one invocation per low-res cell, each casting a true 3D
// ray into an INFINITE procedural world. Terrain is a continuous noise
// function of world position evaluated in the shader — nothing is stored, so
// the world has no edges and no cell steps: rays march the smooth heightfield
// and normals come from its gradient. Trees are placed by deterministic hash
// per integer cell and traced as trunk + translucent canopy. Water is a sea
// level plane. Sun visibility is a real marched shadow ray; AO is traced
// hemisphere rays. Entities (future creatures) are articulated primitives.
//
// The same hash/noise functions are mirrored in js/util.js so CPU collision
// agrees with what the GPU draws.
//
// Pass 2 (render): a fullscreen triangle maps each low-res cell to a glyph
// chosen by luminance and upscales it.

const WGSL_COMPUTE = /* wgsl */`
struct Uniforms {
  camPos    : vec2f,
  res       : vec2f,
  fwd       : vec3f,
  eye       : f32,
  right     : vec3f,
  maxDist   : f32,
  up        : vec3f,
  seed      : f32,   // world seed, integral, folded into every hash
  sunDir    : vec3f,
  shadowK   : f32,
  tanX      : f32,
  tanY      : f32,
  maxHeight : f32,   // terrain amplitude bound for shadow-ray early-out
  entCount  : f32,
  sunAngle  : f32,
  sunSamples: f32,
  aoSamples : f32,
  aoRadius  : f32,
  treeReach : f32,   // cells to search for overhanging canopies
  seaLevel  : f32,
  time      : f32,
  shadeNear : f32,   // full ray budgets inside this distance
  sunCol    : vec3f,
  sunI      : f32,
  ambCol    : vec3f,
  ambI      : f32,
  skyLo     : vec3f,
  shadeFar  : f32,   // beyond this: no shadow/AO rays at all
  skyHi     : vec3f,
  pad3      : f32,
  editMin   : vec3f, // AABB of resident edit chunks: the cheap gate that
  editCount : f32,   // keeps the untouched world paying two comparisons
  editMax   : vec3f,
  pad4      : f32,
  lampI     : f32,   // headlamp intensity (a carried torch raises it)
  fellCount : f32,   // felled tree cells in the fells buffer
  pad5      : f32,
  pad6      : f32,
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var outTex : texture_storage_2d<rgba8unorm, write>;
// two vec4 per entity: (x, y, heading, kind) and kind-specific extras
@group(0) @binding(2) var<storage, read> ents : array<vec4f>;
// player edits: resident chunk headers (world origin xyz, used flag) and
// their voxel deltas as packed signed bytes, four to a word
@group(0) @binding(3) var<storage, read> editHead : array<vec4f>;
@group(0) @binding(4) var<storage, read> editData : array<u32>;
// felled tree cells (ix, iy), nearest the player first
@group(0) @binding(5) var<storage, read> fells : array<vec2f>;

// -------- hashing / noise (mirrored in js/util.js) --------

fn uhash(a : u32, b : u32) -> u32 {
  var n = (a * 73856093u) ^ (b * 19349663u);
  n = n ^ (n >> 13u);
  n = n * 1274126177u;
  return n ^ (n >> 16u);
}

fn hash01(x : i32, y : i32, s : u32) -> f32 {
  let h = uhash(uhash(bitcast<u32>(x), bitcast<u32>(y)), s);
  return f32(h) * (1.0 / 4294967296.0);
}

fn hash2i(x : i32, y : i32, s : u32) -> vec2f {
  let h = uhash(uhash(bitcast<u32>(x), bitcast<u32>(y)), s);
  return vec2f(f32(h & 0xffffu), f32((h >> 16u) & 0xffffu)) * (1.0 / 65536.0);
}

// 2D value noise, smoothstep-interpolated
fn vn2(p : vec2f, s : u32) -> f32 {
  let ip = vec2i(floor(p));
  let f = p - floor(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash01(ip.x,     ip.y,     s);
  let b = hash01(ip.x + 1, ip.y,     s);
  let c = hash01(ip.x,     ip.y + 1, s);
  let d = hash01(ip.x + 1, ip.y + 1, s);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}

fn seedU() -> u32 { return u32(U.seed); }

// -------- terrain: smooth, infinite. KEEP IN SYNC with js/util.js --------

fn terrainH(p : vec2f) -> f32 {
  let s = seedU();
  let w = vec2f(vn2(p * 0.013, s ^ 0x77u),
                vn2(p * 0.013 + vec2f(37.0, 91.0), s ^ 0x77u));
  let q = p * 0.023 + (w - 0.5) * 1.4;
  var h = vn2(q, s) * 0.62 + vn2(q * 2.7, s ^ 0x9e37u) * 0.26
        + vn2(q * 6.1, s ^ 0x51edu) * 0.12;
  h = pow(h, 1.55);            // deepen valleys, sharpen ridges
  return h * U.maxHeight;
}

fn terrainN(p : vec2f) -> vec3f {
  let e = 0.35;
  let hx = terrainH(p + vec2f(e, 0.0)) - terrainH(p - vec2f(e, 0.0));
  let hy = terrainH(p + vec2f(0.0, e)) - terrainH(p - vec2f(0.0, e));
  return normalize(vec3f(-hx, -hy, 2.0 * e));
}

// -------- caves: layered density. KEEP IN SYNC with js/util.js --------
// solidD(p) = min(terrainH - z, -caveV(p)): positive in rock, negative in
// air. caveV > 0 inside carved void; the stub below keeps it dead until the
// cave phase lands, which makes solidD degenerate to the heightfield exactly.

const CAVE_VIEW : f32 = ${CFG.CAVE_VIEW};   // view distance underground
const CAVE_STEP : f32 = ${CAVES.STEP};      // primary march step in cave air
const CAVE_TSTEP : f32 = ${CAVES.TSTEP};    // occlusion march step in cave air
const CAVE_BAND : f32 = ${CAVES.BAND};      // depth-band height
const CAVE_TOP : f32 = ${CAVES.TOP};        // no natural void above this z
const CAVE_BOT : f32 = ${CAVES.BOT};        // deepest band floor

// band floor: low-frequency ramp, slope bounded by construction
fn caveFloor(k : i32, q : vec2f) -> f32 {
  let bs = seedU() ^ (u32(8 + k) * 0x9E37u);
  return f32(k) * CAVE_BAND + 1.6 +
         vn2(q * ${CAVES.FLOOR_F}, bs ^ 0x0F1Du) * ${CAVES.FLOOR_A};
}

// Natural banded void: positive inside carved space, very negative
// elsewhere. Passages are near-median isolines of per-band value noise - the
// median level set of a random field percolates, so the network is connected
// across the infinite plane. gz = terrainH(p.xy), every caller has it.
fn naturalV(p : vec3f, gz : f32) -> f32 {
  if (p.z >= CAVE_TOP || p.z < CAVE_BOT) { return -1.0e9; }
  let s = seedU();
  let m = vn2(p.xy * ${CAVES.MASK_F}, s ^ 0x33AAu);
  let gate = smoothstep(${CAVES.MASK_LO}, ${CAVES.MASK_HI}, m)
           * smoothstep(U.seaLevel + 0.5, U.seaLevel + 1.5, gz);
  if (gate <= 0.001) { return -1.0e9; }
  let k = i32(floor(p.z / CAVE_BAND));
  let bs = s ^ (u32(8 + k) * 0x9E37u);
  let fz = caveFloor(k, p.xy);
  // two isoline families: each percolates on its own, and their crossings
  // knit isolated contour rings into one network with natural junctions
  let n1 = vn2(p.xy * ${CAVES.PASS_F}, bs ^ 0x5EA5u);
  let n2 = vn2(p.xy * ${CAVES.PASS_F2}, bs ^ 0x7A3Bu);
  let iso = min(abs(n1 - 0.5), abs(n2 - 0.5));
  let c = vn2(p.xy * ${CAVES.CHAM_F}, bs ^ 0xC4A6u);
  let wide = smoothstep(0.60, 0.85, c);
  let w = (${CAVES.PASS_W} + wide * ${CAVES.CHAM_W}) * gate;
  let ceilH = 2.6 + wide * 3.4;
  let h = (w - iso) * ${CAVES.PASS_SCALE};
  let vz = min(p.z - fz, fz + ceilH - p.z);
  return min(h, vz);
}

// -------- shafts: helical stair wells linking surface and bands --------

struct Shaft {
  present : bool, ax : f32, ay : f32, zTop : f32, zBot : f32, phase : f32,
};

// One candidate per placement cell per band pair j (0 = surface into band
// -1, j >= 1 = band -j into band -(j+1)). Presence requires a passage at the
// anchor in the destination band, so a shaft always daylights into the
// network. Cheap hashes and the distance precheck run before any expensive
// validation - the hot march loops rely on that order.
fn shaftAt(cx : i32, cy : i32, j : i32, pp : vec2f) -> Shaft {
  var a : Shaft;
  a.present = false;
  let s = seedU();
  let sj = s ^ (0x51F7u + u32(j) * 0x9101u);
  let rate = select(0.8, 0.55, j == 0);
  if (hash01(cx, cy, sj) >= rate) { return a; }
  let h2 = hash2i(cx, cy, sj ^ 0x2C55u);
  a.ax = f32(cx) * ${CAVES.SHAFT_E} + 10.0 + h2.x * 28.0;
  a.ay = f32(cy) * ${CAVES.SHAFT_E} + 10.0 + h2.y * 28.0;
  let dx = pp.x - a.ax;
  let dy = pp.y - a.ay;
  if (dx * dx + dy * dy >
      (${CAVES.SHAFT_R} + 2.0) * (${CAVES.SHAFT_R} + 2.0)) { return a; }
  let gz = terrainH(vec2f(a.ax, a.ay));
  let aq = vec2f(a.ax, a.ay);
  if (j == 0) {
    if (gz < U.seaLevel + 1.2 || gz > 11.0) { return a; }
    a.zTop = gz;
    a.zBot = caveFloor(-1, aq);
    if (naturalV(vec3f(aq, a.zBot + 1.2), gz) < 0.15) { return a; }
  } else {
    a.zTop = caveFloor(-j, aq) + 0.2;
    a.zBot = caveFloor(-j - 1, aq);
    if (naturalV(vec3f(aq, a.zTop + 1.0), gz) < 0.15) { return a; }
    if (naturalV(vec3f(aq, a.zBot + 1.2), gz) < 0.15) { return a; }
  }
  a.phase = hash01(cx, cy, sj ^ 0x77ADu);
  a.present = true;
  return a;
}

// Helical stair carve: an annulus between central column and outer wall
// with a helicoid floor - SHAFT_OPEN of every turn is air, the rest is the
// stair slab. Open to the sky just above the mouth; the bottom join is the
// band's own passage carving through the outer wall. Returns (void, slab):
// slab > 0 marks stair steps that must STAY rock even where a tall passage
// or chamber would carve them away - without it the last turns of the stair
// dissolve into the band void and leave a drop.
fn helixV(p : vec3f, a : Shaft) -> vec2f {
  let dx = p.x - a.ax;
  let dy = p.y - a.ay;
  let r = sqrt(dx * dx + dy * dy);
  let radial = min(${CAVES.SHAFT_R} - r, r - ${CAVES.SHAFT_RIN});
  let u = (a.zTop - p.z) / ${CAVES.SHAFT_PITCH}
        + atan2(dy, dx) / 6.2831853 + a.phase;
  let su = fract(u);
  let sv = min(su, ${CAVES.SHAFT_OPEN} - su) * ${CAVES.SHAFT_PITCH};
  var v = min(radial, sv);
  // entry apron: a flat ledge ring around the mouth, stepped into from any
  // rim angle; the stair top emerges from it and winds down
  let apron = min(${CAVES.SHAFT_R} + 1.8 - r,
                  p.z - (a.zTop - 0.45));
  v = max(v, apron);
  v = min(v, min(a.zTop + 1.5 - p.z, p.z - (a.zBot - 0.2)));
  let slab = min(radial, min(
    min(su - ${CAVES.SHAFT_OPEN}, 1.0 - su) * ${CAVES.SHAFT_PITCH},
    min(p.z - (a.zBot - 0.2), (a.zTop - 0.45) - p.z)));
  return vec2f(v, slab);
}

// All shafts near p: anchors are jittered to keep the well inside its own
// placement cell, so only that one cell is ever checked - the presence hash
// is all the hot march loops pay when no shaft is near. Returns (void, slab).
fn shaftV(p : vec3f, gz : f32) -> vec2f {
  if (p.z > gz + 1.5) { return vec2f(-1.0e9, -1.0e9); }
  let cx = i32(floor(p.x / ${CAVES.SHAFT_E}));
  let cy = i32(floor(p.y / ${CAVES.SHAFT_E}));
  var v = vec2f(-1.0e9, -1.0e9);
  for (var j = 0; j < 3; j = j + 1) {
    let a = shaftAt(cx, cy, j, p.xy);
    if (!a.present) { continue; }
    if (p.z > a.zTop + 1.5 || p.z < a.zBot - 0.5) { continue; }
    let h = helixV(p, a);
    v = max(v, h);
  }
  return v;
}

// -------- carved halls: flat-floored pillared rooms on the network --------

struct Hall {
  present : bool, ax : f32, ay : f32, hx : f32, hy : f32,
  hgt : f32, fz0 : f32, ca : f32, sa : f32,
};

// One candidate per placement cell per band. Presence requires a passage at
// the anchor, so the network's own tunnels puncture the walls - those
// punctures are the doorways. The floor is FLAT at the anchor's band-floor
// height, which against the noisy passages reads as "someone carved this".
fn hallAt(cx : i32, cy : i32, k : i32, pp : vec2f) -> Hall {
  var a : Hall;
  a.present = false;
  let s = seedU();
  let sk = s ^ (0xB00Bu + u32(8 + k) * 0x8121u);
  if (hash01(cx, cy, sk) >= 0.5) { return a; }
  let h2 = hash2i(cx, cy, sk ^ 0x39D1u);
  a.ax = f32(cx) * ${CAVES.HALL_E} + 16.0 + h2.x * 64.0;
  a.ay = f32(cy) * ${CAVES.HALL_E} + 16.0 + h2.y * 64.0;
  let dx = pp.x - a.ax;
  let dy = pp.y - a.ay;
  if (dx * dx + dy * dy > 17.0 * 17.0) { return a; }
  let h3 = hash2i(cx, cy, sk ^ 0x5A5Au);
  let aq = vec2f(a.ax, a.ay);
  let gz = terrainH(aq);
  a.fz0 = caveFloor(k, aq);
  if (naturalV(vec3f(aq, a.fz0 + 1.2), gz) < 0.15) { return a; }
  let ang = hash01(cx, cy, sk ^ 0x11EFu) * 3.14159265;
  a.hx = 6.0 + h3.x * 5.0;
  a.hy = 5.0 + h3.y * 3.0;
  a.hgt = 3.2 + h3.x * 1.3;
  a.ca = cos(ang);
  a.sa = sin(ang);
  a.present = true;
  return a;
}

// Hall carve: (void, slab). The room void is a plain rotated box; the flat
// floor slab and the pillar lattice ride the slab channel, so neither a
// chamber below nor one overlapping can dissolve them - freestanding
// pillars in a cavern are exactly the ruin look wanted.
fn hallV(p : vec3f, gz : f32) -> vec2f {
  if (p.z >= CAVE_TOP || p.z < CAVE_BOT) { return vec2f(-1.0e9, -1.0e9); }
  let k = i32(floor(p.z / CAVE_BAND));
  let cx = i32(floor(p.x / ${CAVES.HALL_E}));
  let cy = i32(floor(p.y / ${CAVES.HALL_E}));
  let a = hallAt(cx, cy, k, p.xy);
  if (!a.present) { return vec2f(-1.0e9, -1.0e9); }
  let dx = p.x - a.ax;
  let dy = p.y - a.ay;
  let lx = a.ca * dx + a.sa * dy;
  let ly = -a.sa * dx + a.ca * dy;
  let inBox = min(a.hx - abs(lx), a.hy - abs(ly));
  let v = min(inBox, min(p.z - a.fz0, a.fz0 + a.hgt - p.z));
  // pillar lattice in the local frame (kept clear of the walls)
  let S = ${CAVES.PIL_S};
  let mx = abs(fract(lx / S + 0.5) - 0.5) * S;
  let my = abs(fract(ly / S + 0.5) - 0.5) * S;
  let cheb = max(mx, my);
  let pillar = min(min(${CAVES.PIL_R} - cheb, inBox - 1.2),
                   min(p.z - (a.fz0 - 0.1), a.fz0 + a.hgt - p.z));
  let floorSlab = min(inBox, min(a.fz0 - p.z, p.z - (a.fz0 - 0.9)));
  return vec2f(v, max(pillar, floorSlab));
}

// cave void field: natural banded passages plus carved shafts and halls,
// minus the protected solids (stair slabs, hall floors, pillars), which win
// over every carve
fn caveV(p : vec3f, gz : f32) -> f32 {
  let sv = shaftV(p, gz);
  let hv = hallV(p, gz);
  let v = max(naturalV(p, gz), max(sv.x, hv.x));
  return min(v, -max(sv.y, hv.y));
}

// -------- player edits: sparse voxel-delta overlay (digging) --------

const EDIT_CHUNK : i32 = ${CAVES.EDIT_CHUNK};
const EDIT_VOX : f32 = ${CAVES.EDIT_VOX};
const EDIT_SCALE : f32 = ${CAVES.EDIT_SCALE};
const EDIT_WORDS : i32 = ${CAVES.EDIT_WORDS};

// signed delta at an integer voxel: resolve its chunk among the resident
// headers, unpack the byte
fn editVoxel(v : vec3i, n : i32) -> f32 {
  let c = vec3i(floor(vec3f(v) / f32(EDIT_CHUNK)));
  let orgW = vec3f(c * EDIT_CHUNK) * EDIT_VOX;
  for (var i = 0; i < n; i = i + 1) {
    let h = editHead[i];
    if (h.w < 0.5) { continue; }
    if (abs(h.x - orgW.x) > 0.01 || abs(h.y - orgW.y) > 0.01 ||
        abs(h.z - orgW.z) > 0.01) { continue; }
    let l = v - c * EDIT_CHUNK;
    let li = (l.z * EDIT_CHUNK + l.y) * EDIT_CHUNK + l.x;
    let word = editData[i * EDIT_WORDS + (li >> 2)];
    let byte = (word >> (u32(li & 3) * 8u)) & 0xffu;
    return f32(bitcast<i32>(byte << 24u) >> 24);
  }
  return 0.0;
}

// trilinear density delta at a world point; mirror of Edits.sample in
// js/edits.js. KEEP IN SYNC.
fn editDelta(p : vec3f) -> f32 {
  let n = i32(U.editCount);
  if (n == 0) { return 0.0; }
  if (any(p < U.editMin) || any(p > U.editMax)) { return 0.0; }
  let g = p / EDIT_VOX - vec3f(0.5);
  let g0 = floor(g);
  let f = g - g0;
  let gi = vec3i(g0);
  var sum = 0.0;
  for (var ci = 0; ci < 8; ci = ci + 1) {
    let o = vec3i(ci & 1, (ci >> 1) & 1, (ci >> 2) & 1);
    let w = select(1.0 - f.x, f.x, o.x == 1)
          * select(1.0 - f.y, f.y, o.y == 1)
          * select(1.0 - f.z, f.z, o.z == 1);
    if (w > 1e-4) { sum = sum + editVoxel(gi + o, n) * w; }
  }
  return sum * EDIT_SCALE;
}

fn solidD(p : vec3f) -> f32 {
  let gz = terrainH(p.xy);
  return min(gz - p.z, -caveV(p, gz)) + editDelta(p);
}

// gradient normal of the density field, for carved surfaces where the
// heightfield normal is meaningless
fn solidN(p : vec3f) -> vec3f {
  let e = 0.22;
  return normalize(vec3f(
    solidD(p - vec3f(e, 0.0, 0.0)) - solidD(p + vec3f(e, 0.0, 0.0)),
    solidD(p - vec3f(0.0, e, 0.0)) - solidD(p + vec3f(0.0, e, 0.0)),
    solidD(p - vec3f(0.0, 0.0, e)) - solidD(p + vec3f(0.0, 0.0, e))));
}

// heightfield march, the fast path through open air. Returns (t, 0) on a
// solid hit, (-1, 0) on none, (-2, tCross) when the crossing point is carved
// away - the ray passed through a cave mouth and must switch marches.
fn heightMarch(ro : vec3f, rd : vec3f, tStart : f32, tMax : f32) -> vec2f {
  if (ro.z >= U.maxHeight && rd.z >= 0.0) { return vec2f(-1.0, 0.0); }
  var t = tStart;
  var tPrev = t;
  for (var i = 0; i < 260; i = i + 1) {
    if (t > tMax) { break; }
    let p = ro + rd * t;
    let d = p.z - terrainH(p.xy);
    if (d < 0.0) {
      var a = tPrev;
      var b = t;
      for (var j = 0; j < 7; j = j + 1) {
        let m = (a + b) * 0.5;
        let pm = ro + rd * m;
        if (pm.z - terrainH(pm.xy) < 0.0) { b = m; } else { a = m; }
      }
      // the crossing point may sit in carved or dug-out air: cave mouth,
      // stair well, or a player-dug pit - hand over to the density march
      if (solidD(ro + rd * b) < 0.0) { return vec2f(-2.0, (a + b) * 0.5); }
      return vec2f((a + b) * 0.5, 0.0);
    }
    tPrev = t;
    t = t + clamp(d * 0.45, 0.06, 0.35 + t * 0.045);
  }
  return vec2f(-1.0, 0.0);
}

// fixed-step density march through cave air. Returns (t, 0) on a hit,
// (-1, tEnd) when the budget or view distance runs out underground, and
// (-3, tEnd) when the ray resurfaces into open air - the caller resumes the
// heightfield march from tEnd, so distant hills stay visible through a mouth.
fn marchCave(ro : vec3f, rd : vec3f, tStart : f32, tMax : f32) -> vec2f {
  var t = tStart;
  var tPrev = t;
  for (var i = 0; i < ${CAVES.STEPS}; i = i + 1) {
    if (t > tMax) { break; }
    let p = ro + rd * t;
    let gzp = terrainH(p.xy);
    let v = caveV(p, gzp);
    if (min(gzp - p.z, -v) + editDelta(p) > 0.0) {
      var a = tPrev;
      var b = t;
      for (var j = 0; j < 6; j = j + 1) {
        let m = (a + b) * 0.5;
        if (solidD(ro + rd * m) > 0.0) { b = m; } else { a = m; }
      }
      return vec2f((a + b) * 0.5, 0.0);
    }
    if (p.z - gzp > 0.5 && v <= 0.0) { return vec2f(-3.0, t); }
    tPrev = t;
    t = t + CAVE_STEP;
  }
  return vec2f(-1.0, t);
}

// unified march: alternate heightfield and density phases as the ray crosses
// in and out of carved space (WGSL has no recursion; 4 phases cover a view
// through a mouth and out another). A ray whose budget dies in cave air
// returns that depth as a pseudo-hit - the shader fogs it to black, so
// tunnels end in darkness rather than sky.
fn terrainT(ro : vec3f, rd : vec3f, tMax : f32, startCave : bool) -> f32 {
  var t = 0.02;
  var mode = select(0, 1, startCave);
  for (var phase = 0; phase < 4; phase = phase + 1) {
    if (mode == 0) {
      let r = heightMarch(ro, rd, t, tMax);
      if (r.x >= 0.0) { return r.x; }
      if (r.x < -1.5) { t = r.y; mode = 1; continue; }
      return -1.0;
    }
    let r = marchCave(ro, rd, t, min(tMax, t + CAVE_VIEW));
    if (r.x >= 0.0) { return r.x; }
    if (r.x < -2.5) { t = r.y; mode = 0; continue; }
    return r.y;
  }
  return -1.0;
}

// -------- trees: hash-placed per integer cell. KEEP IN SYNC with js/util.js --------

struct Tree { present : bool, cx : f32, cy : f32, r : f32, trunkH : f32 };

// Chopped trees are removed by a small list of felled cells. Checked only
// after a tree's presence hash passes - a few scans per ray, never per cell,
// so the hot DDA walks stay hot.
fn isFelled(ix : i32, iy : i32) -> bool {
  let n = i32(U.fellCount);
  for (var i = 0; i < n; i = i + 1) {
    let f = fells[i];
    if (i32(f.x) == ix && i32(f.y) == iy) { return true; }
  }
  return false;
}

fn treeAt(ix : i32, iy : i32) -> Tree {
  var tr : Tree;
  tr.present = false;
  let s = seedU();
  let forest = vn2(vec2f(f32(ix), f32(iy)) * 0.021, s ^ 0xF0F0u);
  let density = smoothstep(0.45, 0.72, forest) * 0.16 + 0.004;
  if (hash01(ix, iy, s ^ 0x7EE7u) >= density) { return tr; }
  let h2 = hash2i(ix, iy, s ^ 0xA11Cu);
  tr.cx = f32(ix) + 0.3 + h2.x * 0.4;
  tr.cy = f32(iy) + 0.3 + h2.y * 0.4;
  tr.r = 1.0 + h2.x * 0.5;
  tr.trunkH = 2.6 + h2.y * 1.2;
  tr.present = true;
  return tr;
}

// 3D value noise for canopy erosion
fn uhash3v(x : i32, y : i32, z : i32) -> u32 {
  return uhash(uhash(bitcast<u32>(x), bitcast<u32>(y)), bitcast<u32>(z));
}
fn vnoise(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let ix = i32(i.x); let iy = i32(i.y); let iz = i32(i.z);
  let s = 1.0 / 4294967296.0;
  let c000 = f32(uhash3v(ix,   iy,   iz  )) * s;
  let c100 = f32(uhash3v(ix+1, iy,   iz  )) * s;
  let c010 = f32(uhash3v(ix,   iy+1, iz  )) * s;
  let c110 = f32(uhash3v(ix+1, iy+1, iz  )) * s;
  let c001 = f32(uhash3v(ix,   iy,   iz+1)) * s;
  let c101 = f32(uhash3v(ix+1, iy,   iz+1)) * s;
  let c011 = f32(uhash3v(ix,   iy+1, iz+1)) * s;
  let c111 = f32(uhash3v(ix+1, iy+1, iz+1)) * s;
  let x00 = mix(c000, c100, u.x);
  let x10 = mix(c010, c110, u.x);
  let x01 = mix(c001, c101, u.x);
  let x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn hash1f(p : vec2f) -> f32 {
  let ip = vec2i(floor(p));
  return f32(uhash(bitcast<u32>(ip.x), bitcast<u32>(ip.y))) * (1.0 / 4294967296.0);
}

// -------- primitives --------

fn hitSphere(ro : vec3f, rd : vec3f, c : vec3f, r : f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let cc = dot(oc, oc) - r * r;
  let disc = b * b - cc;
  if (disc < 0.0) { return vec2f(-1.0, -1.0); }
  let sq = sqrt(disc);
  return vec2f(-b - sq, -b + sq);
}

fn hitCylinder(ro : vec3f, rd : vec3f, c : vec2f, r : f32, z0 : f32, z1 : f32) -> f32 {
  let oc = ro.xy - c;
  let a = dot(rd.xy, rd.xy);
  if (a < 1e-8) { return -1.0; }
  let b = dot(oc, rd.xy);
  let cc = dot(oc, oc) - r * r;
  let disc = b * b - a * cc;
  if (disc < 0.0) { return -1.0; }
  let sq = sqrt(disc);
  var t = (-b - sq) / a;
  if (t <= 0.001) { t = (-b + sq) / a; }
  if (t <= 0.001) { return -1.0; }
  let z = ro.z + rd.z * t;
  if (z < z0 || z > z1) { return -1.0; }
  return t;
}

fn hitOBB(ro : vec3f, rd : vec3f, ctr : vec3f, he : vec3f,
          ca : f32, sa : f32) -> vec4f {
  let p = ro - ctr;
  let lo = vec3f(p.x * ca + p.y * sa, -p.x * sa + p.y * ca, p.z);
  let ld = vec3f(rd.x * ca + rd.y * sa, -rd.x * sa + rd.y * ca, rd.z);
  let safe = select(ld, vec3f(1e-9, 1e-9, 1e-9), abs(ld) < vec3f(1e-9));
  let inv = 1.0 / safe;
  let t0 = (-he - lo) * inv;
  let t1 = (he - lo) * inv;
  let tmin3 = min(t0, t1);
  let tmax3 = max(t0, t1);
  let tn = max(max(tmin3.x, tmin3.y), tmin3.z);
  let tf = min(min(tmax3.x, tmax3.y), tmax3.z);
  if (tf < max(tn, 0.001)) { return vec4f(-1.0, 0.0, 0.0, 0.0); }
  var nl = vec3f(0.0, 0.0, 1.0);
  if (tmin3.x >= tmin3.y && tmin3.x >= tmin3.z) {
    nl = vec3f(-sign(ld.x), 0.0, 0.0);
  } else if (tmin3.y >= tmin3.z) {
    nl = vec3f(0.0, -sign(ld.y), 0.0);
  } else {
    nl = vec3f(0.0, 0.0, -sign(ld.z));
  }
  let nw = vec3f(nl.x * ca - nl.y * sa, nl.x * sa + nl.y * ca, nl.z);
  return vec4f(max(tn, 0.001), nw.x, nw.y, nw.z);
}

// -------- trees along a ray: DDA over integer cells, hash presence --------

struct Obj {
  t : f32, n : vec3f, albedo : vec3f, emissive : f32,
  canopy : bool, tExit : f32, alpha : f32, ok : bool,
};

fn traceTrees(ro : vec3f, rd : vec3f, tMax : f32) -> Obj {
  var o : Obj;
  o.ok = false; o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.tExit = 0.0;
  var best = tMax;

  let hlen = length(rd.xy);
  if (hlen < 1e-6) { return o; }
  let rd2 = rd.xy / hlen;
  var mapX = i32(floor(ro.x));
  var mapY = i32(floor(ro.y));
  let dD = abs(1.0 / max(abs(rd2), vec2f(1e-9)));
  var sgn = vec2i(1, 1);
  var side = vec2f(0.0);
  if (rd2.x < 0.0) { sgn.x = -1; side.x = (ro.x - f32(mapX)) * dD.x; }
  else { side.x = (f32(mapX) + 1.0 - ro.x) * dD.x; }
  if (rd2.y < 0.0) { sgn.y = -1; side.y = (ro.y - f32(mapY)) * dD.y; }
  else { side.y = (f32(mapY) + 1.0 - ro.y) * dD.y; }

  let reach = i32(U.treeReach);
  let maxD = tMax * hlen;

  for (var i = 0; i < 40; i = i + 1) {
    // neighbourhood search around the current cell: canopies overhang
    for (var oy = -reach; oy <= reach; oy = oy + 1) {
    for (var ox = -reach; ox <= reach; ox = ox + 1) {
      let tx = mapX + ox;
      let ty = mapY + oy;
      let tr = treeAt(tx, ty);
      if (!tr.present) { continue; }
      if (isFelled(tx, ty)) { continue; }
      let cen = vec2f(tr.cx, tr.cy);
      let g = terrainH(cen);
      let canZ = g + tr.trunkH + tr.r * 0.55;
      let trunkR = 0.085 + tr.r * 0.055;

      let tTrunk = hitCylinder(ro, rd, cen, trunkR, g, g + tr.trunkH);
      if (tTrunk > 0.001 && tTrunk < best) {
        best = tTrunk;
        let hp = ro + rd * tTrunk;
        o.t = tTrunk;
        o.n = normalize(vec3f(hp.xy - cen, 0.0));
        o.albedo = vec3f(0.30, 0.23, 0.17);
        o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.ok = true;
      }

      let sph = hitSphere(ro, rd, vec3f(cen, canZ), tr.r);
      if (sph.y > 0.001) {
        let tEnter = max(sph.x, 0.001);
        if (tEnter < best) {
          let hp = ro + rd * tEnter;
          let dens = vnoise(hp * 2.6) * 0.75 + vnoise(hp * 6.5) * 0.25;
          let chord = max(sph.y - tEnter, 0.0);
          let a = 1.0 - exp(-chord * 1.35 * (0.35 + 1.3 * dens));
          if (a > 0.03) {
            best = tEnter;
            o.t = tEnter;
            o.tExit = sph.y;
            o.n = normalize(normalize(hp - vec3f(cen, canZ)) +
              (vec3f(vnoise(hp * 5.1 + 11.0), vnoise(hp * 5.1 + 23.0),
                     vnoise(hp * 5.1 + 37.0)) - 0.5) * 0.55);
            o.albedo = vec3f(0.40, 0.60, 0.32);
            o.alpha = clamp(a, 0.0, 0.94);
            o.canopy = true; o.emissive = 0.0; o.ok = true;
          }
        }
      }
    }
    }
    if (o.ok) { break; }             // nearest in this neighbourhood found

    // advance the DDA by one full neighbourhood width to amortise the search
    var ended = false;
    for (var k = 0; k < 4; k = k + 1) {
      if (min(side.x, side.y) >= maxD) { ended = true; break; }
      if (side.x < side.y) { side.x = side.x + dD.x; mapX = mapX + sgn.x; }
      else { side.y = side.y + dD.y; mapY = mapY + sgn.y; }
    }
    if (ended) { break; }
  }
  return o;
}

// -------- occlusion for shadows and AO --------
// Occlusion rays return TRANSMITTANCE, not a boolean: solid hits give 0,
// canopies multiply in their translucency. A stochastic canopy test would
// need many rays to average clean - with near-parallel sun rays it dithers
// into blocky speckle - while transmittance is deterministic and smooth at
// the same cost. Budgeted: coarse terrain march, single-cell tree walk.

fn transmit(ro : vec3f, rd : vec3f, maxT : f32) -> f32 {
  // Underground origins first march the density field: cave walls block
  // fully, resurfacing through a mouth hands over to the terrain march below
  // (that is what makes entrance light shafts), and rays still in cave air
  // when the budget ends are blocked - deep caves see no sky. A ray that
  // outruns maxT while still in cave air is free: nothing within radius.
  var t0 = 0.2;
  let oGz = terrainH(ro.xy);
  if (ro.z < oGz &&
      min(oGz - ro.z, -caveV(ro, oGz)) + editDelta(ro) < 0.0) {
    var t = 0.15;
    var escaped = false;
    for (var i = 0; i < ${CAVES.TSTEPS}; i = i + 1) {
      if (t > maxT) { return 1.0; }
      let p = ro + rd * t;
      let gzp = terrainH(p.xy);
      let v = caveV(p, gzp);
      if (min(gzp - p.z, -v) + editDelta(p) > 0.0) { return 0.0; }
      if (p.z - gzp > 0.3) { escaped = true; t0 = t; break; }
      t = t + CAVE_TSTEP;
    }
    if (!escaped) { return 0.0; }
  }

  // terrain: coarse march, few steps; carved crossings are air, not shadow
  if (!(ro.z >= U.maxHeight && rd.z >= 0.0)) {
    var t = t0;
    for (var i = 0; i < 22; i = i + 1) {
      if (t > maxT) { break; }
      let p = ro + rd * t;
      if (p.z >= U.maxHeight && rd.z >= 0.0) { break; }
      let gzp = terrainH(p.xy);
      let d = p.z - gzp;
      if (d < 0.0 && min(-d, -caveV(p, gzp)) + editDelta(p) > 0.0) { return 0.0; }
      t = t + clamp(d * 0.7, 0.45, 2.6);
    }
  }

  var trans = 1.0;
  // Trees: exact DDA over the cells the ray crosses, testing a 3x3
  // neighbourhood at each step - canopies overhang their anchor cell, and a
  // single-cell test shadows only disconnected slices of the crown. A short
  // history of tested anchors keeps a tree from multiplying its
  // transmittance in once per neighbouring window.
  let hlen = length(rd.xy);
  if (hlen > 1e-4) {
    let treeRange = min(maxT, 16.0);
    let rd2 = rd.xy / hlen;
    var cx = i32(floor(ro.x));
    var cy = i32(floor(ro.y));
    let dD = abs(1.0 / max(abs(rd2), vec2f(1e-9)));
    var sgn = vec2i(1, 1);
    var side = vec2f(0.0);
    if (rd2.x < 0.0) { sgn.x = -1; side.x = (ro.x - f32(cx)) * dD.x; }
    else { side.x = (f32(cx) + 1.0 - ro.x) * dD.x; }
    if (rd2.y < 0.0) { sgn.y = -1; side.y = (ro.y - f32(cy)) * dD.y; }
    else { side.y = (f32(cy) + 1.0 - ro.y) * dD.y; }

    var h0 = vec2i(1 << 28, 0);
    var h1 = h0; var h2 = h0; var h3 = h0;
    let maxD = treeRange * hlen;

    for (var st = 0; st < 18; st = st + 1) {
      for (var oy = -1; oy <= 1; oy = oy + 1) {
      for (var ox = -1; ox <= 1; ox = ox + 1) {
        let tx = cx + ox;
        let ty = cy + oy;
        let tc = vec2i(tx, ty);
        if ((tc.x == h0.x && tc.y == h0.y) || (tc.x == h1.x && tc.y == h1.y) ||
            (tc.x == h2.x && tc.y == h2.y) || (tc.x == h3.x && tc.y == h3.y)) {
          continue;
        }
        let tr = treeAt(tx, ty);
        if (!tr.present) { continue; }
        // remember this anchor whether or not the ray hits its canopy
        h3 = h2; h2 = h1; h1 = h0; h0 = tc;
        if (isFelled(tx, ty)) { continue; }

        let g = terrainH(vec2f(tr.cx, tr.cy));
        let canZ = g + tr.trunkH + tr.r * 0.55;
        let tTrunk = hitCylinder(ro, rd, vec2f(tr.cx, tr.cy),
                                 0.085 + tr.r * 0.055, g, g + tr.trunkH);
        if (tTrunk > 0.001 && tTrunk * hlen < maxD) { return 0.0; }
        let sph = hitSphere(ro, rd, vec3f(tr.cx, tr.cy, canZ), tr.r);
        if (sph.y > 0.001 && sph.x * hlen < maxD) {
          let mid = ro + rd * max((sph.x + sph.y) * 0.5, 0.0);
          let dens = vnoise(mid * 2.6) * 0.75 + vnoise(mid * 6.5) * 0.25;
          let chord = max(sph.y - max(sph.x, 0.0), 0.0);
          trans = trans * exp(-chord * 1.1 * (0.3 + 1.4 * dens));
          if (trans < 0.04) { return 0.0; }
        }
      }
      }
      if (min(side.x, side.y) >= maxD) { break; }
      if (side.x < side.y) { side.x = side.x + dD.x; cx = cx + sgn.x; }
      else { side.y = side.y + dD.y; cy = cy + sgn.y; }
    }
  }
  return trans;
}

fn softShadow(p : vec3f, seed : vec2f, nRays : i32) -> f32 {
  var tt = vec3f(0.0, 0.0, 1.0);
  if (abs(U.sunDir.z) > 0.9) { tt = vec3f(1.0, 0.0, 0.0); }
  let b1 = normalize(cross(tt, U.sunDir));
  let b2 = cross(U.sunDir, b1);
  let n = nRays;
  let rot = hash1f(seed) * 6.2831853;
  var lit = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let u = (f32(i) + 0.5) / f32(n);
    let rad = sqrt(u) * U.sunAngle;
    let ang = rot + f32(i) * 2.39996323;
    let d = normalize(U.sunDir + b1 * (cos(ang) * rad) + b2 * (sin(ang) * rad));
    lit = lit + transmit(p, d, 60.0);
  }
  return lit / f32(n);
}

fn tracedAO(p : vec3f, nrm : vec3f, seed : vec2f, nRays : i32) -> f32 {
  var tt = vec3f(0.0, 0.0, 1.0);
  if (abs(nrm.z) > 0.9) { tt = vec3f(1.0, 0.0, 0.0); }
  let b1 = normalize(cross(tt, nrm));
  let b2 = cross(nrm, b1);
  let n = nRays;
  let rot = hash1f(seed + vec2f(17.0, 5.0)) * 6.2831853;
  var vis = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let u = (f32(i) + 0.5) / f32(n);
    let rr = sqrt(u);
    let zz = sqrt(max(0.0, 1.0 - u));
    let ang = rot + f32(i) * 2.39996323;
    let d = b1 * (cos(ang) * rr) + b2 * (sin(ang) * rr) + nrm * zz;
    vis = vis + transmit(p, normalize(d), U.aoRadius);
  }
  return vis / f32(n);
}

// -------- sky --------

fn shadeSky(rd : vec3f) -> vec3f {
  let t = clamp(rd.z, 0.0, 1.0);
  var col = mix(U.skyLo, U.skyHi, pow(t, 0.55));
  let d = dot(normalize(rd), U.sunDir);
  if (d > 0.9995) { return U.sunCol * 1.6; }
  col = col + U.sunCol * pow(max(d, 0.0), 220.0) * 1.1;
  col = col + U.sunCol * pow(max(d, 0.0), 18.0) * 0.22;
  if (rd.z < 0.0) {
    col = mix(U.skyLo * 0.85, col, exp(rd.z * 6.0));
  }
  return col;
}

// -------- full trace --------

struct Hit {
  t : f32, n : vec3f, albedo : vec3f, ok : bool,
  canopy : bool, tExit : f32, alpha : f32, emissive : f32,
  spec : f32,   // specular weight; zero for everything but water and metal
  cave : bool,  // underground hit: headlamp applies, fog goes to black
};

fn trace(ro : vec3f, rd : vec3f) -> Hit {
  var hit : Hit;
  hit.ok = false; hit.canopy = false; hit.tExit = 0.0;
  hit.alpha = 1.0; hit.emissive = 0.0; hit.spec = 0.0;
  hit.cave = false;
  hit.t = U.maxDist;

  // terrain
  let oGz = terrainH(ro.xy);
  let oCave = ro.z < oGz && solidD(ro) < 0.0;
  let tT = terrainT(ro, rd, U.maxDist, oCave);
  if (tT > 0.0) {
    hit.t = tT;
    let p = ro + rd * tT;
    if (caveV(p, terrainH(p.xy)) > -1.0 || abs(editDelta(p)) > 0.05) {
      // carved surface: heightfield normal is meaningless here
      hit.n = solidN(p);
      hit.albedo = vec3f(0.44, 0.41, 0.38);
      // glow lichen: sparse emissive patches, enough to navigate by and a
      // reason to look at cave walls
      let gl = vnoise(p * 1.9);
      if (gl > 0.8) {
        hit.albedo = vec3f(0.55, 0.75, 0.70);
        hit.emissive = (gl - 0.8) * 9.0;
      }
      hit.cave = true;
    } else {
      hit.n = terrainN(p.xy);
      // grass on flats, rock on slopes, sand near the waterline
      let slope = 1.0 - hit.n.z;
      var a = mix(vec3f(0.42, 0.58, 0.33), vec3f(0.52, 0.48, 0.42),
                  smoothstep(0.12, 0.38, slope));
      a = mix(vec3f(0.72, 0.66, 0.50), a,
              smoothstep(U.seaLevel + 0.15, U.seaLevel + 0.9, p.z));
      hit.albedo = a;
    }
    hit.ok = true;
  }

  // sea plane, wherever it is closer than the terrain
  if (rd.z < -1e-6) {
    let tW = (U.seaLevel - ro.z) / rd.z;
    if (tW > 0.0 && tW < hit.t) {
      let wp = ro.xy + rd.xy * tW;
      if (terrainH(wp) < U.seaLevel) {
        hit.t = tW;
        let ripple = vnoise(vec3f(wp.x * 1.4, wp.y * 1.4, U.time * 0.55));
        let ripple2 = vnoise(vec3f(wp.y * 1.4, wp.x * 1.4, U.time * 0.5));
        hit.n = normalize(vec3f((ripple - 0.5) * 0.14, (ripple2 - 0.5) * 0.14, 1.0));
        hit.albedo = mix(vec3f(0.10, 0.17, 0.27), vec3f(0.30, 0.44, 0.58), ripple);
        hit.emissive = 0.08 + ripple * 0.10;
        hit.spec = 1.0;
        hit.canopy = false;
        hit.cave = false;
        hit.ok = true;
      }
    }
  }

  // trees and entities live on the surface: a ray that starts underground
  // and dies underground cannot reach them, so skip the whole walk
  if (!(oCave && hit.cave)) {
    let ob = traceTrees(ro, rd, hit.t);
    if (ob.ok && ob.t < hit.t) {
      hit.t = ob.t;
      hit.n = ob.n;
      hit.albedo = ob.albedo;
      hit.canopy = ob.canopy;
      hit.tExit = ob.tExit;
      hit.alpha = ob.alpha;
      hit.emissive = ob.emissive;
      hit.spec = 0.0;
      hit.cave = false;
      hit.ok = true;
    }

    // entities: articulated creatures (none live yet; machinery kept)
    let n = i32(U.entCount);
    for (var i = 0; i < n; i = i + 1) {
      let e0 = ents[i * 2];
      let e1 = ents[i * 2 + 1];
      let pos = e0.xy;
      let ca = cos(e0.z);
      let sa = sin(e0.z);
      let gz = e1.x;
      let hB = hitOBB(ro, rd, vec3f(pos, gz + 0.6), vec3f(0.4, 0.4, 0.6), ca, sa);
      if (hB.x > 0.0 && hB.x < hit.t) {
        hit.t = hB.x; hit.n = hB.yzw;
        hit.albedo = vec3f(0.6, 0.6, 0.65);
        hit.canopy = false; hit.alpha = 1.0; hit.emissive = 0.0;
        hit.spec = 0.0; hit.cave = false; hit.ok = true;
      }
    }
  }
  return hit;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let px = vec2i(gid.xy);
  if (px.x >= i32(U.res.x) || px.y >= i32(U.res.y)) { return; }

  let ndc = vec2f(
    (f32(px.x) + 0.5) / U.res.x * 2.0 - 1.0,
    1.0 - (f32(px.y) + 0.5) / U.res.y * 2.0);
  let rd = normalize(U.fwd + U.right * (ndc.x * U.tanX) + U.up * (ndc.y * U.tanY));
  let ro = vec3f(U.camPos, U.eye);

  var col = vec3f(0.0);
  var throughput = 1.0;
  var org = ro;

  for (var bounce = 0; bounce < 4; bounce = bounce + 1) {
  let h = trace(org, rd);

  if (!h.ok) {
    col = col + throughput * shadeSky(rd);
    break;
  } else {
    let p = org + rd * h.t + h.n * 0.015;
    let seed = vec2f(px) + vec2f(0.37, 0.11);
    // lighting LOD: ray budgets taper with distance from the player. Beyond
    // shadeFar a penumbra or an AO pocket subtends less than one glyph, so a
    // single hard shadow ray and a constant ambient term are indistinguishable.
    let dHit = h.t + length(org - ro);
    let q = clamp(1.0 - (dHit - U.shadeNear) / max(U.shadeFar - U.shadeNear, 1e-3),
                  0.0, 1.0);
    var nSun = i32(round(U.sunSamples * q));
    var nAO = i32(round(U.aoSamples * q));
    if (h.cave) {
      nSun = min(nSun, ${CFG.CAVE_SUN});
      nAO = min(nAO, ${CFG.CAVE_AO});
    }
    // beyond shadeFar nothing is traced: unshadowed sun, constant ambient
    var sun = 1.0;
    if (nSun > 0) { sun = softShadow(p, seed, nSun); }
    var ao = 0.88;
    if (nAO > 0) { ao = tracedAO(p, h.n, seed, nAO); }
    let ndl = select(max(dot(h.n, U.sunDir), 0.0),
                     mix(abs(dot(h.n, U.sunDir)), 1.0, 0.35), h.canopy);

    let skyAmt = mix(0.55, 1.0, h.n.z * 0.5 + 0.5) * ao;
    var lit = h.albedo * U.ambCol * (U.ambI * skyAmt);
    lit = lit + h.albedo * U.sunCol *
          (U.sunI * ndl * mix(U.shadowK, 1.0, sun));
    lit = lit + h.albedo * U.sunCol * h.emissive;

    // specular only where the material reflects: water now, metal later
    if (sun > 0.0 && h.spec > 0.0) {
      let r = reflect(-U.sunDir, h.n);
      let spec = pow(max(dot(r, -rd), 0.0), 48.0);
      lit = lit + U.sunCol * spec * 0.75 * sun * h.spec;
    }

    // camera headlamp, cave hits only: sunless passages stay explorable
    if (h.cave) {
      lit = lit + h.albedo *
            (U.lampI * exp(-dHit * 0.18) * max(dot(h.n, -rd), 0.0));
    }

    // fog: outdoors fades to sky; underground fades to darkness over the
    // shorter cave view distance, so tunnels end in black, not daylight
    let fog = clamp(dHit / U.maxDist, 0.0, 1.0);
    var shaded = mix(lit, shadeSky(rd) * 1.02, pow(fog, 1.5));
    if (h.cave) {
      let fogC = clamp(dHit / CAVE_VIEW, 0.0, 1.0);
      shaded = mix(lit, vec3f(0.0), pow(fogC, 1.5));
    }

    if (h.canopy) {
      col = col + throughput * h.alpha * shaded;
      throughput = throughput * (1.0 - h.alpha);
      if (throughput < 0.02) { break; }
      org = org + rd * (h.tExit + 0.01);
      continue;
    }
    col = col + throughput * shaded;
    break;
  }
  }

  let lum = clamp(dot(col, vec3f(0.30, 0.59, 0.11)), 0.0, 1.0);
  textureStore(outTex, px, vec4f(col, lum));
}
`;
const WGSL_RENDER = /* wgsl */`
struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var o : VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f((p[vi].x + 1.0) * 0.5, (1.0 - p[vi].y) * 0.5);
  return o;
}

// all scalars after the vec2: a vec3 here would align to 16 and silently
// grow the struct to 48 bytes
struct RParams {
  gridRes : vec2f,   // 0
  levels  : f32,     // 8
  mono    : f32,     // 12
  raw     : f32,     // 16
  black   : f32,     // 20
  white   : f32,     // 24
  gamma   : f32,     // 28
};                   // size 32

@group(0) @binding(0) var lowTex : texture_2d<f32>;
@group(0) @binding(1) var atlas  : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;
@group(0) @binding(3) var<uniform> R : RParams;
// text overlay: one u32 per cell, 0 = transparent, else printable ASCII code
@group(0) @binding(4) var textAtlas : texture_2d<f32>;
@group(0) @binding(5) var<storage, read> overlay : array<u32>;

// 4x4 ordered dither. Choosing a glyph quantises brightness to the ramp's
// step count, which shows as banding across smooth gradients; offsetting by
// under one step turns each band edge into a stipple instead.
fn bayer4(p : vec2i) -> f32 {
  var m = array<f32, 16>(
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0);
  let i = (p.y & 3) * 4 + (p.x & 3);
  return m[i] / 16.0 - 0.5;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let cellF = in.uv * R.gridRes;
  let cell = clamp(floor(cellF), vec2f(0.0), R.gridRes - vec2f(1.0));
  let inCell = fract(cellF);

  let texel = textureLoad(lowTex, vec2i(cell), 0);
  let lum = texel.a;

  // debug: the shaded raymarch output as-is, no glyph mapping
  if (R.raw > 0.5) {
    var c = texel.rgb;
    if (R.mono > 0.5) { c = vec3f(lum); }
    return vec4f(c, 1.0);
  }

  // Tone curve first: without it the sky sits at the very top of the ramp,
  // where an ASCII-only set has almost no steps left, and bands.
  let tone = pow(clamp((lum - R.black) / max(R.white - R.black, 1e-3),
                       0.0, 1.0), R.gamma);

  // glyph chosen by tone, dithered by just under one ramp step
  let dith = bayer4(vec2i(cell)) / R.levels;
  let gi = floor(clamp(tone + dith, 0.0, 0.9999) * R.levels);
  let au = (gi + inCell.x) / R.levels;
  var cov = textureSample(atlas, samp, vec2f(au, inCell.y)).r;

  // Text overlay: not a layer drawn over the scene, but a substitution of
  // WHICH character this cell renders. A UI cell looks up the text atlas
  // instead of the tone-selected glyph atlas, before the shared ink step
  // below runs - so a letter is shaded exactly like any other glyph in the
  // field, and a word reads as ascii-art that happens to spell it. A space
  // (the panel's padding) leaves cov untouched, so gaps between words show
  // the scene's own glyph rather than blanking to a box.
  let ci = i32(cell.y) * i32(R.gridRes.x) + i32(cell.x);
  let code = overlay[ci];
  if (code > 32u && code < 127u) {
    let au2 = (f32(code - 32u) + inCell.x) / 95.0;
    cov = textureSampleLevel(textAtlas, samp, vec2f(au2, inCell.y), 0.0).r;
  }

  // Glyph density already encodes brightness — the glyph was picked by
  // luminance. Tinting by luminance as well would apply it twice and squash
  // the tonal range, so ink goes down at full intensity and only carries hue.
  // Normalise by the brightest channel, not by luminance: dividing a deep
  // blue by its (low) luminance overshoots and clamps the hue away, while
  // this keeps the colour and lets glyph density carry the brightness.
  var ink = vec3f(1.0);
  if (R.mono < 0.5) {
    let m = max(max(texel.r, texel.g), max(texel.b, 0.001));
    ink = texel.rgb / m;
  }
  let col = clamp(ink, vec3f(0.0), vec3f(1.0)) * cov;
  return vec4f(col, 1.0);
}
`;
