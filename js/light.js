// Lighting data for the GPU renderer. Sun visibility is traced per pixel in
// the compute shader; this bakes the ambient occlusion term (geometry is
// static) and the world's max height, which bounds the shadow ray.
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

};
