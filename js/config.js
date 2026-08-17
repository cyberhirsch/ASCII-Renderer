// Global configuration. Plain script, shared global scope (inlined at build time).
const CFG = {
  PLANE_LEN: 0.85,    // tan(horizontal half-FOV)
  MAX_DIST: 140,      // ray cutoff (world units); beyond fades to haze
  EYE: 1.55,          // camera height above ground
  SEED: 8151623,      // world seed; MUST stay below 2^24 so the f32 uniform
                      // carries it exactly and CPU and GPU agree on the world
  // rendering
  MONO: true,         // uniform grayscale (M toggles)
  SUN_COL: [1.00, 0.86, 0.46],
  SUN_I: 1.55,
  AMB_COL: [0.20, 0.31, 0.55],
  AMB_I: 0.55,
  SKY_HORIZON: [0.34, 0.46, 0.66],
  SKY_ZENITH: [0.04, 0.10, 0.32],
  GLYPH_SET: 'ascii', // ascii | symbols  (C cycles)
  // Tone curve applied before glyph selection. White sits at the luminance
  // sunlit surfaces actually reach; above that the brightest glyphs go
  // unused, below it they clip and the highlights flatten.
  TONE_BLACK: 0.0,
  TONE_WHITE: 0.90,
  TONE_GAMMA: 0.9,
  RAW: false,         // debug: show the shaded image without glyph mapping (X)
  SUN_AZ: 0.9,        // sun azimuth (rad)
  SUN_EL: 0.7,        // sun elevation (rad)
  SHADOW: 0.04,       // sun contribution inside full shadow (sky light only)
  SUN_ANGLE: 0.018,   // angular radius of the sun disc -> penumbra softness
  SUN_SAMPLES: 16,    // shadow rays per pixel
  AO_SAMPLES: 32,     // hemisphere rays per pixel
  AO_RADIUS: 9,       // AO ray length, world units
  TREE_REACH: 2,      // cells a canopy may overhang; sets the search radius
  // lighting LOD: full shadow/AO ray budgets inside SHADE_NEAR, tapering to
  // nothing at SHADE_FAR - beyond it no shadow or AO rays are traced at all
  SHADE_NEAR: 60,
  SHADE_FAR: 100,
  // terrain: a continuous, infinite heightfield evaluated in the shader and
  // mirrored in js/util.js. No stored grid, no world bounds.
  TERRAIN_MAX: 16,    // amplitude: highest possible ground, world units
  SEA_LEVEL: 2.4,     // water plane; terrain below this is sea/lake
  // entities (future creatures); buffer capacity fixed, live count per frame
  MAX_ENTS: 64,
};
