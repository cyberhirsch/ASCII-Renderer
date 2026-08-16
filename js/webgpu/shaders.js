// WGSL sources for the GPU pipeline.
//
// Pass 1 (compute): one invocation per low-res cell. Each thread raymarches
// the world grid (DDA), finds the surface, then traces a real shadow ray
// toward the sun and shades it. Writes luminance + color into a storage
// texture — the "very low res image" of the requested technique.
//
// Pass 2 (render): a fullscreen triangle samples that low-res image, picks a
// glyph from the atlas by luminance, and upscales — one glyph per low-res
// pixel — producing the ASCII image at display resolution.

const WGSL_COMPUTE = /* wgsl */`
struct Uniforms {
  camPos    : vec2f,
  camDir    : vec2f,
  camPlane  : vec2f,
  gridSize  : f32,
  maxDist   : f32,
  sunDir    : vec3f,
  shadowK   : f32,
  eye       : f32,
  yScale    : f32,
  pitch     : f32,
  maxHeight : f32,
  res       : vec2f,
  _pad      : vec2f,
};

@group(0) @binding(0) var<uniform> U : Uniforms;
// cell type packed per world cell: x = type, y = height
@group(0) @binding(1) var<storage, read> cells : array<u32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;

const T_ROAD : u32 = 1u;
const T_WALK : u32 = 2u;
const T_BLDG : u32 = 3u;
const T_TREE : u32 = 4u;

fn cellAt(x : i32, y : i32) -> vec2u {
  let g = i32(U.gridSize);
  if (x < 0 || y < 0 || x >= g || y >= g) { return vec2u(T_BLDG, 8u); }
  let packed = cells[u32(y * g + x)];
  return vec2u(packed & 0xffu, (packed >> 8u) & 0xffu);
}

fn isSolid(c : vec2u) -> bool { return c.x == T_BLDG || c.x == T_TREE; }

// Real shadow ray: march toward the sun until blocked or above all geometry.
fn traceShadow(p : vec3f) -> f32 {
  var q = p;
  for (var i = 0; i < 64; i = i + 1) {
    q = q + U.sunDir;
    if (q.z >= U.maxHeight) { return 1.0; }
    let c = cellAt(i32(floor(q.x)), i32(floor(q.y)));
    if (isSolid(c) && f32(c.y) > q.z) { return U.shadowK; }
  }
  return 1.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let px = vec2i(gid.xy);
  if (px.x >= i32(U.res.x) || px.y >= i32(U.res.y)) { return; }

  let horizon = U.res.y * 0.5 + U.pitch;
  let camX = 2.0 * (f32(px.x) + 0.5) / U.res.x - 1.0;
  let rd = U.camDir + U.camPlane * camX;

  var mapX = i32(floor(U.camPos.x));
  var mapY = i32(floor(U.camPos.y));
  let dD = abs(1.0 / max(abs(rd), vec2f(1e-9)));
  var step = vec2i(1, 1);
  var side = vec2f(0.0);
  if (rd.x < 0.0) { step.x = -1; side.x = (U.camPos.x - f32(mapX)) * dD.x; }
  else { side.x = (f32(mapX) + 1.0 - U.camPos.x) * dD.x; }
  if (rd.y < 0.0) { step.y = -1; side.y = (U.camPos.y - f32(mapY)) * dD.y; }
  else { side.y = (f32(mapY) + 1.0 - U.camPos.y) * dD.y; }

  var lum = 0.0;
  var tint = vec3f(0.55, 0.70, 0.95); // sky default
  var hit = false;
  var whichSide = 0;

  for (var iter = 0; iter < 512; iter = iter + 1) {
    var dist : f32;
    if (side.x < side.y) { side.x = side.x + dD.x; mapX = mapX + step.x; whichSide = 0; dist = side.x - dD.x; }
    else { side.y = side.y + dD.y; mapY = mapY + step.y; whichSide = 1; dist = side.y - dD.y; }
    if (dist > U.maxDist) { break; }

    let c = cellAt(mapX, mapY);
    if (!isSolid(c)) { continue; }

    let d = max(dist, 0.05);
    let h = f32(c.y);
    let yBot = horizon + U.yScale * U.eye / d;
    let yTop = horizon - U.yScale * (h - U.eye) / d;
    let fy = f32(px.y);
    if (fy < yTop || fy > yBot) { continue; }

    // world height of this screen row on the wall face
    let wz = (yBot - fy) / max(yBot - yTop, 1e-4) * h;
    var n = vec3f(0.0, 0.0, 0.0);
    if (whichSide == 0) { n.x = -f32(step.x); } else { n.y = -f32(step.y); }
    let hitP = vec3f(U.camPos + rd * d, wz) + n * 0.02;

    let ndl = max(dot(n, U.sunDir), 0.0);
    let sun = traceShadow(hitP);
    var base = 0.35 + 0.65 * ndl;
    base = base * sun;

    // specular: reflect sun about the face normal
    if (sun > 0.9) {
      let r = reflect(-U.sunDir, n);
      let v = normalize(vec3f(-rd * d, U.eye - wz));
      base = base + pow(max(dot(r, v), 0.0), 12.0) * 0.5;
    }

    let fade = clamp(1.0 - d / U.maxDist, 0.0, 1.0);
    lum = clamp(base * (0.35 + 0.65 * fade) + (1.0 - fade) * 0.25, 0.0, 1.0);
    if (c.x == T_TREE) { tint = vec3f(0.55, 0.85, 0.6); } else { tint = vec3f(0.85, 0.86, 0.88); }
    hit = true;
    break;
  }

  if (!hit) {
    let fy = f32(px.y);
    if (fy < horizon) {
      // sky: white at horizon -> blue at zenith
      let t = clamp((horizon - fy) / max(horizon, 1.0), 0.0, 1.0);
      lum = 0.85 - t * 0.25;
      tint = mix(vec3f(0.96, 0.97, 1.0), vec3f(0.35, 0.55, 0.95), t);
    } else {
      // floor cast
      let rowD = U.yScale * U.eye / max(fy - horizon, 0.001);
      if (rowD < U.maxDist) {
        let fp = U.camPos + rd * rowD;
        let c = cellAt(i32(floor(fp.x)), i32(floor(fp.y)));
        let sun = traceShadow(vec3f(fp, 0.05));
        var base = select(0.45, 0.62, c.x == T_WALK);
        if (c.x == T_ROAD) { base = 0.38; }
        let fade = clamp(1.0 - rowD / U.maxDist, 0.0, 1.0);
        lum = clamp(base * sun * (0.35 + 0.65 * fade) + (1.0 - fade) * 0.25, 0.0, 1.0);
        tint = vec3f(0.8, 0.82, 0.85);
      } else {
        lum = 0.55; tint = vec3f(0.9, 0.93, 1.0);
      }
    }
  }

  textureStore(outTex, px, vec4f(tint * lum, lum));
}
`;

