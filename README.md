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

**Worlds:** everything you can walk to is a function of one number. Add
`?seed=1234` to the URL, or run `seed 1234` in the console, and you are
somewhere else entirely — different hills, different caves, a different dead
civilisation with a different name and a different way of ending. Anyone who
loads that seed stands in exactly the same place. Each world keeps its own
digs, inventory and record; the seed has to stay below 2²⁴ (see below).

**If it runs badly**, or the GPU driver kills the tab: open the console and
run `quality low`. It leaves the world alone and buys frame time back from
the shadow and ambient-occlusion ray budgets, which are what a frame mostly
spends. `quality auto` — the default — does this on its own when frames get
slow, and gives the rays back after a sustained good patch.

**Console:** Enter opens a command line. `seed <n>` walks to another world,
`quality <low|medium|high|auto>` sets the ray budget, `copy` puts the screen
on the clipboard as plain text, `time <hour>` jumps the clock, `freeze` stops
it, `daylen <seconds>` sets the cycle length, and `devmode` unlocks the M/X
debug views. Escape or an empty Enter closes it.

**Controls:** WASD move · Shift run · click for mouse-look · **LMB** dig ·
**RMB** fill · **Tab** inventory · **C** craft · **E** examine what you're
looking at (**W/S** choose an action, **E** do it, **Q** close) · **G** hop
into the cave below (debug) · **M** mono/color · **V** glyph set · **X** raw
shading · **F** fullscreen.

You spawn beside a cave entrance — a round pit with a spiral stair. Walk in.

**There is something to find down there.** Someone cut those halls, and they
left their record on the pillars. Examine one to read it. The story is laid
out by depth — the founding near the surface, the digging below that, and the
end in the deepest galleries — so reading it through means going down, which
is the whole reason the caves are there. **J** keeps what you have read.
Nothing about them is authored: the seed decides who they were, what they dug
up, and how it ended, and the inscriptions are generated from those facts.

The ground is made of something specific everywhere you stand. Soil lies deep
on flats and thins to nothing on steep ground, which is why hillsides show
bare rock — and you need a **shovel** for soil, a **pickaxe** for stone. Bare
hands can only gather the loose scree lying on bare rock, which is the
bootstrap: gather stone, break a branch off a tree for wood, and craft your
way up from there. Chopped trees fall and stay felled.

Rock rarely carries **ore veins** — branching tubes where two noise fields
intersect, copper near the surface, iron deeper — and in the core of a deep
vein, **gems**, which glint out of cave walls and are worth walking toward.
A torch (wood + cave lichen) brightens your headlamp; a gem lantern brightens
it far more — and above ground that matters, because the sun sets. A full
day/night cycle runs in fifty minutes: warm key light by day, red at the
horizons, then a night lit blue by a yellow crescent moon under a field of
`*` `+` `x` `.` stars. The stars are fixed to a celestial sphere that turns
about a tilted pole, so they genuinely rise and set — the ones near the pole
wheel around it all night and never touch the horizon. They also keep you
waiting: the light has gone blue well before the first of them shows, and the
brightest come out first. Inventory, digs, and felled trees all survive reload.

Night is art-directed, not simulated. The glyph ramp has only ~24 brightness
steps, so a physically dark night would crush the whole scene into the bottom
two or three and read as an empty screen. Instead night is a bright moonlit
blue — it says *night* through hue and contrast while the ramp stays fully
used, and yellow is reserved for the moon and stars so they read as the only
light sources up there.

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
  trilinearly, streamed to the GPU as the chunks nearest the player — and
  only the bricks that actually changed are re-sent. A chunk is almost all
  zeros, so it is run-length encoded before it reaches localStorage: a dug
  one costs tens of characters where the dense form cost forty thousand.

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
                              # buffer sizes, binding parity, const parity,
                              # no retyped constants in mirrored functions
node scripts/test-terrain.js  # heightfield stats, smoothness, determinism
node scripts/test-caves.js    # floor slope bound, percolation flood-fill,
                              # headroom, BFS walk-bot down an entrance
node scripts/test-edits.js    # dig/fill round-trips, packing, slot diffing,
                              # run-length encoding, v1 save migration
node scripts/test-game.js     # inventory, panels, examine, the record,
                              # the quality ladder, per-world save keys
```

All five run in CI on every push, together with a rebuild of
`dist/index.html` that fails if the committed bundle is not what `build.js`
produces — that file is the one people actually open.

Shared constants are interpolated into the WGSL template from `CFG`/`CAVES`/
`TERR`/`TREE`/`MATS`/`PROPS` (`verify.js` rejects literals), so the shader
and the mirrors cannot drift. `terrainH` and `treeAt` are held to a stricter
rule still: no bare float literal at all beyond the structural ones, because
a single retyped digit in either moves the ground out from under collision
without making one pixel look wrong.

## Project docs

[PRD.md](PRD.md) holds the original scope and the pivot history. The current
direction is an open-world exploration RPG — generated history, ruins to
read, something guarding them — built on this renderer.
