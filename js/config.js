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
  MONO: false,        // uniform grayscale (M toggles)
  // palette: hard yellow sun against a deep blue sky, with the ambient term
  // kept low so shadows go dark and the sunlight reads as the only real light
  SUN_COL: [1.00, 0.86, 0.46],
  SUN_I: 1.55,
  AMB_COL: [0.20, 0.31, 0.55],
  AMB_I: 0.45,
  SKY_HORIZON: [0.34, 0.46, 0.66],
  SKY_ZENITH: [0.04, 0.10, 0.32],
  GLYPH_SET: 'ascii', // ascii | symbols  (C cycles)
  // Tone curve applied before glyph selection. White sits at the luminance
  // sunlit surfaces actually reach (~0.79 here); above that the brightest
  // glyphs go unused, below it they clip and the highlights flatten.
  TONE_BLACK: 0.0,
  TONE_WHITE: 0.90,
  TONE_GAMMA: 0.9,
  RAW: false,         // debug: show the shaded image without glyph mapping (X)
  SUN_AZ: 0.9,        // sun azimuth (rad)
  SUN_EL: 0.7,        // sun elevation (rad) — low enough for long, readable shadows
  // Near zero: a shadowed point receives sky light, not sunlight. Leaving a
  // slice of the warm sun in shadow tints it yellow instead of blue.
  SHADOW: 0.04,
  // Angular radius of the sun disc, which sets penumbra width. The real sun
  // is 0.0047 rad; 0.05 was eleven times that and smeared every shadow edge.
  // This keeps penumbrae that widen with distance, but with a crisp contact.
  SUN_ANGLE: 0.018,
  // stratified, so these go a lot further than the same count of random rays.
  // ~20k cells x 48 rays is small work for a GPU; raise if grain remains.
  SUN_SAMPLES: 16,    // shadow rays per pixel
  AO_SAMPLES: 32,     // hemisphere rays per pixel
  AO_RADIUS: 9,       // AO ray length, in world cells
  TREE_REACH: 2,      // cells a canopy may overhang; sets the search radius
};

// Cell types
const T_GRASS = 0, T_ROAD = 1, T_WALK = 2, T_BLDG = 3, T_TREE = 4;
// Prop kinds (street furniture), must match the shader constants
const P_NONE = 0, P_LIGHT = 1, P_BIN = 2, P_BOARD = 3;
// Cell flags
const F_LANE = 1, F_ROAD_V = 2, F_ROAD_H = 4;
