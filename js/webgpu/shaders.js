// WGSL sources.
//
// Pass 1 (compute): one invocation per low-res cell, each casting a TRUE 3D
// ray — the camera basis is genuinely rotated by pitch, so vertical world
// edges converge to a third vanishing point instead of staying parallel as
// they do in a column-raycaster with a sheared horizon. Rays march the height
// field (DDA in xy, linear in z), hit building sides, roofs, the ground, or
// entity boxes, then trace a real shadow ray toward the sun and shade.
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
  gridSize  : f32,
  sunDir    : vec3f,
  shadowK   : f32,
  tanX      : f32,
  tanY      : f32,
  maxHeight : f32,
  entCount  : f32,
  sunAngle  : f32,   // angular radius of the sun disc -> penumbra width
  sunSamples: f32,
  aoSamples : f32,
  aoRadius  : f32,
  treeReach : f32,   // cells to search for overhanging canopies and props
  signCount : f32,   // rows in the billboard sign atlas
  time      : f32,
  pad1      : f32,
  sunCol    : vec3f,
  sunI      : f32,
  ambCol    : vec3f,
  ambI      : f32,
  skyLo     : vec3f,   // horizon
  pad2      : f32,
  skyHi     : vec3f,   // zenith
  pad3      : f32,
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> cells : array<u32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;
// two vec4 per entity: (x, y, heading, kind) and (halfLen, halfWid, height, phase)
@group(0) @binding(3) var<storage, read> ents : array<vec4f>;
// per cell: propKind | variant<<8
@group(0) @binding(4) var<storage, read> props : array<u32>;
@group(0) @binding(5) var signTex : texture_2d<f32>;
@group(0) @binding(6) var signSamp : sampler;

const T_ROAD : u32 = 1u;
const T_WALK : u32 = 2u;
const T_BLDG : u32 = 3u;
const T_TREE : u32 = 4u;
const T_WATER : u32 = 5u;
const ELEV_STEP : f32 = 0.5;   // world units per elevation step (bits 25..31)

// g is the cell's ground elevation in world units; buildings span g .. g+h
struct Cell { kind : u32, h : f32, base : u32, nearObj : bool, g : f32 };

fn cellAt(x : i32, y : i32) -> Cell {
  let gs = i32(U.gridSize);
  var c : Cell;
  if (x < 0 || y < 0 || x >= gs || y >= gs) {
    c.kind = 0u; c.h = 0.0; c.base = 0u; c.nearObj = false; c.g = 0.0;
    return c;
  }
  let p = cells[u32(y * gs + x)];
  c.kind = p & 0xffu;
  c.h = f32((p >> 8u) & 0xffu);
  c.base = (p >> 16u) & 0xffu;
  c.nearObj = ((p >> 24u) & 1u) != 0u;
  c.g = f32((p >> 25u) & 0x7fu) * ELEV_STEP;
  return c;
}

