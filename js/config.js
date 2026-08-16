// Global configuration. Plain script, shared global scope (inlined at build time).
const CFG = {
  PLANE_LEN: 0.85,    // tan(horizontal half-FOV)
  MAX_DIST: 60,       // ray cutoff (world cells)
  EYE: 1.55,          // camera height above ground
  WORLD: 192,         // world grid size (cells per side)
  CITY: 96,           // city core size, centered; the rest is open ground
  SEED: 20260815,
  CAR_COUNT: 42,
  PED_COUNT: 70,
  // rendering
  MONO: true,         // uniform grayscale (M toggles)
  GLYPH_SET: 'ascii', // ascii | symbols  (C cycles)
  // tone curve applied before glyph selection: maps the scene's useful
  // brightness range onto the ramp so bright areas don't clip at the top
  // white must stay above the sky's own luminance (~0.96 at the horizon) or
  // the sky clips to one glyph and loses its gradient entirely
  TONE_BLACK: 0.02,
  TONE_WHITE: 1.0,
  TONE_GAMMA: 0.9,
  RAW: false,         // debug: show the shaded image without glyph mapping (X)
  SUN_AZ: 0.9,        // sun azimuth (rad)
  SUN_EL: 0.7,        // sun elevation (rad) — low enough for long, readable shadows
  SHADOW: 0.18,       // sun contribution inside full shadow (sky light only)
  SUN_ANGLE: 0.05,    // angular radius of the sun disc -> penumbra softness
  // stratified, so these go a lot further than the same count of random rays.
  // ~20k cells x 48 rays is small work for a GPU; raise if grain remains.
  SUN_SAMPLES: 16,    // shadow rays per pixel
  AO_SAMPLES: 32,     // hemisphere rays per pixel
  AO_RADIUS: 9,       // AO ray length, in world cells
};

// Cell types
const T_GRASS = 0, T_ROAD = 1, T_WALK = 2, T_BLDG = 3, T_TREE = 4;
// Cell flags
const F_LANE = 1, F_ROAD_V = 2, F_ROAD_H = 4;
