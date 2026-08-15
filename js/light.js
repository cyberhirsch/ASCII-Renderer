// Lighting (PRD 10b): raytraced directional sunlight + baked ambient occlusion.
// Sun visibility is a real shadow ray: from each visible surface point, march
// toward the sun through the height grid until something blocks it or the ray
// climbs above the tallest building. AO stays baked (geometry is static).
const Light = {
  ao: null, sunX: 0, sunY: 0, tanEl: 0, maxH: 0,
  // normalized 3D sun direction (surface -> sun), for specular
  lx: 0, ly: 0, lz: 0,

  bake() {
    const W = CFG.WORLD, N = W * W;
    this.ao = new Float32Array(N);
    this.sunX = Math.cos(CFG.SUN_AZ);
    this.sunY = Math.sin(CFG.SUN_AZ);
    this.tanEl = Math.tan(CFG.SUN_EL);
    const il = 1 / Math.hypot(this.sunX, this.sunY, this.tanEl);
    this.lx = this.sunX * il; this.ly = this.sunY * il; this.lz = this.tanEl * il;
    this.maxH = 0;
    for (let i = 0; i < N; i++) if (World.height[i] > this.maxH) this.maxH = World.height[i];

    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
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
      this.ao[i] = 1 - Math.min(occ * 0.28, 0.80);
    }
  },

  // shadow ray from world point (x,y,z) toward the sun: 1 = lit, SHADOW = blocked
  traceSun(x, y, z) {
    const W = CFG.WORLD;
    let px = x, py = y, pz = z;
    for (let t = 0; t < 64; t++) {
      px += this.sunX; py += this.sunY; pz += this.tanEl;
      if (pz >= this.maxH) return 1;
      const xi = px | 0, yi = py | 0;
      if (xi < 0 || yi < 0 || xi >= W || yi >= W) return 1;
      const j = yi * W + xi;
      const tt = World.type[j];
      if ((tt === T_BLDG || tt === T_TREE) && World.height[j] > pz) return CFG.SHADOW;
    }
    return 1;
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
    return this.traceSun(x, y, 0.05) * this.ao[yi * CFG.WORLD + xi];
  },
};