// value noise, for breaking the canopy up so it reads as leaves not a balloon
fn uhash3(x : i32, y : i32, z : i32) -> u32 {
  return uhash(uhash(bitcast<u32>(x), bitcast<u32>(y)), bitcast<u32>(z));
}
fn vnoise(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let ix = i32(i.x); let iy = i32(i.y); let iz = i32(i.z);
  let s = 1.0 / 4294967296.0;
  let c000 = f32(uhash3(ix,   iy,   iz  )) * s;
  let c100 = f32(uhash3(ix+1, iy,   iz  )) * s;
  let c010 = f32(uhash3(ix,   iy+1, iz  )) * s;
  let c110 = f32(uhash3(ix+1, iy+1, iz  )) * s;
  let c001 = f32(uhash3(ix,   iy,   iz+1)) * s;
  let c101 = f32(uhash3(ix+1, iy,   iz+1)) * s;
  let c011 = f32(uhash3(ix,   iy+1, iz+1)) * s;
  let c111 = f32(uhash3(ix+1, iy+1, iz+1)) * s;
  let x00 = mix(c000, c100, u.x);
  let x10 = mix(c010, c110, u.x);
  let x01 = mix(c001, c101, u.x);
  let x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// Trees are no longer part of the height field: they are traced as a trunk
// cylinder plus a semi-transparent canopy sphere.
fn isSolid(k : u32) -> bool { return k == T_BLDG; }
fn isTree(k : u32) -> bool { return k == T_TREE; }

// Integer hash. sin()-based hashes repeat and correlate across neighbouring
// pixels, which shows up as structure in the sampling noise.
fn uhash(a : u32, b : u32) -> u32 {
  var n = (a * 73856093u) ^ (b * 19349663u);
  n = n ^ (n >> 13u);
  n = n * 1274126177u;
  return n ^ (n >> 16u);
}

fn hash1(p : vec2f) -> f32 {
  let ip = vec2i(floor(p));
  return f32(uhash(bitcast<u32>(ip.x), bitcast<u32>(ip.y))) * (1.0 / 4294967296.0);
}

fn hash2(p : vec2f) -> vec2f {
  let ip = vec2i(floor(p));
  let h = uhash(bitcast<u32>(ip.x), bitcast<u32>(ip.y));
  return vec2f(f32(h & 0xffffu), f32((h >> 16u) & 0xffffu)) * (1.0 / 65536.0);
}

// Exact height-field occlusion test: walks cell boundaries with DDA rather
// than sampling at fixed intervals, so nothing is stepped over and shadow
// edges land on real geometry instead of on step boundaries.
fn occluded(ro : vec3f, rd : vec3f, maxT : f32) -> bool {
  let hlen = length(rd.xy);
  if (hlen < 1e-6) {
    let c = cellAt(i32(floor(ro.x)), i32(floor(ro.y)));
    return rd.z > 0.0 && isSolid(c.kind) && c.g + c.h > ro.z;
  }
  let rd2 = rd.xy / hlen;
  let zs = rd.z / hlen;
  let maxD = maxT * hlen;

  var mapX = i32(floor(ro.x));
  var mapY = i32(floor(ro.y));
  let dD = abs(1.0 / max(abs(rd2), vec2f(1e-9)));
  var sgn = vec2i(1, 1);
  var side = vec2f(0.0);
  if (rd2.x < 0.0) { sgn.x = -1; side.x = (ro.x - f32(mapX)) * dD.x; }
  else { side.x = (f32(mapX) + 1.0 - ro.x) * dD.x; }
  if (rd2.y < 0.0) { sgn.y = -1; side.y = (ro.y - f32(mapY)) * dD.y; }
  else { side.y = (f32(mapY) + 1.0 - ro.y) * dD.y; }

  var dEnter = 0.0;
  for (var i = 0; i < 256; i = i + 1) {
    let dExit = min(min(side.x, side.y), maxD);
    let c = cellAt(mapX, mapY);
    // lowest point of the ray segment crossing this cell
    let zLo = min(ro.z + zs * dEnter, ro.z + zs * dExit);
    if (isSolid(c.kind)) {
      if (zLo < c.g + c.h) { return true; }
    } else if (zLo < c.g) {
      // the segment dips below this cell's terrain
      return true;
    } else if (c.nearObj) {
      // Trunks, poles and signage block outright; canopies only partly, tested
      // stochastically across the sample set so a stand of trees casts dappled
      // shade rather than a hard silhouette.
      let ob = traceObjects(ro, rd, mapX, mapY, dEnter / hlen, dExit / hlen);
      if (ob.ok) {
        if (!ob.canopy) { return true; }
        if (hash1(ro.xy * 37.0 + rd.xy * 91.0) < ob.alpha) { return true; }
      }
    }
    if (dExit >= maxD) { return false; }
    if (zs > 0.0 && ro.z + zs * dEnter > U.maxHeight) { return false; }
    dEnter = dExit;
    if (side.x < side.y) { side.x = side.x + dD.x; mapX = mapX + sgn.x; }
    else { side.y = side.y + dD.y; mapY = mapY + sgn.y; }
  }
  return false;
}

// Area-light shadow: sample directions across the sun's disc, so penumbrae
// widen with distance from the occluder instead of being hard everywhere.
fn softShadow(p : vec3f, seed : vec2f) -> f32 {
  var t = vec3f(0.0, 0.0, 1.0);
  if (abs(U.sunDir.z) > 0.9) { t = vec3f(1.0, 0.0, 0.0); }
  let b1 = normalize(cross(t, U.sunDir));
  let b2 = cross(U.sunDir, b1);

  // Stratified disc sampling on a golden-angle spiral, rotated per pixel.
  // Independent random samples clump and leave gaps, so each pixel gets a
  // different estimate — that is the visible grain. An evenly spread set
  // cuts the variance dramatically for the same number of rays.
  let n = i32(U.sunSamples);
  let rot = hash1(seed) * 6.2831853;
  var lit = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let u = (f32(i) + 0.5) / f32(n);
    let rad = sqrt(u) * U.sunAngle;
    let ang = rot + f32(i) * 2.39996323;   // golden angle
    let d = normalize(U.sunDir + b1 * (cos(ang) * rad) + b2 * (sin(ang) * rad));
    if (!occluded(p, d, 90.0)) { lit = lit + 1.0; }
  }
  return lit / f32(n);
}

