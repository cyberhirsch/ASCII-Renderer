// Procedural city: road lattice, sidewalks, building footprints, plazas, trees.
const World = {
  type: null, height: null, flags: null, bcol: null, bseed: null,
  roadX: [], roadY: [],

  base: null,   // ground type beneath a tree cell, so trees keep their paving

  idx(x, y) { return y * CFG.WORLD + x; },

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

    // City core is centered; everything outside stays open ground
    const c0 = (W - CFG.CITY) >> 1, c1 = c0 + CFG.CITY;
    this.cityMin = c0; this.cityMax = c1;

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
