// Sun direction and world bounds for the GPU renderer. Shadows and ambient
// occlusion are both traced per pixel in the compute shader, so nothing is
// baked here any more — this only supplies the height bound that lets a
// shadow ray stop once it has climbed clear of all geometry.
const Light = {
  sunX: 0, sunY: 0, tanEl: 0, maxH: 0,

  bake() {
    this.sunX = Math.cos(CFG.SUN_AZ);
    this.sunY = Math.sin(CFG.SUN_AZ);
    this.tanEl = Math.tan(CFG.SUN_EL);
    // bound for shadow-ray early-out: highest point of terrain + building
    this.maxH = 0;
    for (let i = 0; i < World.height.length; i++) {
      const top = World.elev[i] * CFG.ELEV_STEP + World.height[i];
      if (top > this.maxH) this.maxH = top;
    }
  },
};
