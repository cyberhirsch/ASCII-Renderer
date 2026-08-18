# PRD: ASCII World

**Status:** playable vertical slice, not released.
**Last revised:** 2026-08-18 · 72 commits · 5,700 lines · ships as a 164 KB HTML file.

---

## 1. Summary

An infinite procedural world rendered entirely in ASCII characters, raymarched
one ray per character cell in a WebGPU compute shader. You walk it, dig it,
craft from it, and descend through caves someone else cut long ago to find out
who they were.

The defining constraint: **nothing about the world is stored.** Every hill,
cave, ore vein and boulder is a pure function of one seed, evaluated in the
shader as rays cross it. There is no heightmap, no chunk cache, no mesh, no
texture. The only bytes that exist are the ones the player changed.

## 2. History

This project has pivoted twice. The record matters because the constraints
that survived each pivot are the ones worth defending.

| Date | Era | What it was |
|---|---|---|
| 2026-08-13 | **City** | Canvas 2D column raycaster over a 192² grid; a night-time cyberpunk city block, built from a YouTube devlog brief. Baked lighting, painter's-algorithm depth. |
| 2026-08-15 | **WebGPU** | Renderer thrown out and rebuilt as a per-pixel 3D compute raymarch. True three-point perspective, traced shadows and AO. The CPU raycaster was deleted outright. |
| 2026-08-16 | **World** | The city was deleted too. Replaced by an infinite, storage-free procedural landscape — then caves, materials, and the first gameplay systems on top. |

What survived all three: single shippable HTML file, no engine, no assets,
everything reduces to (glyph, colour, brightness) in a character grid.

## 3. Vision

Most procedural worlds are *generated* — computed once, stored, streamed. This
one is *evaluated*, continuously, at the moment of looking. That difference is
the whole pitch, and it produces properties a stored world cannot have: no
loading, no seams, no world edge, a 164 KB download, and a world that is
byte-identical for every player on every visit.

On top of that sits the second idea: **a world that remembers people who are
gone.** The caves are not a dungeon to clear. They are a record, cut into the
pillars by a civilisation the seed invented, laid out so that reading it
through means going deeper. Discovery, not combat, is the intended verb.

## 4. Design pillars

1. **The world is a function, not a file.** Any feature that requires storing
   the world is wrong by default. Player edits are the sole exception, and
   they are stored *sparsely, as deltas.*
2. **The CPU and the GPU must agree exactly.** What you see, what you collide
   with, and what the game tells you are the same functions, mirrored
   bit-for-bit. Divergence here is the project's most dangerous bug class.
3. **ASCII is the medium, not a filter.** UI text substitutes the character a
   cell renders rather than drawing over it, so a word is woven into the field
   instead of floating above it. The ~24-step glyph ramp is a real constraint
   on lighting design and is honoured as one.
4. **Art-direct, don't simulate.** Night is bright moonlit blue, not dark,
   because physical darkness collapses the glyph ramp into nothing. Legibility
   beats realism whenever they conflict.
5. **Shipped blind, so verified statically.** The dev environment has no GPU.
   Every shader change is gated by a static harness and by node tests against
   the CPU mirrors before a human ever sees it.

## 5. Audience

- **Primary:** creative-coding, procgen, demoscene and graphics-programming
  audiences who value visible technique. The technical story — a world with no
  stored data, caves whose passage network provably percolates, UI woven into
  the glyph field — is the draw.
- **Secondary:** roguelike and Dwarf Fortress players drawn to generated
  history and ASCII presentation, who will engage with lore-through-exploration.
- **Explicitly not:** players expecting a conventional action game. There is no
  combat, and the intended pace is slow.

## 6. Current state — shipped

