// Global configuration. Plain script, shared global scope (inlined at build time).
const CFG = {
  COLS: 150,          // character grid width (recomputed from window size at init)
  ROWS: 68,           // character grid height (recomputed from window size at init)
  FONT_SIZE: 14,      // px, monospace
  PLANE_LEN: 0.85,    // camera plane half-length (horizontal FOV)
  Y_SCALE: 62,        // vertical projection factor (rows per worldunit/dist)
  MAX_DIST: 44,       // raycast cutoff (world cells)
  EYE: 1.55,          // camera height above ground
  WORLD: 192,         // world grid size (cells per side)
  CITY: 96,           // city core size, centered; the rest is open ground
  SEED: 20260815,
  CAR_COUNT: 42,
  PED_COUNT: 70,
  // rendering
  MONO: true,         // uniform grayscale for everything (M toggles)
  FLAT: true,         // buildings as plain shaded boxes, no windows
  // lighting
  DAY: true,
  SUN_AZ: 0.9,        // sun azimuth (rad)
  SUN_EL: 0.7,        // sun elevation (rad) — low enough for long, readable shadows
  SHADOW: 0.35,       // brightness factor inside cast shadows
};

// Cell types
const T_GRASS = 0, T_ROAD = 1, T_WALK = 2, T_BLDG = 3, T_TREE = 4;
// Cell flags
const F_LANE = 1, F_ROAD_V = 2, F_ROAD_H = 4;
