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
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> cells : array<u32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;
// each entity: xy = position, z = half width, w = height
@group(0) @binding(3) var<storage, read> ents : array<vec4f>;

const T_ROAD : u32 = 1u;
const T_WALK : u32 = 2u;
const T_BLDG : u32 = 3u;
const T_TREE : u32 = 4u;

struct Cell { kind : u32, h : f32 };

fn cellAt(x : i32, y : i32) -> Cell {
  let g = i32(U.gridSize);
  var c : Cell;
  if (x < 0 || y < 0 || x >= g || y >= g) {
    c.kind = 0u; c.h = 0.0;
    return c;
  }
  let p = cells[u32(y * g + x)];
  c.kind = p & 0xffu;
  c.h = f32((p >> 8u) & 0xffu);
  return c;
}

// Trees are no longer part of the height field: they are traced as a trunk
// cylinder plus a semi-transparent canopy sphere.
fn isSolid(k : u32) -> bool { return k == T_BLDG; }
fn isTree(k : u32) -> bool { return k == T_TREE; }

// Integer hash. sin()-based hashes repeat and correlate across neighbouring
// pixels, which shows up as structure in the sampling noise.
fn uhash(a : u32, b : u32) -> u32 {
  var n = a * 73856093u ^ b * 19349663u;
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
    return rd.z > 0.0 && isSolid(c.kind) && c.h > ro.z;
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
    if (isSolid(c.kind)) {
      // lowest point of the ray segment crossing this cell
      let zLo = min(ro.z + zs * dEnter, ro.z + zs * dExit);
      if (zLo < c.h) { return true; }
    } else if (isTree(c.kind)) {
      // canopies only partly block: shadow rays are stochastic across the
      // sample set, so a stand of trees casts dappled shade rather than a
      // hard silhouette. The trunk blocks outright.
      let tp = treeParams(mapX, mapY);
      if (hitCylinder(ro, rd, tp.xy, 0.10, trunkHeightOf(tp)) > 0.0) { return true; }
      let sph = hitSphere(ro, rd, tp.xyz, tp.w);
      if (sph.y > 0.001) {
        let chord = max(sph.y - max(sph.x, 0.0), 0.0);
        let opacity = clamp(1.0 - exp(-chord * 1.15), 0.0, 0.92);
        if (hash1(ro.xy * 37.0 + rd.xy * 91.0) < opacity) { return true; }
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
};

fn shadeSky(rd : vec3f) -> vec3f {
  // spherical gradient: white at the horizon, blue at the zenith
  let t = clamp(rd.z, 0.0, 1.0);
  var col = mix(vec3f(0.95, 0.96, 1.0), vec3f(0.30, 0.50, 0.92), pow(t, 0.65));
  // sun disc and glare, at its true direction
  let d = dot(normalize(rd), U.sunDir);
  if (d > 0.9995) { return vec3f(1.0, 1.0, 0.96); }
  col = col + vec3f(1.0, 0.92, 0.72) * pow(max(d, 0.0), 220.0) * 0.9;
  col = col + vec3f(1.0, 0.95, 0.85) * pow(max(d, 0.0), 18.0) * 0.18;
  if (rd.z < 0.0) {
    // below the horizon and beyond everything: ground haze
    col = mix(vec3f(0.82, 0.84, 0.88), col, exp(rd.z * 6.0));
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

// ray vs vertical cylinder (trunk); returns near distance or -1
fn hitCylinder(ro : vec3f, rd : vec3f, c : vec2f, r : f32, h : f32) -> f32 {
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
  if (z < 0.0 || z > h) { return -1.0; }
  return t;
}

// Deterministic canopy geometry for the tree in cell (cx, cy): the grid only
// stores that a tree is there, so its size and lean are derived from position.
// returns (centreX, centreY, centreZ, radius); trunk height is centreZ - r*0.6
fn treeParams(cx : i32, cy : i32) -> vec4f {
  let h = hash2(vec2f(f32(cx), f32(cy)));
  let radius = 0.55 + h.x * 0.25;      // kept under a cell to limit overhang
  let trunkH = 1.0 + h.y * 0.8;
  return vec4f(f32(cx) + 0.5, f32(cy) + 0.5, trunkH + radius * 0.6, radius);
}
fn trunkHeightOf(tp : vec4f) -> f32 { return tp.z - tp.w * 0.6; }

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

fn trace(ro : vec3f, rd : vec3f) -> Hit {
  var hit : Hit;
  hit.ok = false;
  hit.canopy = false;
  hit.tExit = 0.0;
  hit.alpha = 1.0;
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
    let dGround = select(-1.0, -ro.z / zs, zs < -1e-6);  // horiz dist to z=0

    for (var i = 0; i < 768; i = i + 1) {
      let dExit = min(side.x, side.y);
      let c = cellAt(mapX, mapY);
      let zEnter = ro.z + zs * dEnter;

      if (isSolid(c.kind)) {
        if (zEnter < c.h && zEnter >= 0.0 && dEnter > 0.0) {
          // side face. DDA distances are horizontal; the ray parameter needs
          // them divided by the ray's horizontal length.
          hit.t = dEnter / hlen;
          var n = vec3f(0.0);
          if (axis == 0) { n.x = -f32(sgn.x); } else { n.y = -f32(sgn.y); }
          hit.n = n;
          hit.albedo = select(vec3f(0.80, 0.81, 0.83), vec3f(0.45, 0.75, 0.5),
                              c.kind == T_TREE);
          hit.ok = true;
          break;
        }
        if (zs < -1e-6) {
          // descending: may land on the roof inside this cell
          let dRoof = (c.h - ro.z) / zs;
          if (dRoof >= dEnter && dRoof <= dExit) {
            hit.t = dRoof / hlen;
            hit.n = vec3f(0.0, 0.0, 1.0);
            hit.albedo = select(vec3f(0.86, 0.87, 0.89), vec3f(0.5, 0.8, 0.55),
                                c.kind == T_TREE);
            hit.ok = true;
            break;
          }
        }
      } else if (isTree(c.kind)) {
        // trunk (opaque) and canopy (semi-transparent), whichever is nearer
        let tp = treeParams(mapX, mapY);
        let tTrunk = hitCylinder(ro, rd, tp.xy, 0.10, trunkHeightOf(tp));
        let sph = hitSphere(ro, rd, tp.xyz, tp.w);
        let tCan = select(sph.x, 0.0, sph.x < 0.0 && sph.y > 0.0);
        let canValid = sph.y > 0.001;

        if (tTrunk > 0.0 && (!canValid || tTrunk <= tCan)) {
          hit.t = tTrunk;
          let hp = ro + rd * tTrunk;
          hit.n = normalize(vec3f(hp.xy - tp.xy, 0.0));
          hit.albedo = vec3f(0.34, 0.26, 0.19);
          hit.ok = true;
          break;
        }
        if (canValid) {
          hit.t = max(tCan, 0.001);
          hit.tExit = sph.y;
          let hp = ro + rd * hit.t;
          hit.n = normalize(hp - tp.xyz);
          hit.albedo = vec3f(0.42, 0.62, 0.34);
          // thicker through the middle of the sphere than at the rim
          let chord = max(sph.y - max(sph.x, 0.0), 0.0);
          hit.alpha = clamp(1.0 - exp(-chord * 1.15), 0.0, 0.92);
          hit.canopy = true;
          hit.ok = true;
          break;
        }
        if (dGround > 0.0 && dGround >= dEnter && dGround <= dExit) {
          hit.t = dGround / hlen;
          hit.n = vec3f(0.0, 0.0, 1.0);
          hit.albedo = vec3f(0.5, 0.66, 0.42);
          hit.ok = true;
          break;
        }
      } else if (dGround > 0.0 && dGround >= dEnter && dGround <= dExit) {
        hit.t = dGround / hlen;
        hit.n = vec3f(0.0, 0.0, 1.0);
        var a = vec3f(0.55, 0.72, 0.45);            // grass
        if (c.kind == T_ROAD) { a = vec3f(0.42, 0.43, 0.46); }
        if (c.kind == T_WALK) { a = vec3f(0.68, 0.68, 0.70); }
        hit.albedo = a;
        hit.ok = true;
        break;
      }

      if (dEnter > U.maxDist) { break; }
      if (zs > 0.0 && ro.z + zs * dEnter > U.maxHeight) { break; }

      dEnter = dExit;
      if (side.x < side.y) { side.x = side.x + dD.x; mapX = mapX + sgn.x; axis = 0; }
      else { side.y = side.y + dD.y; mapY = mapY + sgn.y; axis = 1; }
    }
  } else if (rd.z < 0.0) {
    // straight down
    hit.t = -ro.z / rd.z;
    hit.n = vec3f(0.0, 0.0, 1.0);
    let c = cellAt(i32(floor(ro.x)), i32(floor(ro.y)));
    hit.albedo = vec3f(0.5, 0.5, 0.52);
    hit.ok = true;
  }

  // --- entities (cars, pedestrians) as small boxes ---
  let n = i32(U.entCount);
  for (var i = 0; i < n; i = i + 1) {
    let e = ents[i];
    let lo = vec3f(e.x - e.z, e.y - e.z, 0.0);
    let hi = vec3f(e.x + e.z, e.y + e.z, e.w);
    let t = hitBox(ro, rd, lo, hi);
    if (t >= 0.0 && t < hit.t) {
      let p = ro + rd * t;
      // normal from whichever face the point sits on
      let c = (lo + hi) * 0.5;
      let d = (p - c) / max((hi - lo) * 0.5, vec3f(1e-4));
      var nn = vec3f(0.0, 0.0, 1.0);
      if (abs(d.x) > abs(d.y) && abs(d.x) > abs(d.z)) { nn = vec3f(sign(d.x), 0.0, 0.0); }
      else if (abs(d.y) > abs(d.z)) { nn = vec3f(0.0, sign(d.y), 0.0); }
      hit.t = t;
      hit.n = nn;
      hit.albedo = select(vec3f(0.75, 0.76, 0.8), vec3f(0.6, 0.62, 0.68), e.w < 1.2);
      hit.ok = true;
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

    let amb = mix(0.30, 0.55, h.n.z * 0.5 + 0.5) * ao;
    var lit = h.albedo * (amb + ndl * mix(U.shadowK, 1.0, sun) * 0.9);

    if (sun > 0.0 && !h.canopy) {
      let r = reflect(-U.sunDir, h.n);
      let spec = pow(max(dot(r, -rd), 0.0), 24.0);
      lit = lit + vec3f(1.0, 0.98, 0.92) * spec * 0.45 * sun;
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
  var ink = vec3f(1.0);
  if (R.mono < 0.5) { ink = texel.rgb / max(lum, 0.001); }
  return vec4f(clamp(ink, vec3f(0.0), vec3f(1.0)) * cov, 1.0);
}
`;
