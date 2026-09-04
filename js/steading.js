// What actually stands on a site.
//
// The chronicle knows a farm was founded in the 1204th year, held ninety
// people, and burned in the 1560th. The asset catalogue knows how to build
// a longhouse at any degree of ruin. Neither knows about the other, and
// this is the seam between them: given a site, it says which buildings are
// there, where each one sits, which way it faces, and how far gone it is.
//
// Nothing is stored. A steading is a pure function of the site (which is a
// pure function of the seed) and the year you ask about, so two visits to
// the same ruin find the same walls in the same places - and a ruin found
// at year 6000 is the same building the sim watched being lived in.
const Steading = {
  // What a place of each kind is made of. `n` is a count, or 'pop' for a
  // count that follows how many people the place actually held - a farm
  // that never got past forty souls is one house and a barn, and the hold
  // that ran to nine hundred is a street of them.
  //
  // Ring 0 is the middle of the place, 1 the yard around it, 2 the edge.
  // A rampart and a gate belong on the edge for the same reason they did
  // when somebody built them.
  PLAN: {
    hold: [
      { build: 'moothall',  n: 1,     ring: 0 },
      { build: 'well',      n: 1,     ring: 1 },
      { build: 'granary',   n: 1,     ring: 1 },
      { build: 'longhouse', n: 'pop', ring: 1 },
      { build: 'tower',     n: 1,     ring: 2 },
      { build: 'gate',      n: 1,     ring: 2 },
      { build: 'rampart',   n: 1,     ring: 2 },
    ],
    farm: [
      { build: 'longhouse', n: 'pop', ring: 0 },
      { build: 'granary',   n: 1,     ring: 1 },
      { build: 'byre',      n: 1,     ring: 1 },
      { build: 'fieldwall', n: 1,     ring: 2 },
    ],
    mine: [
      { build: 'adit',      n: 1,     ring: 0 },
      { build: 'headframe', n: 1,     ring: 1 },
      { build: 'spoil',     n: 1,     ring: 1 },
      { build: 'smelter',   n: 1,     ring: 1 },
      { build: 'longhouse', n: 'pop', ring: 2 },
    ],
    fort: [
      { build: 'tower',     n: 1,     ring: 0 },
      { build: 'gate',      n: 1,     ring: 1 },
      { build: 'rampart',   n: 1,     ring: 2 },
      { build: 'longhouse', n: 1,     ring: 1 },
    ],
  },

  RING: [0, 7.5, 15.0],   // world units from the middle
  POP_PER_HOUSE: 260,     // souls before another roof is wanted
  MAX_HOUSES: 5,          // and the point past which it is a street, not a count

  // Sixteen headings rather than an angle: Math.atan2 and Math.sin are not
  // guaranteed identical between engines, and two players standing in the
  // same village have to see it built the same way round.
  YAW: 16,

  // How far gone a building is, 0 as built and 1 a plan in the grass.
  // Continuous in age rather than stepped, so two ruined halls three
  // centuries apart do not wear the same face - but tuned against the
  // chronicle's own roof and wall lifetimes, so the shape you see and the
  // stage the record reports never disagree about what is standing.
  decay(S, s, now) {
    if (s.abandoned < 0 || now < s.abandoned) return 0;
    const age = now - s.abandoned;
    const wall = s.mat === 'timber' ? HIST.WALL_TIMBER : HIST.WALL_STONE;
    return clamp(age / (wall * 1.15), 0, 1);
  },

  // The buildings of one site: what, where, which way round, how ruined.
  plan(S, s, now) {
    const p = S.peoples[s.people];
    const list = this.PLAN[s.kind] || this.PLAN.farm;
    const d = this.decay(S, s, now);
    const out = [];
    let seat = 0;
    for (const item of list) {
      let n = item.n;
      if (n === 'pop') {
        n = clamp(1 + Math.floor(s.peak / this.POP_PER_HOUSE), 1, this.MAX_HOUSES);
      }
      for (let i = 0; i < n; i++) {
        const slot = seat++;
        const r = this.RING[item.ring] || 0;
        // spread the ring by slot, jittered per site so two villages of the
        // same size are not the same village
        const turn = (slot * 5 + Math.floor(hash01(s.id, slot, CFG.SEED >>> 0) * 3)) % this.YAW;
        const a = (turn / this.YAW) * Math.PI * 2;
        const jitter = 0.7 + hash01(s.id + 91, slot, CFG.SEED >>> 0) * 0.6;
        const x = s.x + (r ? Math.cos(a) * r * jitter : 0);
        const y = s.y + (r ? Math.sin(a) * r * jitter : 0);
        out.push({
          build: item.build,
          key: s.id + ':' + item.build + ':' + i,
          site: s.id,
          pos: [x, y, terrainH(x, y)],
          yaw: (Math.floor(hash01(s.id + 7, slot, CFG.SEED >>> 0) * this.YAW) / this.YAW)
               * Math.PI * 2,
          decay: d,
          cause: s.abandoned >= 0 ? (s.cause || 'left') : 'left',
          mat: s.mat,
          metal: p ? p.metal : 'copper',
        });
      }
    }
    return out;
  },

  // The same plan, built out into primitives in world space. This is the
  // list a renderer wants: every part already translated onto the ground it
  // stands on and turned the way it faces, with nothing left to place.
  parts(S, s, now) {
    const out = [];
    for (const b of this.plan(S, s, now)) {
      const fn = Build[b.build];
      if (!fn) continue;
      const ctx = assetCtx({ key: b.key, decay: b.decay, cause: b.cause,
                             mat: b.mat, metal: b.metal });
      let parts = fn(ctx);
      // the ground takes a place before it takes the walls, so it sinks
      // before it is moved onto the hillside it sank into
      parts = sinkParts(parts, b.decay);
      parts = transformParts(parts, { pos: b.pos, yaw: b.yaw });
      for (const q of parts) { q.site = s.id; q.of = b.build; out.push(q); }
    }
    return out;
  },


  // ---- handing a place to the renderer ----
  //
  // Two levels, because a village is 441 primitives and a ray must not pay
  // for all of them. Each BUILDING carries a bounding sphere, so a ray tests
  // seven spheres and only opens the one or two it actually strikes. That is
  // the same shape the reference tracer uses, one level up.
  //
  // Kinds, as the shader reads them. conv is folded onto its box: it is two
  // parts in a thousand and carrying a plane list for it would cost every
  // other primitive the space.
  KIND: { box: 0, cyl: 1, sph: 2, cone: 3, facet: 4, conv: 0 },
  PRIM_F: 20,        // floats per primitive (5 vec4)
  HEAD_F: 8,         // floats per building (2 vec4)

  // A facet's cuts come from arnd('facet' + seed, k), which folds the key
  // string into one u32 and then hashes numerically. Folding here and
  // sending the u32 lets the shader reproduce the same stone exactly
  // without ever seeing a string.
  fold(key) {
    let h = (CFG.SEED ^ 0x9E37) >>> 0;
    for (let k = 0; k < key.length; k++) h = jsUhash(h, key.charCodeAt(k));
    return h >>> 0;
  },

  matIndex(name) {
    if (!this._mat) {
      this._mat = {};
      const keys = Object.keys(AMAT);
      for (let i = 0; i < keys.length; i++) this._mat[keys[i]] = i;
    }
    const i = this._mat[name];
    return i === undefined ? this._mat.drystone || 0 : i;
  },

  // Pack the buildings nearest (px, py) into the caller's arrays. Returns
  // how many buildings and primitives were written, so nothing has to be
  // cleared between frames - the counts are the truth.
  pack(S, px, py, now, head, prim, maxHead, maxPrim) {
    // A folded seed is a full 32-bit value and a float cannot carry one
    // past 2^24, so the two seed slots are written as raw bits through a
    // u32 view and read back in the shader with bitcast.
    if (!this._u32 || this._u32.buffer !== prim.buffer) {
      this._u32 = new Uint32Array(prim.buffer);
    }
    // nearest sites first; a village is 15 units across, so a handful of
    // them covers everything the eye can reach
    const near = S.sites.slice().sort((a, b) =>
      ((a.x - px) ** 2 + (a.y - py) ** 2) - ((b.x - px) ** 2 + (b.y - py) ** 2));
    let nh = 0, np = 0;
    // where each person's geometry landed, so they can be moved without
    // laying the village out again
    this.folk = [];
    // one sphere around everything resident, so an occlusion ray far from
    // any village pays a single test rather than one per building
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const s of near) {
      if (nh >= maxHead || np >= maxPrim) break;
      if ((s.x - px) ** 2 + (s.y - py) ** 2 > this.VIEW * this.VIEW) break;
      for (const b of this.plan(S, s, now)) {
        const fn = Build[b.build];
        if (!fn) continue;
        const ctx = assetCtx({ key: b.key, decay: b.decay, cause: b.cause,
                               mat: b.mat, metal: b.metal });
        let parts = transformParts(sinkParts(fn(ctx), b.decay),
                                   { pos: b.pos, yaw: b.yaw });
        if (nh >= maxHead || np + parts.length > maxPrim) {
          return { heads: nh, prims: np, all: this.overall(lo, hi) };
        }
        const B = partsBounds(parts);
        const h = nh * this.HEAD_F;
        head[h] = B.c[0]; head[h + 1] = B.c[1]; head[h + 2] = B.c[2];
        head[h + 3] = B.r;
        head[h + 4] = np; head[h + 5] = parts.length; head[h + 6] = s.id; head[h + 7] = 0;
        for (let d = 0; d < 3; d++) {
          if (B.c[d] - B.r < lo[d]) lo[d] = B.c[d] - B.r;
          if (B.c[d] + B.r > hi[d]) hi[d] = B.c[d] + B.r;
        }
        nh++;
        for (const q of parts) np = this.writePrim(prim, np, q, b);
      }
      // and whoever is standing among them, on the same footing: their own
      // header, so a ray rejects a person with one sphere like anything else
      if (typeof NPC !== 'undefined') {
        for (const who of NPC.atSite(s.id)) {
          if (nh >= maxHead) break;
          const fig = NPC.parts(who);
          if (np + fig.length > maxPrim) break;
          const B = partsBounds(fig);
          const h = nh * this.HEAD_F;
          head[h] = B.c[0]; head[h + 1] = B.c[1]; head[h + 2] = B.c[2];
          head[h + 3] = B.r;
          head[h + 4] = np; head[h + 5] = fig.length; head[h + 6] = s.id;
          head[h + 7] = 1;                     // 1 marks a person, not a wall
          for (let d = 0; d < 3; d++) {
            if (B.c[d] - B.r < lo[d]) lo[d] = B.c[d] - B.r;
            if (B.c[d] + B.r > hi[d]) hi[d] = B.c[d] + B.r;
          }
          this.folk.push({ who, head: nh, prim: np, count: fig.length });
          nh++;
          for (const q of fig) np = this.writePrim(prim, np, q, who);
        }
      }
    }
    // The people move inside the set without it being repacked, so the
    // sphere that holds everything has to already cover wherever any of
    // them can get to. Cheaper than growing it every frame, and it can
    // only ever be too big, which costs one wasted sphere test.
    if (this.folk.length && typeof NPC !== 'undefined') {
      for (let d = 0; d < 3; d++) { lo[d] -= NPC.ROAM_MAX; hi[d] += NPC.ROAM_MAX; }
    }
    return { heads: nh, prims: np, all: this.overall(lo, hi) };
  },

  // Move the people who are already resident, and leave the village alone.
  // Nine people is sixty-three primitives; laying out the buildings around
  // them is thousands, and none of it has changed. Returns the blocks that
  // were touched so the renderer uploads those and nothing else.
  repose(head, prim) {
    if (!this.folk || !this.folk.length || typeof NPC === 'undefined') return null;
    let hLo = 1e9, hHi = -1, pLo = 1e9, pHi = -1;
    for (const f of this.folk) {
      const fig = NPC.parts(f.who);
      // the figure is a fixed seven parts; if that ever stops being true,
      // leave the slot alone rather than writing over the next person
      if (fig.length !== f.count) continue;
      const B = partsBounds(fig);
      const h = f.head * this.HEAD_F;
      head[h] = B.c[0]; head[h + 1] = B.c[1]; head[h + 2] = B.c[2];
      head[h + 3] = B.r;
      let np = f.prim;
      for (const q of fig) np = this.writePrim(prim, np, q, f.who);
      if (f.head < hLo) hLo = f.head;
      if (f.head > hHi) hHi = f.head;
      if (f.prim < pLo) pLo = f.prim;
      if (np > pHi) pHi = np;
    }
    if (hHi < 0) return null;
    return { headFrom: hLo, headTo: hHi + 1, primFrom: pLo, primTo: pHi };
  },

  // the sphere that holds everything resident, or null when nothing is
  overall(lo, hi) {
    if (lo[0] > hi[0]) return null;
    const c = [0, 0, 0];
    let r = 0;
    for (let d = 0; d < 3; d++) c[d] = (lo[d] + hi[d]) / 2;
    for (let d = 0; d < 3; d++) r += (hi[d] - lo[d]) ** 2;
    return [c[0], c[1], c[2], Math.sqrt(r) / 2 + 0.01];
  },

  VIEW: 260,   // world units: past this a village is under a character cell

  writePrim(prim, np, q, b) {
    const o = np * this.PRIM_F;
    const m = q.m || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const mat = this.matIndex(q.mat);
    let a0 = 0, a1 = 0, a2 = 0, e1 = 0, e2 = 0;
    let cx = 0, cy = 0, cz = 0;
    const k = this.KIND[q.k] === undefined ? 0 : this.KIND[q.k];
    if (q.k === 'cyl' || q.k === 'cone') {
      // the anchor is the base of the axis, and the axis runs up local +z
      cx = q.c[0]; cy = q.c[1]; cz = q.z0;
      a1 = q.z1 - q.z0;
      if (q.k === 'cyl') a0 = q.r; else { a0 = q.r0; a2 = q.r1; }
    } else if (q.k === 'conv') {
      // folded onto its own box, which is what its planes are cut from
      const bb = partBounds(q);
      cx = (bb.lo[0] + bb.hi[0]) / 2; cy = (bb.lo[1] + bb.hi[1]) / 2;
      cz = (bb.lo[2] + bb.hi[2]) / 2;
      a0 = (bb.hi[0] - bb.lo[0]) / 2; a1 = (bb.hi[1] - bb.lo[1]) / 2;
      a2 = (bb.hi[2] - bb.lo[2]) / 2;
    } else {
      cx = q.c[0]; cy = q.c[1]; cz = q.c[2];
      if (q.k === 'box') { a0 = q.he[0]; a1 = q.he[1]; a2 = q.he[2]; }
      else a0 = q.r;
      if (q.k === 'facet') {
        e1 = this.fold('facet' + q.seed);
        e2 = this.fold('cut' + q.seed);
      }
    }
    prim[o] = cx; prim[o + 1] = cy; prim[o + 2] = cz; prim[o + 3] = k;
    prim[o + 4] = a0; prim[o + 5] = a1; prim[o + 6] = a2; prim[o + 7] = mat;
    prim[o + 8] = m[0]; prim[o + 9] = m[1]; prim[o + 10] = m[2];
    prim[o + 12] = m[3]; prim[o + 13] = m[4]; prim[o + 14] = m[5];
    this._u32[o + 11] = e1 >>> 0;
    this._u32[o + 15] = e2 >>> 0;
    prim[o + 16] = m[6]; prim[o + 17] = m[7]; prim[o + 18] = m[8]; prim[o + 19] = 0;
    return np + 1;
  },

  // How much of the world one steading takes up, for a renderer that wants
  // to reject the whole place with one test before looking at any of it.
  bounds(S, s, now) { return partsBounds(this.parts(S, s, now)); },
};
