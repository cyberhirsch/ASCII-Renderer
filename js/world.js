// Procedural world: terrain heightmap with rivers, a city plateau (road
// lattice, sidewalks, building footprints, plazas), trees, street furniture.
const World = {
  type: null, height: null, flags: null, bcol: null, bseed: null,
  roadX: [], roadY: [],

  base: null,   // ground type beneath a tree cell, so trees keep their paving
  elev: null,   // ground elevation in ELEV_STEP units (0..ELEV_MAX)

  idx(x, y) { return y * CFG.WORLD + x; },

  // ground z in world units
  groundZ(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (!this.inBounds(xi, yi)) return 0;
    return this.elev[this.idx(xi, yi)] * CFG.ELEV_STEP;
  },

  inBounds(x, y) { return x >= 0 && y >= 0 && x < CFG.WORLD && y < CFG.WORLD; },

  cellType(x, y) {
    if (!this.inBounds(x, y)) return T_BLDG; // world edge is solid
    return this.type[this.idx(x, y)];
  },

  isSolid(x, y) {
    const t = this.cellType(x, y);
    return t === T_BLDG || t === T_TREE;
  },

  generate(seed) {
    const W = CFG.WORLD, rng = mulberry32(seed);
    const N = W * W;
    this.type = new Uint8Array(N);
    this.base = new Uint8Array(N);
    this.height = new Uint8Array(N);
    this.flags = new Uint8Array(N);
    this.bcol = new Uint8Array(N);
    this.bseed = new Uint8Array(N);
    this.elev = new Uint8Array(N);

    // City core is centered; everything outside stays open ground
    const c0 = (W - CFG.CITY) >> 1, c1 = c0 + CFG.CITY;
    this.cityMin = c0; this.cityMax = c1;

    this.genTerrain(seed, c0, c1);

    // Road lines (3 cells wide, center cell carries lane dashes)
    this.roadX = []; this.roadY = [];
    let p = c0 + 4 + ((rng() * 4) | 0);
    while (p < c1 - 6) { this.roadX.push(p); p += 9 + ((rng() * 8) | 0); }
    p = c0 + 4 + ((rng() * 4) | 0);
    while (p < c1 - 6) { this.roadY.push(p); p += 9 + ((rng() * 8) | 0); }

    for (const cx of this.roadX) {
      for (let y = c0; y < c1; y++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = this.idx(cx + dx, y);
          this.type[i] = T_ROAD;
          this.flags[i] |= F_ROAD_V;
          if (dx === 0 && (y % 4) < 2) this.flags[i] |= F_LANE;
        }
      }
    }
    for (const cy of this.roadY) {
      for (let x = c0; x < c1; x++) {
        for (let dy = -1; dy <= 1; dy++) {
          const i = this.idx(x, cy + dy);
          this.type[i] = T_ROAD;
          this.flags[i] |= F_ROAD_H;
          if (dy === 0 && (x % 4) < 2) this.flags[i] |= F_LANE;
          else if (dy === 0) this.flags[i] &= ~F_LANE; // intersections: H wins, no double dashes
        }
      }
    }

    // Sidewalks: ring around roads
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (this.type[this.idx(x, y)] !== 0) continue;
      let nearRoad = false;
      for (let dy = -1; dy <= 1 && !nearRoad; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (this.inBounds(x + dx, y + dy) && this.type[this.idx(x + dx, y + dy)] === T_ROAD) { nearRoad = true; break; }
      if (nearRoad) this.type[this.idx(x, y)] = T_WALK;
    }

    // Block interiors: buildings on a 3x3 footprint grid, some plazas with trees.
    // Outside the city core: open plains with scattered trees.
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = this.idx(x, y);
      if (this.type[i] !== T_GRASS) continue;
      if (x < c0 || y < c0 || x >= c1 || y >= c1) {
        if (hash3(x, y, seed ^ 0x7777) < 0.015) {
          this.base[i] = this.type[i];
          this.type[i] = T_TREE;
          this.height[i] = 2 + ((hash3(x, y, seed ^ 0x78) * 2) | 0);
        }
        continue;
      }
      const fx = (x / 3) | 0, fy = (y / 3) | 0;
      const hzone = hash3(fx, fy, seed);
      if (hzone < 0.16) {
        // plaza: grass, scattered trees
        if (hash3(x, y, seed ^ 0x5111) < 0.18) {
          this.base[i] = this.type[i];
          this.type[i] = T_TREE;
          this.height[i] = 2 + ((hash3(x, y, seed ^ 0x77) * 2) | 0);
        }
        continue;
      }
      this.type[i] = T_BLDG;
      const tall = hash3(fx, fy, seed ^ 0x9e37) < 0.13;
      this.height[i] = tall
        ? 12 + ((hash3(fx, fy, seed ^ 0xabc) * 15) | 0)
        : 3 + ((hash3(fx, fy, seed ^ 0xdef) * 6) | 0);
      this.bcol[i] = (hash3(fx, fy, seed ^ 0x321) * 5) | 0;
      this.bseed[i] = (hash3(fx, fy, seed ^ 0x654) * 255) | 0;
    }

    // Street trees: sparse, on sidewalk cells not directly beside a lane crossing
    for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = this.idx(x, y);
      if (this.type[i] === T_WALK && hash3(x, y, seed ^ 0x1234) < 0.045) {
        this.base[i] = this.type[i];
        this.type[i] = T_TREE;
        this.height[i] = 2 + ((hash3(x, y, seed ^ 0x88) * 2) | 0);
      }
    }
  },

  // Terrain: fractal heightmap, mountains rising toward the world edges, the
  // city flattened onto one plateau with a blended skirt, and rivers walked
  // downhill from high ground, carving T_WATER.
  genTerrain(seed, c0, c1) {
    const W = CFG.WORLD;
    const cx = (c0 + c1) / 2, cy = cx;
    const cityR = (c1 - c0) / 2;

    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = this.idx(x, y);
      // base rolling terrain; the power remap deepens valleys toward zero
      // rather than letting fbm hover around its mean
      const n = fbm2(x / 26, y / 26, seed ^ 0x7e11);
      let e = Math.pow(n, 1.7) * CFG.TERRAIN_AMP * 1.25;
      // mountains toward the edges: ramp on chebyshev distance from centre
      const edge = Math.max(Math.abs(x - W / 2), Math.abs(y - W / 2)) / (W / 2);
      const ridge = fbm2(x / 14, y / 14, seed ^ 0x0be1);
      e += Math.pow(Math.max(0, edge - 0.55) / 0.45, 1.6) * CFG.MOUNTAIN_AMP * (0.55 + ridge * 0.7);

      // flatten the city plateau; blend across a skirt outside it
      const dx = Math.max(0, Math.abs(x - cx) - cityR);
      const dy = Math.max(0, Math.abs(y - cy) - cityR);
      const dOut = Math.hypot(dx, dy);          // 0 inside the core
      const SKIRT = 14;
      if (dOut <= 0) e = CFG.CITY_ELEV;
      else if (dOut < SKIRT) {
        const t = dOut / SKIRT;
        const s = t * t * (3 - 2 * t);
        e = CFG.CITY_ELEV * (1 - s) + e * s;
      }
      this.elev[i] = clamp(Math.round(e), 0, CFG.ELEV_MAX);
    }

    // rivers: start at high points in opposite quadrants, walk downhill
    this.carveRiver(seed ^ 0xA1, (W * 0.18) | 0, (W * 0.22) | 0);
    this.carveRiver(seed ^ 0xB2, (W * 0.80) | 0, (W * 0.76) | 0);
  },

  carveRiver(seed, sx, sy) {
    const W = CFG.WORLD;
    // find the highest cell in a small search window around the start
    let bx = sx, by = sy, be = -1;
    for (let y = Math.max(1, sy - 8); y < Math.min(W - 1, sy + 8); y++)
      for (let x = Math.max(1, sx - 8); x < Math.min(W - 1, sx + 8); x++)
        if (this.elev[this.idx(x, y)] > be) { be = this.elev[this.idx(x, y)]; bx = x; by = y; }

    let x = bx, y = by, px = 0, py = 0;
    for (let step = 0; step < 600; step++) {
      // carve: centre + orthogonal neighbours, banks flattened to water level
      const level = this.elev[this.idx(x, y)];
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (dx === 0 && dy === 0) {
          this.type[j] = T_WATER;
          this.elev[j] = Math.max(0, level - 1);
        } else if (this.type[j] !== T_WATER) {
          this.elev[j] = Math.min(this.elev[j], level);
        }
      }
      // steepest descent among 8 neighbours, with momentum as tiebreak and a
      // strong penalty for stepping toward the city: the plateau skirt is the
      // local downhill in half the map, and rivers must flow outward, not
      // pool against the city buffer
      const W2 = CFG.WORLD / 2;
      const distC = Math.hypot(x - W2, y - W2);
      let nbx = x, nby = y, nbe = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) return;           // reached the world edge
        const inward = Math.hypot(nx - W2, ny - W2) < distC ? 2.2 : 0;
        const e = this.elev[this.idx(nx, ny)] + inward
          + (dx === px && dy === py ? -0.35 : 0)
          + hash3(nx, ny, seed) * 0.6;                // meander
        if (e < nbe) { nbe = e; nbx = nx; nby = ny; }
      }
      if (nbe > this.elev[this.idx(x, y)] + 4) {
        // only steep uphill or inward left: treat as a pit
        nbx = x; nby = y;
      }
      if (nbx === x && nby === y) {
        // stuck in a pit: pool out a small lake and stop
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          this.type[j] = T_WATER;
          this.elev[j] = this.elev[this.idx(x, y)];
        }
        return;
      }
      px = nbx - x; py = nby - y;
      x = nbx; y = nby;
      // never carve through the city plateau
      if (x >= this.cityMin - 2 && x < this.cityMax + 2 &&
          y >= this.cityMin - 2 && y < this.cityMax + 2) return;
    }
  },

  // Street furniture on kerbside pavement, facing the road it serves.
  // Stored per cell as kind | variant<<8, where the variant's low two bits
  // are the facing and the rest selects a billboard sign.
  placeProps(seed) {
    const W = CFG.WORLD, N = W * W;
    this.prop = new Uint32Array(N);
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

    for (let y = 2; y < W - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = this.idx(x, y);
      if (this.type[i] !== T_WALK) continue;

      // face whichever side the carriageway is on
      let q = -1;
      for (let d = 0; d < 4; d++) {
        if (this.cellType(x + DIRS[d][0], y + DIRS[d][1]) === T_ROAD) { q = d; break; }
      }
      if (q < 0) continue;

      if ((x * 3 + y * 5) % 17 === 0) {
        this.prop[i] = P_LIGHT | (q << 8);
        continue;
      }
      if (hash3(x, y, seed ^ 0xB2) < 0.035) {
        this.prop[i] = P_BIN | (q << 8);
        continue;
      }
      if (hash3(x, y, seed ^ 0xC3) < 0.022) {
        // the panel is wide, so keep the span along the kerb clear; a building
        // directly behind it is fine and in fact typical
        const [px, py] = [-DIRS[q][1], DIRS[q][0]];
        let clear = true;
        for (let s = -1; s <= 1; s++) {
          const t = this.cellType(x + px * s, y + py * s);
          if (t === T_BLDG) { clear = false; break; }
        }
        if (!clear) continue;
        const sign = (hash3(x, y, seed ^ 0xD4) * 8) | 0;
        this.prop[i] = P_BOARD | ((q | (sign << 2)) << 8);
      }
    }
  },

  // A road intersection near the world center, for player spawn
  findSpawn() {
    const cx = CFG.WORLD / 2;
    let best = null, bestD = 1e9;
    for (const rx of this.roadX) for (const ry of this.roadY) {
      const d = (rx - cx) * (rx - cx) + (ry - cx) * (ry - cx);
      if (d < bestD) { bestD = d; best = [rx + 0.5, ry + 0.5]; }
    }
    return best || [cx, cx];
  },
};