| System | What works |
|---|---|
| **Renderer** | WebGPU compute raymarch, one true 3D ray per character cell; glyph-mapped upscale with a measured-coverage atlas and ordered dither. Terminal-shaped 12×22 cells sized 1:1 with device pixels. |
| **Terrain** | Infinite domain-warped fractal value noise; sea level, shorelines, slope-driven materials. Verified smooth (no terracing) and sane at 10⁵ units out. |
| **Caves** | Three 12-unit depth bands. Passages open along the median isolines of two noise fields — the median level set percolates, so the network is connected across the infinite plane (97% of interior cells in one component, flood-fill verified). Slope-bounded floors make them walkable by construction (~13° worst case). |
| **Access** | Helical stair wells (~16° grade) from surface to band and band to band, always daylighting into a passage. Spawn is placed at an entrance rim. A node walk-bot proves a legal walking path from spawn to the band floor. |
| **Halls** | Hash-placed rooms with dead-flat floors and pillar lattices; passages puncture the walls as doorways. Protected solids survive overlapping caverns, leaving freestanding pillars. |
| **Materials** | Soil depth falls off with slope (bare rock on hillsides); stone below. Ore veins are the intersection curves of two noise fields — branching tubes, 0.25% of rock — copper shallow, iron deep, gems in deep vein cores at 0.008%. |
| **Digging** | Sparse 32³ signed-byte chunks at 0.5 u, allocated only where dug, sampled trilinearly, streamed to the GPU as the 32 chunks nearest the player. Persisted. |
| **Lighting** | Soft shadows (16 rays, wide sun disc), traced AO (32 rays), both as transmittance. Full budgets within 40 m then a hard cut. Underground: light shafts through mouths, AO-driven depth darkness, glow lichen, emissive gems, headlamp. |
| **Day/night** | Five-minute cycle; sun arc, twilight palettes, yellow crescent moon that occludes stars, a four-glyph star field (`.` `+` `x` `*`), night-scaled headlamp. |
| **Gameplay** | Inventory, 5 recipes, tool-gated digging (shovel/pickaxe), examine with context actions, three tree species, felling, loose stones, boulders. |
| **The record** | A seeded civilisation — name, people, founder, what they dug up, how it ended — with inscriptions generated from those facts and laid out by depth. Reading all three depths completes it. Journal panel. |
| **Shell** | Boot screen, title screen, in-grid HUD and panels, command console with devmode/time/freeze/daylen/wipe. Save carries inventory, position, facing, time, record, digs and cleared cells. |
| **Verification** | Static harness (WGSL balance, operator precedence, struct layout vs buffer sizes, binding parity, shared-constant parity) plus 132 assertions across four node suites. |

## 7. Non-goals

- **Combat as the core loop.** One creature is planned as *tension*, not as a
  combat system. No weapons tree, no damage numbers.
- **Multiplayer.**
- **Leaving ASCII**, or leaving the single-file no-dependency constraint.
- **Mobile.** Pointer lock and a keyboard are required.
- **Stored/streamed world chunks.** See pillar 1.
- **Audio** — deferred since the first milestone, still deferred.

## 8. Technical constraints

- **WebGPU is required** and is the hard gate on audience: Chrome/Edge 113+,
  Firefox 141+, Safari 26. There is no fallback renderer and none is planned.
- **Seed must stay below 2²⁴** so an f32 uniform carries it exactly; otherwise
  CPU and GPU disagree about where the world is.
- **Every shared constant is interpolated into the WGSL from JS**, never
  duplicated as a literal. `scripts/verify.js` fails the build otherwise.
- **Cost scales with cells, not pixels** — a hi-dpi 1080p window costs the same
  as a 1× one, but 4K costs 4× 1080p (~31k rays/frame). GPU buffers total
  ~1 MB; CPU load is negligible.
- **Driver watchdog is the real hardware risk.** A frame that runs too long
  kills the device; the on-screen device-lost panel exists because this has
  happened.

## 9. Roadmap

**Next — makes it releasable**
1. **The warden.** One creature guarding the deep halls: hovering, lit eye,
   pursues on sight and line-of-sight. Purpose is dread on the descent, so the
   inscriptions' warnings pay off. Needs entity geometry in the shader plus a
   CPU state machine.
2. **Death and consequence.** Something to lose. Respawn at the surface,
   inventory dropped or kept — to be decided with playtesting.
3. **itch.io release.** Static HTML5 embed; page must state the WebGPU
   requirement prominently to manage bounce.

**Later**
4. Ruins and lore props on the surface, so the record starts above ground.
5. More of the history graph: multiple civilisations, sites that reference each
   other by direction, a connected discovery graph.
6. Placeable light sources (needs point-light shading, capped count).
7. Audio.

**Not scheduled:** z-level digging beyond the current bands, roofed interiors,
weather, seasons.

## 10. Success criteria

- **Technical:** holds 60 fps at 1080p on integrated graphics from the last
  ~5 years; no device-lost reports; CPU/GPU parity maintained (all suites green
  on every shader commit).
- **Design:** a first-time player reaches a cave entrance without being told,
  and completes the record, in under 30 minutes.
- **Distribution:** a publicly playable build with an honest browser-support
  notice; the technical write-up reaches the procgen/graphics audience.

## 11. Open risks

| Risk | Assessment |
|---|---|
| WebGPU gate excludes much of itch's traffic | Accepted. Framing the page as an experiment for a technical audience is the mitigation, not a fallback renderer. |
| No threat means no tension | The known gap. Item 1 on the roadmap. |
| Shader ships blind | Mitigated by the harness, which has already caught the class of bug it was built for twice. Residual risk is real and permanent. |
| Perf on weak GPUs unmeasured | No fps numbers from real hardware yet. Knobs (`AO_SAMPLES`, `SUN_SAMPLES`, `SHADE_NEAR`, cell size) all scale cost roughly linearly. |
| Content depth is thin | One civilisation, twelve inscription beats. Enough to finish once; not enough to replay. Roadmap item 5. |
