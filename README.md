# ASCII World

An infinite procedural world rendered entirely in ASCII characters, raymarched
per character cell in a WebGPU compute shader. Rolling terrain, forests, seas —
and beneath it all a connected cave system with carved halls, spiral stair
entrances, and free-form digging. No engine, no meshes, no stored world: every
hill and every cavern is a pure function of one seed, evaluated in the shader
as rays cross it. Ships as a single HTML file.

## Run

Open `dist/index.html` in a browser with WebGPU (current Chrome/Edge, recent
Firefox/Safari), or serve the repo root and open `index.html`.

**Controls:** WASD move · Shift run · click for mouse-look · **LMB** dig ·
**RMB** fill · **G** hop into the cave below (debug) · **M** mono/color ·
**C** glyph set · **X** raw shading (no glyphs) · **F** fullscreen.

You spawn beside a cave entrance — a round pit with a spiral stair. Walk in.

## How it works

**One ray per character cell.** A compute shader marches a true 3D ray per
low-res pixel; a render pass maps each result to a glyph by luminance
(measured-coverage atlas, ordered dither between ramp steps) and upscales.
Cells are terminal-shaped (12×22), sized 1:1 with device pixels to avoid
moire. The HUD is composited into the same glyph grid, not DOM.

**The world is a density field.** `solidD(p)` decides what is rock:

    solidD(p) = min(terrainH(p.xy) − p.z, −caveV(p)) + editDelta(p)

- `terrainH` — domain-warped fractal value noise; the infinite heightfield.
- `caveV` — the cave carve: per depth band (12 units), passages open where
  either of two value-noise fields sits near its median. The median isoline
  of a random field percolates, so the network is connected across the
  infinite plane; the union of two families adds junctions. Band floors are
  slope-bounded ramps (walkable by construction), chambers widen where a
  third noise peaks, and a coarse mask keeps ~90% of the map cave-free.
  Helical stair shafts (hash-placed, one candidate per cell, presence
  requiring a passage at the anchor) connect surface to band and band to
  band; flat-floored pillared halls sit on the network and are entered
  wherever passages puncture their walls. Protected solids (stair slabs,
  hall floors, pillars) win over every carve.
- `editDelta` — the only stored data: sparse 32³ chunks of signed byte
  deltas (0.5-unit voxels) where the player has dug or filled, sampled
  trilinearly, persisted to localStorage, streamed to the GPU as the chunks
  nearest the player.

Open terrain keeps a fast heightfield march; rays entering carved or dug
space switch to a fixed-step density march and can hand back on resurfacing,
so distant hills stay visible through a cave mouth.

**Lighting is traced.** Sun visibility is a bundle of marched shadow rays
toward a wide sun disc (soft penumbrae); ambient occlusion is traced
hemisphere rays. Both return transmittance, so canopies filter light rather
than dither it. Underground, the same occlusion rays march the cave air:
mouths cast real light shafts, and traced AO doubles as sky-openness, fading
ambient to black with depth. Glow lichen and a camera headlamp keep deep
caves navigable. Full ray budgets run within 40 m of the camera, then a hard
cut — beyond it a penumbra subtends less than one glyph.

**CPU and GPU agree bit-for-bit.** Every field function is mirrored in
`js/util.js` for collision (`Math.imul` matches WGSL u32 arithmetic; the seed
stays below 2²⁴ so an f32 uniform carries it exactly). Movement, slopes,
headroom, stair walking, and dug pits all sample the same `solidD` the
renderer draws.

## Development

Plain scripts under `js/`, shared global scope, no build step for dev.
`node build.js` inlines everything into `dist/index.html`.

The dev sandbox for this project has no GPU, so shader changes are gated by
static verification plus node tests against the CPU mirrors:

```bash
node scripts/verify.js        # WGSL balance, precedence, struct layout vs
                              # buffer sizes, binding parity, const parity
node scripts/test-terrain.js  # heightfield stats, smoothness, determinism
node scripts/test-caves.js    # floor slope bound, percolation flood-fill,
                              # headroom, BFS walk-bot down an entrance
node scripts/test-edits.js    # dig/fill round-trips, packing, persistence
```

Shared constants are interpolated into the WGSL template from `CFG`/`CAVES`
(`verify.js` rejects literals), so the shader and the mirrors cannot drift.

## Project docs

[PRD.md](PRD.md) holds the original scope and the pivot history. The current
direction is an open-world exploration RPG — generated history, ruins to
read, something guarding them — built on this renderer.
