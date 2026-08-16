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

fn isSolid(k : u32) -> bool { return k == T_BLDG || k == T_TREE; }

fn hash2(p : vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
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

  let n = i32(U.sunSamples);
  var lit = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let r = hash2(seed + vec2f(f32(i) * 1.618, f32(i) * 0.577));
    let ang = r.x * 6.2831853;
    let rad = sqrt(r.y) * U.sunAngle;
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

  let n = i32(U.aoSamples);
  var vis = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let r = hash2(seed + vec2f(f32(i) * 0.7548 + 3.1, f32(i) * 0.5698 + 7.7));
    let ang = r.x * 6.2831853;
    let rr = sqrt(r.y);
    let zz = sqrt(max(0.0, 1.0 - r.y));
    let d = b1 * (cos(ang) * rr) + b2 * (sin(ang) * rr) + nrm * zz;
    if (!occluded(p, normalize(d), U.aoRadius)) { vis = vis + 1.0; }
  }
  return vis / f32(n);
}

struct Hit {
  t     : f32,      // distance along the ray
  n     : vec3f,    // surface normal
  albedo: vec3f,
  ok    : bool,
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

  var col : vec3f;
  let h = trace(ro, rd);

  if (!h.ok) {
    col = shadeSky(rd);
  } else {
    let p = ro + rd * h.t + h.n * 0.015;
    let seed = vec2f(px) + vec2f(0.37, 0.11);
    let sun = softShadow(p, seed);
    let ao = tracedAO(p, h.n, seed);
    let ndl = max(dot(h.n, U.sunDir), 0.0);

    // ambient is sky light: modulated by how much sky the point can see
    let amb = mix(0.30, 0.55, h.n.z * 0.5 + 0.5) * ao;
    var lit = h.albedo * (amb + ndl * mix(U.shadowK, 1.0, sun) * 0.9);

    // specular scaled by the visible fraction of the sun
    if (sun > 0.0) {
      let r = reflect(-U.sunDir, h.n);
      let spec = pow(max(dot(r, -rd), 0.0), 24.0);
      lit = lit + vec3f(1.0, 0.98, 0.92) * spec * 0.45 * sun;
    }

    // aerial perspective toward the horizon sky colour
    let fog = clamp(h.t / U.maxDist, 0.0, 1.0);
    col = mix(lit, shadeSky(rd) * 1.02, pow(fog, 1.5));
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
  pad0    : f32,     // 20
  pad1    : f32,     // 24
  pad2    : f32,     // 28
};                   // size 32

@group(0) @binding(0) var lowTex : texture_2d<f32>;
@group(0) @binding(1) var atlas  : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;
@group(0) @binding(3) var<uniform> R : RParams;

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

  // glyph chosen by luminance; atlas is a horizontal strip of glyphs
  let gi = floor(clamp(lum, 0.0, 0.9999) * R.levels);
  let au = (gi + inCell.x) / R.levels;
  let cov = textureSample(atlas, samp, vec2f(au, inCell.y)).r;

  var tint = texel.rgb;
  if (R.mono > 0.5) { tint = vec3f(lum); }
  return vec4f(tint * cov, 1.0);
}
`;
