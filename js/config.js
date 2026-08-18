// Global configuration. Plain script, shared global scope (inlined at build time).
const CFG = {
  PLANE_LEN: 0.85,    // tan(horizontal half-FOV)
  MAX_DIST: 140,      // ray cutoff (world units); beyond fades to haze
  EYE: 1.55,          // camera height above ground
  SEED: 8151623,      // world seed; MUST stay below 2^24 so the f32 uniform
                      // carries it exactly and CPU and GPU agree on the world
  // rendering. Character cells are sized like a terminal's: monospace glyphs
  // are roughly 0.55x as wide as tall, so cells are taller than wide - and
  // bigger overall, which is both the look and far fewer rays.
  CELL_W: 12,         // CSS px per cell, horizontal
  CELL_H: 22,         // CSS px per cell, vertical
  MONO: false,        // uniform grayscale; devmode + M toggles
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
  SUN_AZ: 0.9,        // sun azimuth at t=0 (rad); the cycle sweeps from here
  SUN_EL: 0.7,        // legacy static elevation; Sky drives elevation now
  DAY_LEN: 3000,      // seconds for a full day/night cycle (50 min)
  // Twilight reach, as sin(sun elevation) either side of the horizon. Low
  // sun means a long path through air, so the light warms well before it
  // touches down - the golden hour is long on the way in, and the afterglow
  // that follows it is shorter.
  WARM_UP: 0.70,      // ~44 deg up: the light starts to turn warm
  WARM_DOWN: 0.26,    // ~15 deg down: the last of the warmth is gone
  DUSK_UP: 0.30,      // the red band in the sky, before the sun is down
  DUSK_DOWN: 0.26,    // and lingering after it
  // night sky: the moon's angular radius and how thick its crescent is
  MOON_R: 0.085,
  MOON_CRESC: 0.42,   // offset of the shadow disc, in moon radii
  MOON_GLOW: 0.10,    // halo strength around the disc
  MOON_GLOW_P: 400,   // halo tightness; higher is a smaller halo
  MOON_DARK: 0.04,    // earthshine lift on the unlit limb
  STAR_GRID: 90,      // celestial grid fineness; higher = smaller stars
  STAR_RARE: 0.976,   // hash above this is a star, at full dark
  // Stars do not arrive at sunset. The first show once the sun is a little
  // way under, and the field fills in as it sinks further - these are the
  // two depths, measured as sin(elevation) below the horizon.
  STAR_DUSK: 0.06,    // ~3.5 deg down: the brightest few
  STAR_DARK: 0.30,    // ~17 deg down: the whole field
  // The celestial pole the sky turns about. Tilted well off vertical, so
  // stars rise and set instead of just wheeling around the zenith.
  STAR_POLE_AZ: 2.2,
  STAR_POLE_EL: 0.85,
  SHADOW: 0.04,       // sun contribution inside full shadow (sky light only)
  // wide sun disc: broad, soft penumbrae that grow with distance from the
  // occluder (0.05 rad is the "soft shadows" look; the real sun is 0.0047)
  SUN_ANGLE: 0.05,
  SUN_SAMPLES: 16,    // shadow rays per pixel
  AO_SAMPLES: 32,     // hemisphere rays per pixel
  AO_RADIUS: 9,       // AO ray length, world units
  TREE_REACH: 2,      // cells a canopy may overhang; sets the search radius
  // lighting LOD: full shadow/AO ray budgets inside SHADE_NEAR, then a hard
  // cut - beyond it no shadow or AO rays are traced at all, no taper
  SHADE_NEAR: 40,
  SHADE_FAR: 40.001,
  // terrain: a continuous, infinite heightfield evaluated in the shader and
  // mirrored in js/util.js. No stored grid, no world bounds.
  TERRAIN_MAX: 16,    // amplitude: highest possible ground, world units
  // caves: view distance underground; rays in cave air stop here and fade out
  CAVE_VIEW: 60,
  // headlamp: camera-attached light so unlit caves are explorable; falls off
  // with distance, only applied to underground hits
  LAMP: 0.6,
  // Overlay cell value meaning "render nothing here". 0 is transparent (the
  // scene's own glyph) and 32 is a space (also the scene's glyph), so clear
  // air around UI text needs a code of its own.
  UI_BLANK: 31,
  // underground ray caps: sun is mostly absent down there, so penumbra
  // fidelity is worth less than frame time
  CAVE_SUN: 8,
  CAVE_AO: 16,
  SEA_LEVEL: 2.4,     // water plane; terrain below this is sea/lake
  // entities (future creatures); buffer capacity fixed, live count per frame
  MAX_ENTS: 64,
  // digging: resident edit-chunk capacity on the GPU, reach and scoop size
  EDIT_MAX: 32,
  DIG_REACH: 3.5,
  DIG_R: 1.1,
  // cleared cells visible to the GPU (nearest the player); farther cleared
  // props may visually reappear until this rises in a later phase
  REMOVED_MAX: 64,
};
