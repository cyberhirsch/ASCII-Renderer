// Player edits to the world: a sparse voxel-delta overlay on the procedural
// density field. Chunks of EDIT_CHUNK^3 signed bytes at EDIT_VOX resolution
// exist ONLY where digging happened - the rest of the infinite world stays a
// pure function of the seed. The CPU is authoritative (collision samples
// this); the GPU receives up to EDIT_MAX resident chunks nearest the player.
// Persisted to localStorage, edited chunks only.
const Edits = {
  chunks: new Map(),   // "cx,cy,cz" -> Int8Array(EDIT_CHUNK^3), z-major
  bounds: null,        // world AABB over all chunks + trilinear margin
  gpuDirty: false,     // resident set needs re-packing and upload
  needSave: false,
  saveTimer: 0,

  // persistent pack targets so per-dig uploads do not allocate
  head: null, data: null,

  key(cx, cy, cz) { return cx + ',' + cy + ',' + cz; },

  init() {
    const n = CAVES.EDIT_CHUNK;
    this.head = new Float32Array(CFG.EDIT_MAX * 4);
    this.data = new Int8Array(CFG.EDIT_MAX * n * n * n);
    this.load();
  },

  growBounds(cx, cy, cz) {
    const w = CAVES.EDIT_CHUNK * CAVES.EDIT_VOX;
    const m = CAVES.EDIT_VOX;           // trilinear reach past the chunk
    const lo = [cx * w - m, cy * w - m, cz * w - m];
    const hi = [cx * w + w + m, cy * w + w + m, cz * w + w + m];
    if (!this.bounds) { this.bounds = [...lo, ...hi]; return; }
    const b = this.bounds;
    for (let i = 0; i < 3; i++) {
      if (lo[i] < b[i]) b[i] = lo[i];
      if (hi[i] > b[i + 3]) b[i + 3] = hi[i];
    }
  },

  // signed delta at an integer voxel; 0 where no chunk exists
  voxel(ix, iy, iz) {
    const n = CAVES.EDIT_CHUNK;
    const cx = Math.floor(ix / n), cy = Math.floor(iy / n), cz = Math.floor(iz / n);
    const ch = this.chunks.get(this.key(cx, cy, cz));
    if (!ch) return 0;
    return ch[((iz - cz * n) * n + (iy - cy * n)) * n + (ix - cx * n)];
  },

  // trilinear density delta at a world point; mirror of WGSL editDelta.
  // KEEP IN SYNC.
  sample(x, y, z) {
    const b = this.bounds;
    if (!b || x < b[0] || y < b[1] || z < b[2] ||
        x > b[3] || y > b[4] || z > b[5]) return 0;
    const inv = 1 / CAVES.EDIT_VOX;
    const gx = x * inv - 0.5, gy = y * inv - 0.5, gz = z * inv - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
    const fx = gx - ix, fy = gy - iy, fz = gz - iz;
    let sum = 0;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
      const w = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
      if (w > 1e-4) sum += this.voxel(ix + ox, iy + oy, iz + oz) * w;
    }
    return sum * CAVES.EDIT_SCALE;
  },

  // Spherical smooth splat; amount < 0 digs, > 0 fills. Fills never place
  // material above the terrain surface - the primary ray march trusts the
  // heightfield in open air, so built-above-ground would be invisible.
  splat(x, y, z, r, amount) {
    const n = CAVES.EDIT_CHUNK;
    const vox = CAVES.EDIT_VOX;
    const lo = [x - r, y - r, z - r].map(v => Math.floor(v / vox - 0.5));
    const hi = [x + r, y + r, z + r].map(v => Math.ceil(v / vox - 0.5));
    for (let iy = lo[1]; iy <= hi[1]; iy++) {
      for (let ix = lo[0]; ix <= hi[0]; ix++) {
        const wx = (ix + 0.5) * vox, wy = (iy + 0.5) * vox;
        const colTop = amount > 0 ? terrainH(wx, wy) - 0.1 : Infinity;
        for (let iz = lo[2]; iz <= hi[2]; iz++) {
          const wz = (iz + 0.5) * vox;
          if (wz > colTop) continue;
          const d = Math.hypot(wx - x, wy - y, wz - z);
          if (d > r) continue;
          const fall = 1 - smoothstep(r * 0.45, r, d);
          const add = Math.round(amount * fall);
          if (add === 0) continue;
          const cx = Math.floor(ix / n), cy = Math.floor(iy / n), cz = Math.floor(iz / n);
          const k = this.key(cx, cy, cz);
          let ch = this.chunks.get(k);
          if (!ch) {
            ch = new Int8Array(n * n * n);
            this.chunks.set(k, ch);
            this.growBounds(cx, cy, cz);
          }
          const li = ((iz - cz * n) * n + (iy - cy * n)) * n + (ix - cx * n);
          ch[li] = clamp(ch[li] + add, -127, 127);
        }
      }
    }
    this.gpuDirty = true;
    this.needSave = true;
  },

  // Pack the EDIT_MAX chunks nearest the player for the GPU. Header slot:
  // (world origin xyz, used flag); data: raw signed bytes, z-major, read as
  // packed u32 words in the shader. Returns the resident count and AABB.
  pack(px, py, pz) {
    const n = CAVES.EDIT_CHUNK;
    const w = n * CAVES.EDIT_VOX;
    const keys = [...this.chunks.keys()];
    keys.sort((a, b) => {
      const pa = a.split(',').map(Number), pb = b.split(',').map(Number);
      const da = (pa[0] * w + w / 2 - px) ** 2 + (pa[1] * w + w / 2 - py) ** 2 +
                 (pa[2] * w + w / 2 - pz) ** 2;
      const db = (pb[0] * w + w / 2 - px) ** 2 + (pb[1] * w + w / 2 - py) ** 2 +
                 (pb[2] * w + w / 2 - pz) ** 2;
      return da - db;
    });
    const count = Math.min(keys.length, CFG.EDIT_MAX);
    this.head.fill(0);
    let bounds = null;
    for (let i = 0; i < count; i++) {
      const [cx, cy, cz] = keys[i].split(',').map(Number);
      this.head[i * 4] = cx * w;
      this.head[i * 4 + 1] = cy * w;
      this.head[i * 4 + 2] = cz * w;
      this.head[i * 4 + 3] = 1;
      this.data.set(this.chunks.get(keys[i]), i * n * n * n);
      const m = CAVES.EDIT_VOX;
      const lo = [cx * w - m, cy * w - m, cz * w - m];
      const hi = [cx * w + w + m, cy * w + w + m, cz * w + w + m];
      if (!bounds) bounds = [...lo, ...hi];
      else for (let d = 0; d < 3; d++) {
        if (lo[d] < bounds[d]) bounds[d] = lo[d];
        if (hi[d] > bounds[d + 3]) bounds[d + 3] = hi[d];
      }
    }
    return { count, bounds };
  },

  // ---- persistence: base64 per chunk, portable (no btoa dependency) ----
  B64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',

  enc(bytes) {
    const c = this.B64;
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i] & 0xff;
      const b = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
      const d = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
      s += c[a >> 2] + c[((a & 3) << 4) | (b >> 4)] +
           c[((b & 15) << 2) | (d >> 6)] + c[d & 63];
    }
    return s;
  },

  dec(s, out) {
    const c = this.B64;
    let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const a = c.indexOf(s[i]), b = c.indexOf(s[i + 1]);
      const d = c.indexOf(s[i + 2]), e = c.indexOf(s[i + 3]);
      if (o < out.length) out[o++] = (a << 2) | (b >> 4);
      if (o < out.length) out[o++] = ((b & 15) << 4) | (d >> 2);
      if (o < out.length) out[o++] = ((d & 3) << 6) | e;
    }
  },

  serialize() {
    const obj = {};
    for (const [k, ch] of this.chunks) obj[k] = this.enc(new Uint8Array(ch.buffer));
    return JSON.stringify(obj);
  },

  deserialize(str) {
    const n = CAVES.EDIT_CHUNK;
    this.chunks.clear();
    this.bounds = null;
    const obj = JSON.parse(str);
    for (const k of Object.keys(obj)) {
      const ch = new Int8Array(n * n * n);
      this.dec(obj[k], new Uint8Array(ch.buffer));
      this.chunks.set(k, ch);
      const [cx, cy, cz] = k.split(',').map(Number);
      this.growBounds(cx, cy, cz);
    }
    this.gpuDirty = this.chunks.size > 0;
  },

  save() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem('ascii-caves-v1', this.serialize()); }
    catch (e) { console.warn('edit save failed: ' + e.message); }
    this.needSave = false;
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem('ascii-caves-v1');
    if (!s) return;
    try { this.deserialize(s); } catch (e) { console.warn('edit load failed'); }
  },

  tick(dt) {
    if (!this.needSave) return;
    this.saveTimer += dt;
    if (this.saveTimer > 4) { this.saveTimer = 0; this.save(); }
  },
};
