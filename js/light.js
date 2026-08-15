// Baked lighting (PRD 10b): directional sunlight + ambient occlusion.
// shadowH[cell] = height below which the cell sits in another building's
// shadow; a point at height z is sunlit iff z >= shadowH. Baked once —
// geometry is static, so runtime cost is one array lookup.
const Light = {
  shadowH: null, ao: null, sunX: 0, sunY: 0,

  bake() {
    const W = CFG.WORLD, N = W * W;
    this.shadowH = new Float32Array(N);
    this.ao = new Float32Array(N);
    this.sunX = Math.cos(CFG.SUN_AZ);
    this.sunY = Math.sin(CFG.SUN_AZ);
    const tanEl = Math.tan(CFG.SUN_EL);

    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;

      // march toward the sun; each blocker of height h at distance t casts
      // shadow up to (h - t*tan(elevation)) here
      let sh = 0;
      for (let t = 1; t <= 30; t++) {
        const cx = Math.round(x + this.sunX * t);
        const cy = Math.round(y + this.sunY * t);
        if (cx < 0 || cy < 0 || cx >= W || cy >= W) break;
        const j = cy * W + cx;
        const tt = World.type[j];
        if (tt === T_BLDG || tt === T_TREE) {
          const s = World.height[j] - t * tanEl;
          if (s > sh) sh = s;
        }
      }
      this.shadowH[i] = sh;

      // AO: occupancy-weighted 8-neighborhood, taller neighbors darken more
      let occ = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) { occ += 0.5; continue; }
        const j = ny * W + nx;
        if (World.type[j] === T_BLDG) occ += Math.min(World.height[j] / 6, 1);
        else if (World.type[j] === T_TREE) occ += 0.4;
      }
      this.ao[i] = 1 - Math.min(occ * 0.09, 0.45);
    }
  },

  // sun visibility of a point at height z over cell (x,y): 1 or shadow factor
  sunAt(x, y, z) {
    if (x < 0 || y < 0 || x >= CFG.WORLD || y >= CFG.WORLD) return 1;
    return z >= this.shadowH[y * CFG.WORLD + x] ? 1 : CFG.SHADOW;
  },

  // AO fades out with height above ground (contact darkening)
  aoLerp(x, y, z) {
    if (x < 0 || y < 0 || x >= CFG.WORLD || y >= CFG.WORLD) return 1;
    const a = this.ao[y * CFG.WORLD + x];
    const t = Math.min(z / 3, 1);
    return a + (1 - a) * t;
  },

  groundLight(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= CFG.WORLD || yi >= CFG.WORLD) return 1;
    return this.sunAt(xi, yi, 0.01) * this.ao[yi * CFG.WORLD + xi];
  },
};
