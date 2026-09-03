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
on the clipboard as plain text, `map` sizes the devmode minimap, `time <hour>`
jumps the clock, `freeze` stops
it, `daylen <seconds>` sets the cycle length, and `devmode` unlocks the M/X
debug views, `teleport building` (or `npc`), a compass across the second row
— under the frame statistics, which own the top one — and a minimap in the
top right —
green land, blue water, red settlements, `@` you in white and `>` a cave
mouth in amber; `HFMT` a settlement still lived in, `hfmt` one that is not.
Escape or an empty Enter closes the console.

**Controls:** WASD move · **Space** jump · Shift run · click for mouse-look ·
**Esc** menu (save, load, restart, stop) · **LMB** dig ·
**RMB** fill · **Tab** inventory · **C** craft · **E** examine what you're
looking at (**W/S** choose an action, **E** do it, **Q** close) · **G** hop
into the cave below (debug) · **M** mono/color · **V** glyph set · **X** raw
shading · **F** fullscreen.

Water is swum rather than walked around. Anything you can stand up in you
wade through, slowly; deeper than that your feet leave the bed and you float
with your eyes just clear of the surface. There is no diving — below the
water plane the renderer has nothing to show you but sky — and no drowning.
The heightfield never goes below zero, so the sea is nowhere deeper than
2.4 units and the bed is always in sight under you. Nothing grows out of it
either: a tree is placed only if the ground under its own anchor is dry, so
the woods stop at the waterline instead of wading in.

The last of the six peoples has not ended, and **you start beside the oldest
of them**. One person in the world remembers what nobody wrote down: talk to
the elder — **E** on a person — and they tell you one thing at a time, out of
the same chronicle the walls carry.

**And they have it wrong.** What an elder says is graded by how far back it
goes. Inside living memory it is right. A few centuries back it is right in
the main. Past that it is myth: the years have rounded to the century, the
count of fields won has grown sevenfold, a death of old age has become a
wound taken on a field, and a thing has been handed to whichever maker the
teller has heard of. Some of it is simply lost — a name with nothing hanging
off it. He tells you which of the four he is giving you, and where a myth is
concerned he has a direction and no distance.

The walls have the other version. That gap is the game: you are told a story,
you go down and read what was cut at the time, and the two do not agree.

**Everybody has a chain of two to four things to ask, and hands over one link
at a time** — the next is not offered until the one in front of it is done,
so a person you spoke to in the first hour has something else to say in the
fourth. Three kinds of step, all of them things the game can actually check:
stand in a place the record names, read what was cut at a given depth, or go
and hear a particular story out of the elder. That last one is what makes the
chains interlock — one person sends you to another for the half they do not
have. The elder's own chain is about his own memory: three stories, then
something to go and check, and no more stories until it is checked.

Nobody asks you to fetch materials — there was a fetch-quest kind and it is
gone, because it asked nothing of the history the world is made of. **J**
lists what is owed, whose chain it belongs to, and how far along it is.

Nothing tells you what to do. The top line is empty until you have read
something off a wall or somebody has asked you for something, and there is
no screen between the opening and the world that sets you a goal.

A new game opens on black. First the myth — what they say came before
anybody was counting, generated from the seed like everything else — and then
the record itself, run as a timelapse rather than listed: the survey grid the
simulation ran on, with settlements appearing, roads knitting them together
and going dark again, six thousand years in about twelve seconds. The
captions come off the peoples' own logs, and the roll of the six lands over
the finished map at the end. Any key skips it, it hands straight over to the
world, and a saved game never sees it. The map is deliberately flat, no relief: the survey samples the ground
every 128 units and this terrain varies at about forty, so neighbouring
samples are uncorrelated (measured at r = 0.002) and a height ramp drawn from
them would be noise rather than hills.

**There is something to find under the ground**, and the elder is the one who
tells you so. Cave entrances are round pits with a spiral stair. Walk in.

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
intersect. Deep down they run iron. Nearer the surface what they carry
depends on where you are standing: mostly copper, but about a fifth of the
country is **tin**, in provinces a few hundred units across, and tin is
never found where the copper is. That is deliberate, and it is the reason
the real bronze age ran on trade — **bronze** is the one thing here you
cannot make at home, because the two halves of it come out of two different
parts of the map. In the core of a deep vein sit **gems**, which glint out
of cave walls and are worth walking toward.
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