const WGSL_RENDER = /* wgsl */`
struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  // fullscreen triangle
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var o : VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f((p[vi].x + 1.0) * 0.5, (1.0 - p[vi].y) * 0.5);
  return o;
}

struct RParams {
  gridRes : vec2f,   // low-res cell count
  levels  : f32,     // glyph count in the atlas
  _pad    : f32,
};

@group(0) @binding(0) var lowTex : texture_2d<f32>;
@group(0) @binding(1) var atlas  : texture_2d<f32>;
@group(0) @binding(2) var samp   : sampler;
@group(0) @binding(3) var<uniform> R : RParams;

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  // which low-res cell this pixel belongs to, and where inside the glyph
  let cellF = in.uv * R.gridRes;
  let cell = floor(cellF);
  let inCell = fract(cellF);

  let texel = textureLoad(lowTex, vec2i(cell), 0);
  let lum = texel.a;

  // pick glyph by luminance, sample its coverage from the atlas strip
  let gi = floor(clamp(lum, 0.0, 0.999) * R.levels);
  let au = (gi + inCell.x) / R.levels;
  let cov = textureSample(atlas, samp, vec2f(au, inCell.y)).r;

  let color = select(texel.rgb / max(lum, 0.001), vec3f(1.0), lum <= 0.001);
  return vec4f(color * lum * cov, 1.0);
}
`;