// Traced ambient occlusion: cosine-weighted hemisphere rays, actual visibility.
fn tracedAO(p : vec3f, nrm : vec3f, seed : vec2f) -> f32 {
  var t = vec3f(0.0, 0.0, 1.0);
  if (abs(nrm.z) > 0.9) { t = vec3f(1.0, 0.0, 0.0); }
  let b1 = normalize(cross(t, nrm));
  let b2 = cross(nrm, b1);

  // Same stratification: radius steps through the strata in order while the
  // golden angle spreads the azimuth, giving a cosine-weighted set with far
  // lower variance than independent random directions.
  let n = i32(U.aoSamples);
  let rot = hash1(seed + vec2f(17.0, 5.0)) * 6.2831853;
  var vis = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let u = (f32(i) + 0.5) / f32(n);
    let rr = sqrt(u);
    let zz = sqrt(max(0.0, 1.0 - u));
    let ang = rot + f32(i) * 2.39996323;
    let d = b1 * (cos(ang) * rr) + b2 * (sin(ang) * rr) + nrm * zz;
    if (!occluded(p, normalize(d), U.aoRadius)) { vis = vis + 1.0; }
  }
  return vis / f32(n);
}

struct Hit {
  t      : f32,     // distance along the ray
  n      : vec3f,   // surface normal
  albedo : vec3f,
  ok     : bool,
  canopy : bool,    // semi-transparent: composite and continue behind it
  tExit  : f32,     // where to resume the ray past a canopy
  alpha  : f32,     // canopy coverage for this ray
  emissive : f32,   // self-lit fraction (lamp glass, backlit signage)
};

fn shadeSky(rd : vec3f) -> vec3f {
  // spherical gradient, pale at the horizon deepening to blue overhead
  let t = clamp(rd.z, 0.0, 1.0);
  var col = mix(U.skyLo, U.skyHi, pow(t, 0.55));
  // sun disc and its glare, at the sun's true direction
  let d = dot(normalize(rd), U.sunDir);
  if (d > 0.9995) { return U.sunCol * 1.6; }
  col = col + U.sunCol * pow(max(d, 0.0), 220.0) * 1.1;
  col = col + U.sunCol * pow(max(d, 0.0), 18.0) * 0.22;
  if (rd.z < 0.0) {
    // below the horizon and beyond everything: haze off the ground
    col = mix(U.skyLo * 0.85, col, exp(rd.z * 6.0));
  }
  return col;
}