## The asset sheet

`assets.html` is the catalogue: every building, find, prop and carried item
in one page, each one traced and drawn as ASCII by the same primitives the
shader intersects. It is a **review instrument**, not a gallery — every card
carries an *approved* box and a note field, both kept in `localStorage`
across reloads, seeds and decay sweeps, and **copy notes** hands the whole
review back as markdown.

Nothing on it is a mesh. A building is a function of `(kind, seed, decay,
cause)` returning a list of boxes, cylinders, cones, convex bodies and
faceted stones — the five shapes the shader already traces, plus a convex
body that is `hitFaceted`'s slab loop with the plane normals given instead
of hashed. So the sheet is not a preview of an asset; it *is* the asset,
and the same parts list can be handed to the renderer without anything
being baked. That is pillar 1 applied to buildings.

The vocabulary is the chronicle's. A site has a kind (hold, farm, mine), a
people with a material and a metal, an abandonment year and a cause — and
those five facts decide what stands there and how much is left, so a ruin
is the residue of something the sim actually did. Decay runs the five
stages the chronicle names an artifact's condition with (`standing`,
`weathered`, `roofless`, `ruined`, `footings`); thatch is gone in decades
and drystone essentially never, which is why a ruined timber farm is
postholes and a ruined stone hold is a wall you can lean on. Sites sink as
they are left, because soil does not stay still and a floor laid level with
the yard ends up under it — the footing course is what stays readable.

**Section** cuts the turf away on the near side of the object and draws the
soil profile behind it, the way an excavation is drawn: turf, then the layer
that came in over the site, then what the place was built on. The middle
band *is* the sinking — its floor sits at exactly the depth the building has
gone down by, so the drawing measures the model rather than illustrating it.

A site goes down by up to 1.65 m, which is deep enough that by the last
stage a stone hall is entirely under the turf. In elevation that leaves the
**tell**: a low swell where the soil went, which is the only thing such a
place shows from the outside and is exactly how one is found. In section the
mound is absent, because the cut has taken the overburden away and the soil
face is drawing the same soil in profile instead — one body of earth, two
views, never both at once.

**Life** puts one building's five stages in a row, in section, all five
framed on the building *as built* — so the turf line sits on the same row in
every panel and you watch the structure come down as the ground comes up.
What grows back is staged the same way: moss in the wet corners first, then
a creeper up whatever masonry is still standing (the stage that reads best,
because it puts something living against something built and dates the ruin
at a glance), then a sapling through the hearth, then a young tree.

Finds carry the chronicle's own condition curve, and the bottom of it is
where an object stops being one: below `Artifact.STAIN` the metal is gone
and what is left is the discolouration in the soil. **That cannot be picked
up.** `Assets.make` declines the hold, the camera goes overhead — edge on, a
stain is nothing at all — and the card says *nothing left to pick up*. A
blade leaves a line and a bowl leaves a disc, which is how one is told from
the other in a trench.

Controls: **X** swaps the glyph view for the raw traced image, the same key
and the same meaning the game gives it. **In hand** puts anything holdable
where a hand would be and looks at it from `CFG.EYE` through the game's own
lens, at its true size — a torc is 26 cm and a spear is a metre and a half,
and which of those you are holding is the only thing that view is for.
Every card carries its size in metres, a person standing beside it, and a
one-metre ground grid.

## Development

Plain scripts under `js/`, shared global scope, no build step for dev.
`node build.js` inlines everything into `dist/`.

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
node scripts/test-assets.js   # the catalogue and the ASCII tracer
```

`test-assets.js` earns its place with one check in particular. Every review
pass on the sheet came back with the same sentence in it — *floating
stones*, *rocks are floating*, *floating pieces when decaying* — because a
faceted stone is a bounding sphere with cuts taken out of it, and putting
its centre a radius above the ground leaves it hanging. That is a class of
bug rather than an instance, so the suite walks every asset at six decay
levels and fails any part that neither reaches the ground nor rests on
something that does. It also holds a building to being *whole* at decay
zero, which is the other thing a reviewer asked and the renderer could not
answer.

All of them run in CI on every push, together with a rebuild of `dist/`
that fails if a committed bundle is not what `build.js` produces — those
files are the ones people actually open.

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
