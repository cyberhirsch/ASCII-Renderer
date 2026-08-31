// Player edits to the world: a sparse voxel-delta overlay on the procedural
// density field. Chunks of EDIT_CHUNK^3 signed bytes at EDIT_VOX resolution
// exist ONLY where digging happened - the rest of the infinite world stays a
// pure function of the seed. The CPU is authoritative (collision samples
// this); the GPU receives up to EDIT_MAX resident chunks nearest the player.
// Persisted to localStorage, edited chunks only.
const Edits = {
  chunks: new Map(),   // "cx,cy,cz" -> Int8Array(EDIT_CHUNK^3), z-major
  pos: new Map(),      // the same keys, parsed to [cx, cy, cz] once
  bounds: null,        // world AABB over all chunks + trilinear margin
  gpuDirty: false,     // resident set needs re-packing and upload
  needSave: false,
  saveTimer: 0,
  saveFailed: false,   // storage is full; say so once, not every four seconds

  // persistent pack targets so per-dig uploads do not allocate
  head: null, data: null,
  // Which chunk sits in each GPU slot, and which chunks were dug since the
  // last pack. Between them these say which of the 32 bricks actually need
  // re-uploading - a dig used to push the whole megabyte, seven times a
  // second, to change a few hundred bytes of it.
  slotKeys: [],
  dug: new Set(),

  key(cx, cy, cz) { return cx + ',' + cy + ',' + cz; },

  init() {
    const n = CAVES.EDIT_CHUNK;
    this.head = new Float32Array(CFG.EDIT_MAX * 4);
    this.data = new Int8Array(CFG.EDIT_MAX * n * n * n);
    this.slotKeys = new Array(CFG.EDIT_MAX).fill(null);
    this.load();
  },

  // the one place a chunk comes into existence, so the key, the parsed
  // coordinates and the bounds can never disagree about it
  chunkAt(cx, cy, cz) {
    const k = this.key(cx, cy, cz);
    let ch = this.chunks.get(k);
    if (!ch) {
      ch = new Int8Array(CAVES.EDIT_CHUNK ** 3);
      this.chunks.set(k, ch);
      this.pos.set(k, [cx, cy, cz]);
      this.growBounds(cx, cy, cz);
    }
    this.dug.add(k);
    return ch;
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
          const ch = this.chunkAt(cx, cy, cz);
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
  // packed u32 words in the shader. Returns the resident count, the AABB,
  // and the slots whose brick actually changed - the caller uploads those
  // and leaves the rest of the buffer alone.
  //
  // Distances come off the coordinates parsed when the chunk was made, not
  // off its key: re-splitting every key string on every dig is work that
  // grows with how much the player has dug.
  pack(px, py, pz) {
    const n = CAVES.EDIT_CHUNK;
    const w = n * CAVES.EDIT_VOX;
    const bytes = n * n * n;
    const order = [];
    for (const k of this.chunks.keys()) {
      const c = this.pos.get(k);
      order.push({ k, d: (c[0] * w + w / 2 - px) ** 2 +
                         (c[1] * w + w / 2 - py) ** 2 +
                         (c[2] * w + w / 2 - pz) ** 2 });
    }
    order.sort((a, b) => a.d - b.d);
    const count = Math.min(order.length, CFG.EDIT_MAX);
    this.head.fill(0);
    const slots = [];
    let bounds = null;
    for (let i = 0; i < count; i++) {
      const k = order[i].k;
      const [cx, cy, cz] = this.pos.get(k);
      this.head[i * 4] = cx * w;
      this.head[i * 4 + 1] = cy * w;
      this.head[i * 4 + 2] = cz * w;
      this.head[i * 4 + 3] = 1;
      // a slot only needs its brick again if a different chunk moved into
      // it, or the chunk already there has been dug since the last pack
      if (this.slotKeys[i] !== k || this.dug.has(k)) {
        this.data.set(this.chunks.get(k), i * bytes);
        slots.push(i);
      }
      this.slotKeys[i] = k;
      const m = CAVES.EDIT_VOX;
      const lo = [cx * w - m, cy * w - m, cz * w - m];
      const hi = [cx * w + w + m, cy * w + w + m, cz * w + w + m];
      if (!bounds) bounds = [...lo, ...hi];
      else for (let d = 0; d < 3; d++) {
        if (lo[d] < bounds[d]) bounds[d] = lo[d];
        if (hi[d] > bounds[d + 3]) bounds[d + 3] = hi[d];
      }
    }
    for (let i = count; i < CFG.EDIT_MAX; i++) this.slotKeys[i] = null;
    this.dug.clear();
    return { count, bounds, slots };
  },

  // ---- persistence: RLE, then base64, portable (no btoa dependency) ----
  B64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',

  // A dug chunk is almost all zeros: one scoop touches a few hundred of its
  // 32768 voxels, and the rest of the brick has never been written. Stored
  // dense, that is 43.7 KB of base64 characters for every chunk the player
  // so much as clipped, and localStorage - five megabytes, counted in
  // characters - filled up after roughly a hundred of them. Run-length
  // encoding first turns the same chunk into a few hundred bytes.
  //
  // Format: triples of (length low byte, length high byte, value). A run is
  // at most 65535 voxels, so an untouched chunk costs six bytes.
  rle(ch) {
    const out = [];
    let i = 0;
    while (i < ch.length) {
      const v = ch[i];
      let j = i + 1;
      while (j < ch.length && ch[j] === v && j - i < 65535) j++;
      const n = j - i;
      out.push(n & 0xff, (n >> 8) & 0xff, v & 0xff);
      i = j;
    }
    return Uint8Array.from(out);
  },

  unrle(bytes, out) {
    let o = 0;
    for (let i = 0; i + 2 < bytes.length; i += 3) {
      const n = bytes[i] | (bytes[i + 1] << 8);
      const v = (bytes[i + 2] << 24) >> 24;    // the stored byte is signed
      for (let k = 0; k < n && o < out.length; k++) out[o++] = v;
    }
    return o;
  },

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
    for (const [k, ch] of this.chunks) obj[k] = this.enc(this.rle(ch));
    return JSON.stringify({ v: 2, c: obj });
  },

  // Reads both shapes. A v1 save is a bare object of dense base64 blobs;
  // v2 wraps them and run-length encodes first. Old saves are read and then
  // written back out in the new form, so nobody loses a tunnel to the change.
  deserialize(str) {
    const n = CAVES.EDIT_CHUNK;
    this.chunks.clear();
    this.pos.clear();
    this.dug.clear();
    this.slotKeys.fill(null);
    this.bounds = null;
    const raw = JSON.parse(str);
    const v2 = raw && raw.v === 2;
    const obj = v2 ? raw.c : raw;
    for (const k of Object.keys(obj)) {
      const ch = new Int8Array(n * n * n);
      if (v2) {
        const packed = new Uint8Array(Math.floor(obj[k].length / 4) * 3);
        this.dec(obj[k], packed);
        this.unrle(packed, ch);
      } else {
        this.dec(obj[k], new Uint8Array(ch.buffer));
      }
      const [cx, cy, cz] = k.split(',').map(Number);
      this.chunks.set(k, ch);
      this.pos.set(k, [cx, cy, cz]);
      this.growBounds(cx, cy, cz);
    }
    this.gpuDirty = this.chunks.size > 0;
  },

  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(saveKey('ascii-caves-v1'), this.serialize());
      this.saveFailed = false;
    } catch (e) {
      // Failing silently here loses the player's digging and never says so,
      // which is the worst way for a save to break. Once is enough: the
      // next attempt is four seconds away and would say the same thing.
      if (!this.saveFailed && typeof Game !== 'undefined') {
        Game.toast('storage is full - your digging is no longer being saved');
      }
      this.saveFailed = true;
      console.warn('edit save failed: ' + e.message);
    }
    this.needSave = false;
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem(saveKey('ascii-caves-v1'));
    if (!s) return;
    try { this.deserialize(s); } catch (e) { console.warn('edit load failed'); }
  },

  tick(dt) {
    if (!this.needSave) return;
    this.saveTimer += dt;
    if (this.saveTimer > 4) { this.saveTimer = 0; this.save(); }
  },
};