// ray vs sphere; returns (entry, exit) distances, or x < 0 on a miss.
// the exit is needed to resume the ray after a semi-transparent canopy.
fn hitSphere(ro : vec3f, rd : vec3f, c : vec3f, r : f32) -> vec2f {
  let oc = ro - c;
  let b = dot(oc, rd);
  let cc = dot(oc, oc) - r * r;
  let disc = b * b - cc;
  if (disc < 0.0) { return vec2f(-1.0, -1.0); }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

// ray vs vertical cylinder spanning z0..z1; returns near distance or -1
fn hitCylinder(ro : vec3f, rd : vec3f, c : vec2f, r : f32, z0 : f32, z1 : f32) -> f32 {
  let oc = ro.xy - c;
  let a = dot(rd.xy, rd.xy);
  if (a < 1e-8) { return -1.0; }
  let b = dot(oc, rd.xy);
  let cc = dot(oc, oc) - r * r;
  let disc = b * b - a * cc;
  if (disc < 0.0) { return -1.0; }
  let s = sqrt(disc);
  var t = (-b - s) / a;
  if (t <= 0.001) { t = (-b + s) / a; }
  if (t <= 0.001) { return -1.0; }
  let z = ro.z + rd.z * t;
  if (z < z0 || z > z1) { return -1.0; }
  return t;
}

// Ray vs box rotated about Z. Returns (t, normal); t < 0 on a miss. Almost
// every prop is built from these, so orientation lives here rather than in
// each object.
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

// local coordinates of a point on a Z-rotated box, for billboard text lookup
fn obbLocal(p : vec3f, ctr : vec3f, ca : f32, sa : f32) -> vec3f {
  let d = p - ctr;
  return vec3f(d.x * ca + d.y * sa, -d.x * sa + d.y * ca, d.z);
}

// Deterministic canopy geometry for the tree in cell (cx, cy): the grid only
// stores that a tree is there, so its size and lean are derived from position.
// returns (centreX, centreY, centreZ, radius); trunk height is centreZ - r*0.6.
// The canopy clears eye height (1.55) so you walk under trees instead of
// standing inside one; overhang is bounded by TREE_REACH on the JS side.
fn treeParams(cx : i32, cy : i32) -> vec4f {
  let h = hash2(vec2f(f32(cx), f32(cy)));
  let radius = 1.05 + h.x * 0.45;
  let trunkH = 2.7 + h.y * 1.1;
  return vec4f(f32(cx) + 0.5, f32(cy) + 0.5, trunkH + radius * 0.55, radius);
}
fn trunkHeightOf(tp : vec4f) -> f32 { return tp.z - tp.w * 0.55; }
fn trunkRadiusOf(tp : vec4f) -> f32 { return 0.085 + tp.w * 0.055; }

// ray vs axis-aligned entity box; returns distance or -1
fn hitBox(ro : vec3f, rd : vec3f, lo : vec3f, hi : vec3f) -> f32 {
  let inv = 1.0 / rd;
  let t0 = (lo - ro) * inv;
  let t1 = (hi - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let a = max(max(tmin.x, tmin.y), tmin.z);
  let b = min(min(tmax.x, tmax.y), tmax.z);
  if (b < max(a, 0.0)) { return -1.0; }
  return select(a, 0.0, a < 0.0);
}

const P_LIGHT : u32 = 1u;
const P_BIN   : u32 = 2u;
const P_BOARD : u32 = 3u;

fn propAt(x : i32, y : i32) -> vec2u {
  let g = i32(U.gridSize);
  if (x < 0 || y < 0 || x >= g || y >= g) { return vec2u(0u, 0u); }
  let p = props[u32(y * g + x)];
  return vec2u(p & 0xffu, (p >> 8u) & 0xffu);   // kind, variant
}

// facing of a prop, quantised to the four cardinal directions
fn propFacing(variant : u32) -> vec2f {
  let q = variant & 3u;
  if (q == 0u) { return vec2f(1.0, 0.0); }
  if (q == 1u) { return vec2f(0.0, 1.0); }
  if (q == 2u) { return vec2f(-1.0, 0.0); }
  return vec2f(0.0, -1.0);
}

struct Obj {
  t        : f32,
  n        : vec3f,
  albedo   : vec3f,
  emissive : f32,
  canopy   : bool,
  tExit    : f32,
  alpha    : f32,
  ok       : bool,
};

// Every grid-anchored object in the neighbourhood of a cell. Trees and props
// overhang their own cell, so testing only the cell a ray is crossing would
// slice them off at the cell walls.
fn traceObjects(ro : vec3f, rd : vec3f, cx : i32, cy : i32,
                tLo : f32, tHi : f32) -> Obj {
  var o : Obj;
  o.ok = false; o.canopy = false; o.alpha = 1.0;
  o.emissive = 0.0; o.tExit = 0.0;
  var best = tHi;
  let reach = i32(U.treeReach);

  for (var oy = -reach; oy <= reach; oy = oy + 1) {
  for (var ox = -reach; ox <= reach; ox = ox + 1) {
    let tx = cx + ox;
    let ty = cy + oy;
    let cen = vec2f(f32(tx) + 0.5, f32(ty) + 0.5);
    let oc = cellAt(tx, ty);
    let og = oc.g;                 // objects stand on their cell's terrain

    // ---- trees ----
    if (isTree(oc.kind)) {
      var tp = treeParams(tx, ty);
      let trunkTop = og + trunkHeightOf(tp);
      tp.z = tp.z + og;
      let tTrunk = hitCylinder(ro, rd, tp.xy, trunkRadiusOf(tp), og, trunkTop);
      if (tTrunk > tLo && tTrunk < best) {
        best = tTrunk;
        let hp = ro + rd * tTrunk;
        o.t = tTrunk;
        o.n = normalize(vec3f(hp.xy - tp.xy, 0.0));
        o.albedo = vec3f(0.30, 0.23, 0.17);
        o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.ok = true;
      }
      let sph = hitSphere(ro, rd, tp.xyz, tp.w);
      if (sph.y > tLo) {
        let tEnter = max(sph.x, tLo);
        if (tEnter < best) {
          let hp = ro + rd * tEnter;
          let dens = vnoise(hp * 2.6) * 0.75 + vnoise(hp * 6.5) * 0.25;
          let chord = max(sph.y - tEnter, 0.0);
          let a = 1.0 - exp(-chord * 1.35 * (0.35 + 1.3 * dens));
          if (a > 0.03) {
            best = tEnter;
            o.t = max(tEnter, 0.001);
            o.tExit = sph.y;
            o.n = normalize(normalize(hp - tp.xyz) +
              (vec3f(vnoise(hp * 5.1 + 11.0), vnoise(hp * 5.1 + 23.0),
                     vnoise(hp * 5.1 + 37.0)) - 0.5) * 0.55);
            o.albedo = vec3f(0.40, 0.60, 0.32);
            o.alpha = clamp(a, 0.0, 0.94);
            o.canopy = true; o.emissive = 0.0; o.ok = true;
          }
        }
      }
    }

    // ---- props ----
    let pr = propAt(tx, ty);
    if (pr.x == 0u) { continue; }
    let f = propFacing(pr.y);
    let ca = f.x;
    let sa = f.y;

    if (pr.x == P_LIGHT) {
      // pole, arm reaching over the kerb, and a lamp head
      let tPole = hitCylinder(ro, rd, cen, 0.055, og, og + 3.15);
      if (tPole > tLo && tPole < best) {
        best = tPole;
        let hp = ro + rd * tPole;
        o.t = tPole;
        o.n = normalize(vec3f(hp.xy - cen, 0.0));
        o.albedo = vec3f(0.22, 0.23, 0.25);
        o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.ok = true;
      }
      let armC = vec3f(cen + f * 0.42, og + 3.18);
      let hArm = hitOBB(ro, rd, armC, vec3f(0.42, 0.045, 0.045), ca, sa);
      if (hArm.x > tLo && hArm.x < best) {
        best = hArm.x;
        o.t = hArm.x; o.n = hArm.yzw;
        o.albedo = vec3f(0.22, 0.23, 0.25);
        o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.ok = true;
      }
      let lampC = vec3f(cen + f * 0.80, og + 3.06);
      let hLamp = hitOBB(ro, rd, lampC, vec3f(0.20, 0.11, 0.07), ca, sa);
      if (hLamp.x > tLo && hLamp.x < best) {
        best = hLamp.x;
        o.t = hLamp.x; o.n = hLamp.yzw;
        o.albedo = vec3f(0.85, 0.84, 0.78);
        o.canopy = false; o.alpha = 1.0;
        o.emissive = select(0.0, 0.55, hLamp.w < -0.3); // glass underside
        o.ok = true;
      }
    } else if (pr.x == P_BIN) {
      let tBin = hitCylinder(ro, rd, cen, 0.23, og, og + 0.62);
      if (tBin > tLo && tBin < best) {
        best = tBin;
        let hp = ro + rd * tBin;
        o.t = tBin;
        o.n = normalize(vec3f(hp.xy - cen, 0.0));
        o.albedo = vec3f(0.26, 0.28, 0.27);
        o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.ok = true;
      }
      let hLid = hitOBB(ro, rd, vec3f(cen, og + 0.655), vec3f(0.25, 0.25, 0.035),
                        1.0, 0.0);
      if (hLid.x > tLo && hLid.x < best) {
        best = hLid.x;
        o.t = hLid.x; o.n = hLid.yzw;
        o.albedo = vec3f(0.19, 0.20, 0.20);
        o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.ok = true;
      }
    } else if (pr.x == P_BOARD) {
      let per = vec2f(-f.y, f.x);              // along the panel's width
      for (var s = 0; s < 2; s = s + 1) {
        let side = select(-1.0, 1.0, s == 1);
        let postC = vec3f(cen + per * (side * 1.25), og + 1.55);
        let hPost = hitOBB(ro, rd, postC, vec3f(0.075, 0.075, 1.55), ca, sa);
        if (hPost.x > tLo && hPost.x < best) {
          best = hPost.x;
          o.t = hPost.x; o.n = hPost.yzw;
          o.albedo = vec3f(0.20, 0.21, 0.22);
          o.canopy = false; o.alpha = 1.0; o.emissive = 0.0; o.ok = true;
        }
      }
      let panelC = vec3f(cen, og + 4.05);
      let he = vec3f(1.55, 0.09, 1.05);
      let hP = hitOBB(ro, rd, panelC, he, ca, sa);
      if (hP.x > tLo && hP.x < best) {
        best = hP.x;
        o.t = hP.x; o.n = hP.yzw;
        o.canopy = false; o.alpha = 1.0;
        let lp = obbLocal(ro + rd * hP.x, panelC, ca, sa);
        if (abs(hP.z) > 0.5 || abs(hP.y) > 0.5) {
          // a face carrying artwork: sample the sign atlas
          let sign = f32(pr.y >> 2u);
          var u = lp.x / he.x * 0.5 + 0.5;
          if (dot(vec2f(hP.y, hP.z), f) > 0.0) { u = 1.0 - u; }
          let v = 0.5 - lp.z / he.z * 0.5;
          let texel = textureSampleLevel(signTex, signSamp,
            vec2f(clamp(u, 0.0, 1.0), (sign + clamp(v, 0.0, 1.0)) / U.signCount),
            0.0).r;
          o.albedo = mix(vec3f(0.10, 0.11, 0.13), vec3f(0.95, 0.93, 0.85), texel);
          o.emissive = texel * 0.35;
        } else {
          o.albedo = vec3f(0.17, 0.18, 0.19);   // frame edge
          o.emissive = 0.0;
        }
        o.ok = true;
      }
    }
  }
  }
  return o;
}

fn trace(ro : vec3f, rd : vec3f) -> Hit {
  var hit : Hit;
  hit.ok = false;
  hit.canopy = false;
  hit.tExit = 0.0;
  hit.alpha = 1.0;
  hit.emissive = 0.0;
  hit.t = U.maxDist;

  // --- height field: DDA in xy, z is linear in horizontal distance ---
  let hlen = length(rd.xy);
  if (hlen > 1e-5) {
    let rd2 = rd.xy / hlen;
    let zs = rd.z / hlen;            // dz per unit horizontal distance
    var mapX = i32(floor(ro.x));
    var mapY = i32(floor(ro.y));
    let dD = abs(1.0 / max(abs(rd2), vec2f(1e-9)));
    var sgn = vec2i(1, 1);
    var side = vec2f(0.0);
    if (rd2.x < 0.0) { sgn.x = -1; side.x = (ro.x - f32(mapX)) * dD.x; }
    else { side.x = (f32(mapX) + 1.0 - ro.x) * dD.x; }
    if (rd2.y < 0.0) { sgn.y = -1; side.y = (ro.y - f32(mapY)) * dD.y; }
    else { side.y = (f32(mapY) + 1.0 - ro.y) * dD.y; }

    var dEnter = 0.0;
    var axis = 0;

    for (var i = 0; i < 768; i = i + 1) {
      let dExit = min(side.x, side.y);
      let c = cellAt(mapX, mapY);
      let zEnter = ro.z + zs * dEnter;

      // Terrain riser: entering a cell below its ground level means the ray
      // struck the vertical earth face at the cell boundary.
      if (dEnter > 0.0 && zEnter < c.g) {
        hit.t = dEnter / hlen;
        var rn = vec3f(0.0);
        if (axis == 0) { rn.x = -f32(sgn.x); } else { rn.y = -f32(sgn.y); }
        hit.n = rn;
        hit.albedo = vec3f(0.48, 0.42, 0.34);          // earth / rock face
        hit.ok = true;
        break;
      }

      if (isSolid(c.kind)) {
        // building spans c.g .. c.g + c.h
        if (zEnter < c.g + c.h && dEnter > 0.0) {
          hit.t = dEnter / hlen;
          var n = vec3f(0.0);
          if (axis == 0) { n.x = -f32(sgn.x); } else { n.y = -f32(sgn.y); }
          hit.n = n;
          hit.albedo = vec3f(0.80, 0.81, 0.83);
          hit.ok = true;
          break;
        }
        if (zs < -1e-6) {
          // descending: may land on the roof inside this cell
          let dRoof = (c.g + c.h - ro.z) / zs;
          if (dRoof >= dEnter && dRoof <= dExit) {
            hit.t = dRoof / hlen;
            hit.n = vec3f(0.0, 0.0, 1.0);
            hit.albedo = vec3f(0.86, 0.87, 0.89);
            hit.ok = true;
            break;
          }
        }
      } else {
        // ground top of this cell, if the ray crosses it here
        var groundT = -1.0;
        if (zs < -1e-6) {
          let dTop = (c.g - ro.z) / zs;
          if (dTop >= dEnter && dTop <= dExit) { groundT = dTop / hlen; }
        }

        var found = false;
        if (c.nearObj) {
          var tHiObj = dExit / hlen;
          if (groundT > 0.0) { tHiObj = groundT; }   // nothing stands below ground
          let ob = traceObjects(ro, rd, mapX, mapY, dEnter / hlen, tHiObj);
          if (ob.ok) {
            hit.t = ob.t;
            hit.n = ob.n;
            hit.albedo = ob.albedo;
            hit.canopy = ob.canopy;
            hit.tExit = ob.tExit;
            hit.alpha = ob.alpha;
            hit.emissive = ob.emissive;
            hit.ok = true;
            found = true;
          }
        }
        if (found) { break; }

        if (groundT > 0.0) {
          hit.t = groundT;
          hit.n = vec3f(0.0, 0.0, 1.0);
          // a tree cell keeps whatever it was paved with underneath
          let g = select(c.kind, c.base, isTree(c.kind));
          var a = vec3f(0.55, 0.72, 0.45);            // grass
          if (g == T_ROAD) { a = vec3f(0.42, 0.43, 0.46); }
          if (g == T_WALK) { a = vec3f(0.68, 0.68, 0.70); }
          if (g == T_WATER) {
            // water: dark surface with a moving shimmer
            let wp = ro.xy + rd.xy * groundT;
            let ripple = vnoise(vec3f(wp.x * 1.7, wp.y * 1.7, U.time * 0.6));
            a = mix(vec3f(0.10, 0.16, 0.26), vec3f(0.35, 0.48, 0.62), ripple);
            hit.emissive = 0.10 + ripple * 0.12;
          }
          hit.albedo = a;
          hit.ok = true;
          break;
        }
      }

      if (dEnter > U.maxDist) { break; }
      if (zs > 0.0 && ro.z + zs * dEnter > U.maxHeight) { break; }

      dEnter = dExit;
      if (side.x < side.y) { side.x = side.x + dD.x; mapX = mapX + sgn.x; axis = 0; }
      else { side.y = side.y + dD.y; mapY = mapY + sgn.y; axis = 1; }
    }
  } else if (rd.z < 0.0) {
    // straight down: ground of the cell we are in
    let c = cellAt(i32(floor(ro.x)), i32(floor(ro.y)));
    hit.t = (c.g - ro.z) / rd.z;
    hit.n = vec3f(0.0, 0.0, 1.0);
    hit.albedo = vec3f(0.5, 0.5, 0.52);
    hit.ok = true;
  }

  // --- entities: cars and pedestrians, assembled from oriented parts ---
  let n = i32(U.entCount);
  for (var i = 0; i < n; i = i + 1) {
    let e0 = ents[i * 2];
    let e1 = ents[i * 2 + 1];
    let pos = e0.xy;
    let ca = cos(e0.z);
    let sa = sin(e0.z);
    let fwd2 = vec2f(ca, sa);
    let side2 = vec2f(-sa, ca);

    if (e0.w < 0.5) {
      // car: body, glasshouse set back, four wheels; e1.z carries ground z
      let L = e1.x;
      let W = e1.y;
      let gz = e1.z;
      let hB = hitOBB(ro, rd, vec3f(pos, gz + 0.52), vec3f(L, W, 0.22), ca, sa);
      if (hB.x > 0.0 && hB.x < hit.t) {
        hit.t = hB.x; hit.n = hB.yzw;
        hit.albedo = vec3f(0.28 + e1.w * 0.5);
        hit.canopy = false; hit.alpha = 1.0; hit.emissive = 0.0; hit.ok = true;
      }
      let hC = hitOBB(ro, rd, vec3f(pos - fwd2 * (L * 0.12), gz + 0.86),
                      vec3f(L * 0.46, W * 0.86, 0.20), ca, sa);
      if (hC.x > 0.0 && hC.x < hit.t) {
        hit.t = hC.x; hit.n = hC.yzw;
        hit.albedo = vec3f(0.15, 0.17, 0.20);
        hit.canopy = false; hit.alpha = 1.0; hit.emissive = 0.0; hit.ok = true;
      }
      for (var w = 0; w < 4; w = w + 1) {
        let fx = select(-0.62, 0.62, (w & 1) == 1);
        let fy = select(-1.0, 1.0, (w & 2) == 2);
        let off = fwd2 * (L * fx) + side2 * (W * fy);
        let hW = hitOBB(ro, rd, vec3f(pos + off, gz + 0.18),
                        vec3f(0.18, 0.055, 0.18), ca, sa);
        if (hW.x > 0.0 && hW.x < hit.t) {
          hit.t = hW.x; hit.n = hW.yzw;
          hit.albedo = vec3f(0.08, 0.08, 0.09);
          hit.canopy = false; hit.alpha = 1.0; hit.emissive = 0.0; hit.ok = true;
        }
      }
    } else {
      // pedestrian: head, torso, two legs swinging out of phase.
      // e1.x carries ground z, e1.z the body height.
      let hgt = e1.z;
      let gz = e1.x;
      let swing = sin(U.time * 5.0 + e1.w * 6.283) * 0.15;
      let headC = vec3f(pos, gz + hgt - 0.13);
      let hd = hitSphere(ro, rd, headC, 0.125);
      if (hd.x > 0.001 && hd.x < hit.t) {
        hit.t = hd.x;
        hit.n = normalize(ro + rd * hd.x - headC);
        hit.albedo = vec3f(0.60, 0.53, 0.46);
        hit.canopy = false; hit.alpha = 1.0; hit.emissive = 0.0; hit.ok = true;
      }
      let hT = hitOBB(ro, rd, vec3f(pos, gz + hgt * 0.63),
                      vec3f(0.115, 0.16, hgt * 0.20), ca, sa);
      if (hT.x > 0.0 && hT.x < hit.t) {
        hit.t = hT.x; hit.n = hT.yzw;
        hit.albedo = vec3f(0.26 + e1.w * 0.34, 0.30, 0.38);
        hit.canopy = false; hit.alpha = 1.0; hit.emissive = 0.0; hit.ok = true;
      }
      for (var l = 0; l < 2; l = l + 1) {
        let sd = select(-1.0, 1.0, l == 1);
        let off = side2 * (0.072 * sd) + fwd2 * (swing * sd);
        let hL = hitOBB(ro, rd, vec3f(pos + off, gz + hgt * 0.22),
                        vec3f(0.058, 0.058, hgt * 0.22), ca, sa);
        if (hL.x > 0.0 && hL.x < hit.t) {
          hit.t = hL.x; hit.n = hL.yzw;
          hit.albedo = vec3f(0.19, 0.20, 0.24);
          hit.canopy = false; hit.alpha = 1.0; hit.emissive = 0.0; hit.ok = true;
        }
      }
    }
  }
  return hit;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let px = vec2i(gid.xy);
  if (px.x >= i32(U.res.x) || px.y >= i32(U.res.y)) { return; }

  // true 3D ray: camera basis is genuinely rotated, giving vertical convergence
  let ndc = vec2f(
    (f32(px.x) + 0.5) / U.res.x * 2.0 - 1.0,
    1.0 - (f32(px.y) + 0.5) / U.res.y * 2.0);
  let rd = normalize(U.fwd + U.right * (ndc.x * U.tanX) + U.up * (ndc.y * U.tanY));
  let ro = vec3f(U.camPos, U.eye);

  var col = vec3f(0.0);
  var throughput = 1.0;
  var org = ro;

  // Composite through up to four semi-transparent canopies before giving up.
  for (var bounce = 0; bounce < 4; bounce = bounce + 1) {
  let h = trace(org, rd);

  if (!h.ok) {
    col = col + throughput * shadeSky(rd);
    break;
  } else {
    let p = org + rd * h.t + h.n * 0.015;
    let seed = vec2f(px) + vec2f(0.37, 0.11);
    let sun = softShadow(p, seed);
    let ao = tracedAO(p, h.n, seed);
    // foliage is lit from both sides: light scatters through the canopy
    let ndl = select(max(dot(h.n, U.sunDir), 0.0),
                     mix(abs(dot(h.n, U.sunDir)), 1.0, 0.35), h.canopy);

    // ambient is sky light: blue, weak, and gated by how much sky is visible
    let skyAmt = mix(0.55, 1.0, h.n.z * 0.5 + 0.5) * ao;
    var lit = h.albedo * U.ambCol * (U.ambI * skyAmt);
    // direct sunlight: warm, strong, the only light that casts
    lit = lit + h.albedo * U.sunCol *
          (U.sunI * ndl * mix(U.shadowK, 1.0, sun));
    // self-lit surfaces (lamp glass, backlit signage) ignore shadowing
    lit = lit + h.albedo * U.sunCol * h.emissive;

    // tight, strong highlight: a broad soft one reads as overcast light
    if (sun > 0.0 && !h.canopy) {
      let r = reflect(-U.sunDir, h.n);
      let spec = pow(max(dot(r, -rd), 0.0), 48.0);
      lit = lit + U.sunCol * spec * 0.75 * sun;
    }

    // aerial perspective toward the horizon sky colour
    let dTotal = h.t + (length(org - ro));
    let fog = clamp(dTotal / U.maxDist, 0.0, 1.0);
    let shaded = mix(lit, shadeSky(rd) * 1.02, pow(fog, 1.5));

    if (h.canopy) {
      // composite the canopy over whatever lies behind it, then resume
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
  let cov = textureSample(atlas, samp, vec2f(au, inCell.y)).r;

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
  return vec4f(clamp(ink, vec3f(0.0), vec3f(1.0)) * cov, 1.0);
}
`;
