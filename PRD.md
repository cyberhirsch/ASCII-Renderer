# PRD: ASCII World

**Status:** playable vertical slice, not released.
**Version:** 0.2 — absorbs the "Deepdelve" concept (history-as-resource, simulated
history, serverless P2P). See §12 for what was adopted and what was not.
**Last revised:** 2026-08-18 · 78 commits · 5,900 lines · ships as a 165 KB HTML file.

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

The direction of travel: **make the world's history a function too** — simulate
it rather than template it, and give what it produces mechanical weight, so
knowing something is worth as much as carrying something.

## 2. History

This project has pivoted twice. The record matters because the constraints that
survived each pivot are the ones worth defending.

| Date | Era | What it was |
|---|---|---|
| 2026-08-13 | **City** | Canvas 2D column raycaster over a 192² grid; a night-time cyberpunk city block, built from a YouTube devlog brief. Baked lighting, painter's-algorithm depth. |
| 2026-08-15 | **WebGPU** | Renderer thrown out and rebuilt as a per-pixel 3D compute raymarch. True three-point perspective, traced shadows and AO. The CPU raycaster was deleted outright. |
| 2026-08-16 | **World** | The city was deleted too. Replaced by an infinite, storage-free procedural landscape — then caves, materials, and the first gameplay systems on top. |
| 2026-08-18 | **Record** | Generated civilisation and depth-laid inscriptions: the first thing in the project that can be finished. A voxel colony-sim / P2P concept was evaluated against this and partly absorbed (§12). |

What survived all three: single shippable HTML file, no engine, no assets,
everything reduces to (glyph, colour, brightness) in a character grid.

## 3. Vision

Most procedural worlds are *generated* — computed once, stored, streamed. This
one is *evaluated*, continuously, at the moment of looking. That difference is
the whole pitch, and it produces properties a stored world cannot have: no
loading, no seams, no world edge, a 165 KB download, and a world byte-identical
for every player on every visit.

On top of that sits the second idea, and the one this revision commits to:

> The people who cut these halls are as procedural as the stone. Their history
> is simulated, not written — and what it left behind is worth finding, because
> knowing where they hid something is the only way to find it.

Discovery is the verb. Not clearing a dungeon: reading one.

## 4. Design pillars

1. **The world is a function, not a file.** Any feature requiring the world to
   be stored is wrong by default. This now explicitly covers *history*: the
   chronicle is simulated deterministically from the seed at load, not saved.
   Player edits remain the sole stored thing, and they are stored *sparsely,
   as deltas.*
2. **The CPU and the GPU must agree exactly.** What you see, what you collide
   with, and what the game tells you are the same functions, mirrored
   bit-for-bit. Divergence here is the project's most dangerous bug class.
3. **ASCII is the medium, not a filter.** UI text substitutes the character a
   cell renders rather than drawing over it, so a word is woven into the field
   instead of floating above it. The ~24-step glyph ramp is a real constraint
   on lighting design and is honoured as one.
4. **Art-direct, don't simulate.** Night is bright moonlit blue, not dark,
   because physical darkness collapses the glyph ramp into nothing. Legibility
   beats realism whenever they conflict. *(The one deliberate exception is
   history, where simulation beats authorship — see pillar 6.)*
5. **Shipped blind, so verified statically.** The dev environment has no GPU.
   Every shader change is gated by a static harness and by node tests against
   the CPU mirrors before a human ever sees it.
6. **Lore is diegetic and load-bearing.** *(New.)* Nothing is delivered by a
   codex or a legends browser. History reaches the player only through things
   in the world — inscriptions, ruins, later NPCs — and it must *do* something:
   name a place, warn of a thing, point at what is buried. A fact the player
   cannot act on is flavour, and flavour is not a system.

## 5. Audience

- **Primary:** creative-coding, procgen, demoscene and graphics-programming
  audiences who value visible technique. The technical story — a world with no
  stored data, caves whose passage network provably percolates, UI woven into
  the glyph field, a history that is recomputed rather than saved — is the draw.
- **Secondary:** Dwarf Fortress / roguelike players drawn to generated history
  and ASCII presentation, who will engage with lore-through-exploration.
- **Explicitly not:** players expecting a conventional action game. There is no
  combat system planned beyond a single source of dread, and the pace is slow.

## 6. Current state — shipped

| System | What works |
|---|---|
| **Renderer** | WebGPU compute raymarch, one true 3D ray per character cell; glyph-mapped upscale with a measured-coverage atlas and ordered dither. Terminal-shaped 12×22 cells sized 1:1 with device pixels. |
| **Terrain** | Infinite domain-warped fractal value noise; sea level, shorelines, slope-driven materials. Verified smooth and sane at 10⁵ units out. |
| **Caves** | Three 12-unit depth bands. Passages open along the median isolines of two noise fields — the median level set percolates, so the network is connected across the infinite plane (97% of interior cells in one component, flood-fill verified). Slope-bounded floors make them walkable by construction (~13° worst case). |
| **Access** | Helical stair wells (~16° grade) surface→band and band→band, always daylighting into a passage. Spawn at an entrance rim. A node walk-bot proves a legal walking path from spawn to the band floor. |
| **Halls** | Hash-placed rooms with dead-flat floors and pillar lattices; passages puncture the walls as doorways. Protected solids survive overlapping caverns, leaving freestanding pillars. |
| **Materials** | Soil depth falls off with slope (bare rock on hillsides); stone below. Ore veins are the intersection curves of two noise fields — branching tubes, 0.25% of rock — copper shallow, iron deep, gems in deep vein cores at 0.008%. |
| **Digging** | Sparse 32³ signed-byte chunks at 0.5 u, allocated only where dug, sampled trilinearly, streamed to the GPU as the 32 nearest the player. Persisted. |
| **Lighting** | Soft shadows (16 rays), traced AO (32 rays), both as transmittance. Full budgets within 40 m then a hard cut. Underground: light shafts, AO-driven depth darkness, glow lichen, emissive gems, headlamp. |
| **Day/night** | Fifty-minute cycle; 2.5-hour golden hour on a separate curve from the sky's red band; yellow crescent moon that occludes stars; star field on a celestial sphere turning about a tilted pole, so stars rise, set, and go circumpolar near the axis. |
| **Gameplay** | Inventory, 5 recipes, tool-gated digging (shovel/pickaxe), examine with context actions, three tree species, felling, loose stones, boulders. |
| **The record** | A seeded civilisation — name, people, founder, what they dug up, how it ended — with inscriptions generated from those facts and laid out by depth. Reading all three depths completes it. Journal panel. |
| **Shell** | Boot screen, title screen, in-grid HUD and panels, command console. Save carries inventory, position, facing, time, record, digs, cleared cells. |
| **Verification** | Static harness (WGSL balance, operator precedence, struct layout vs buffer sizes, binding parity, shared-constant parity) plus ~150 assertions across four node suites. |

## 7. The history engine (adopted — the main change in 0.2)

Today's history is four beats per depth band, drawn from a fixed template table.
It is enough to finish once and not enough to want twice — the "content depth is
thin" risk in §14, made concrete. The fix is to stop authoring history and start
**running** it.

### 7.1 Principle: history is a function, not a log

A chronicle is simulated at load from the seed alone, deterministically, and
**never saved**. Two runs of a seed produce the same centuries down to the last
death. This is the same trick as the terrain, applied to time — and it is what
lets an event-log design coexist with pillar 1: the log is *derived*, so a
100 MB history costs zero bytes on disk and zero bytes on the wire.

### 7.2 Scope

- **Mythic seed (P1).** A creation myth — a small pantheon and two or three
  primordial events — generated first and used to *bias the physical world*:
  where ore is rich, which biomes dominate, what the civilisations fear. The
  connection must be legible: "the mountain that swallowed the sun-child" is
  also where iron runs deepest.
- **Chronicle sim (P1).** N centuries at entity level — a handful of
  civilisations, their sites, and a capped cast of named figures (target ≤ 200).
  Per tick: found, expand, trade, war, delve, make, die. Every action appends to
  an in-memory event log of `(tick, actor, action, target, place, cause)`.
- **Materialisation (P1).** On approach, nearby history compiles into physical
  fact: a hall's builders, its era, why it was abandoned, who is entombed in it.
  The existing hall/shaft placement becomes the *output* of history rather than
  independent noise.
- **Inscriptions from events (P1).** Text is generated by querying the log, not
  by picking a template beat. An inscription names real figures, real dates,
  real causes — and can therefore say something no template could: that the
  vault three hills sunward holds what they took out of the deep.
- **History as loot (P1).** The pillar-6 requirement, made mechanical. A read
  inscription can yield: a **direction and distance** to another site, a
  **weakness** of whatever guards it, or a **name** that opens something. The
  journal becomes a tool, not a trophy case.
- **Reputation and rumour (P3).** Events propagating through witnesses with
  delay and distortion, so rumours are lossy. Requires NPCs; deferred until
  there are any.
- **Living world (P3).** Background ticks during play, consequences arriving as
  events. Deferred for the same reason.

### 7.3 Verification

The chronicle is pure CPU and therefore fully testable in the sandbox:
determinism (two runs byte-identical), no dangling references (every inscription
names entities that exist), **reachability** (every site the record points at is
findable from where the pointer was found), and no orphan sites.

## 8. Non-goals (v1)

- **Combat as a system.** One creature is planned as *tension*, not a combat
  tree. No weapons progression, no damage numbers.
- **Colony simulation.** No colonists, no jobs, no needs. See §12.
- **Multiplayer of any kind in v1.** See §12.
- **Leaving ASCII**, or leaving the single-file no-dependency constraint.
- **Mobile.** Pointer lock and a keyboard are required.
- **Stored or streamed world chunks.** See pillar 1.
- **A legends browser / codex UI.** See pillar 6.
- **Audio** — deferred since the first milestone, still deferred.

## 9. Technical constraints

- **WebGPU is required** and is the hard gate on audience: Chrome/Edge 113+,
  Firefox 141+, Safari 26. There is no fallback renderer and none is planned.
- **Seed must stay below 2²⁴** so an f32 uniform carries it exactly; otherwise
  CPU and GPU disagree about where the world is.
- **Every shared constant is interpolated into the WGSL from JS**, never
  duplicated as a literal. `scripts/verify.js` fails the build otherwise.
- **Cost scales with cells, not pixels** — hi-dpi 1080p costs the same as 1×,
  but 4K costs 4× 1080p (~31k rays/frame). GPU buffers ~1 MB; CPU near-idle.
- **The chronicle must fit a load budget.** It runs before the first frame, so
  it competes with the boot screen, not with the frame budget. Target < 400 ms.
- **Driver watchdog is the real hardware risk.** A frame that runs too long
  kills the device; the device-lost panel exists because this has happened.

## 10. Roadmap

**Next — makes it releasable**
1. **The warden.** One creature guarding the deep halls: hovering, lit eye,
   pursues on sight and line of sight. Purpose is dread on the descent, so the
   inscriptions' warnings pay off. Shader geometry + a CPU state machine.
2. **Death and consequence.** Something to lose, decided by playtest.
3. **itch.io release.** Static HTML5 embed, WebGPU requirement stated plainly.

**Then — the history engine (§7)**
4. Chronicle sim + mythic seed, replacing the template beats.
5. Materialised sites: halls placed *by* history, with builders and an era.
6. History as loot: inscriptions that point, name, and warn — with the
   reachability test that guarantees a pointer is followable.

**Later**
7. Surface ruins, so the record starts above ground.
8. Placeable light sources (needs point lights, capped count).
9. Generational play: re-embark in the same seed; the previous run's fortress
   persists as a site with attached history. *Cheap here — the world is already
   infinite and deterministic; only the delta set needs naming and versioning.*
10. Audio.

**Not scheduled:** z-levels beyond the current bands, roofed interiors, weather.

## 11. Success criteria

- **Technical:** 60 fps at 1080p on integrated graphics from the last ~5 years;
  no device-lost reports; CPU/GPU parity maintained; chronicle load < 400 ms.
- **Design:** a first-time player reaches a cave entrance without being told,
  and completes the record, in under 30 minutes. Post-history-engine: a player
  follows a pointer from one site to another **without a map marker** and finds
  it, in ≥ 70% of attempts.
- **Distribution:** a publicly playable build with an honest support notice; the
  technical write-up reaches the procgen/graphics audience.

## 12. Evaluated and not adopted

The "Deepdelve" concept (voxel colony-sim on a serverless P2P stack) was
assessed against this project on 2026-08-18. Its history ideas were adopted
wholesale (§7). Three of its pillars were not, and the reasons are recorded
here so the decision does not get quietly relitigated.

### 12.1 Serverless P2P multiplayer — **deferred, product fork**

*The idea:* a world is a cryptographic key; Hypercore/Autobase/Hyperswarm on the
Pear runtime; canonical lane for edits, ephemeral lane for avatar motion.

*Why it is genuinely attractive here:* this project is unusually well suited to
it. The world is a pure function, so peers need never sync terrain — only the
sparse delta set (edits, cleared cells, the record), which is already the only
thing that exists. That is a far smaller sync surface than any voxel game has.
The two-lane split and deterministic-view design are sound and would fit.

*Why it is not v1:* the stack is Bare/Node, not a browser. Adopting it means
either a desktop build — surrendering the single-link, 165 KB distribution that
is currently this project's best asset — or replacing the stack with browser P2P
(WebRTC + DHT bootstrap), which is a different and less mature engineering
problem. Either way it breaks the single-file pillar, and it is a larger body of
work than everything shipped so far combined.

*Recommendation:* keep the architecture P2P-*ready* — treat the delta set as an
append-only, causally-ordered event log now, even single-player, so that
adopting a sync layer later is a transport change rather than a rewrite. Revisit
after release, on evidence that anyone wants co-op.

### 12.2 Colony simulation — **not adopted**

*The idea:* colonists with needs, moods, relationships, jobs, production chains,
tantrum spirals; an overseer mode alongside the avatar.

*Why not:* this is a second game, not a layer. This project has no entities at
all today — the entity system is a stub — and colony sim is where the majority
of Deepdelve's cost lives. It also fights the pillars: 200 agents' worth of
state is exactly the stored, non-functional world pillar 1 excludes, and an
overseer mode is a second renderer.

*What is worth keeping from it:* the *feeling* that the place was inhabited,
which is what §7 delivers at a fraction of the cost — the colonists lived and
died in the chronicle, and you find what they left. Dead colonists are much
cheaper than live ones, and for a game about reading a record they are also the
better ones.

### 12.3 Voxel building, desktop, separate renderer — **not adopted**

Block *placement* (as opposed to the destructive digging that exists) is a
plausible small addition — `Edits.splat` already fills. But voxel building as a
pillar, a desktop platform, a TypeScript rewrite, and a bridged Godot renderer
each individually end this project and start a different one. The single browser
file is the distribution model and half the appeal.

## 13. Open questions

1. How many centuries and how many named figures before the chronicle blows the
   400 ms load budget? (Spike needed; entity-level not individual-level.)
2. Does a pointer-and-distance mechanic work without a compass or map UI, given
   everything must stay diegetic (pillar 6)?
3. Should the mythic seed bias terrain *parameters* (cheap, safe) or terrain
   *structure* (expressive, risks the smoothness and percolation guarantees)?
4. Procedural text: grammar templates now — but the log-query approach makes an
   on-device LLM a live option later. Worth designing the text layer behind an
   interface for that reason?
5. If the delta set becomes an event log for future P2P, does that change the
   save format now? (Cheaper to decide before release than after.)

## 14. Risks

| Risk | Sev | Assessment |
|---|---|---|
| No threat means no tension | High | The known gap; item 1 on the roadmap. Everything the record warns about currently fails to arrive. |
| Chronicle sim cost explodes | Med | Entity-level not individual; capped cast; lazy materialisation. It runs once at load, not per frame, so the failure mode is a slow boot, not a slow game. |
| History generates text nobody reads | Med | Pillar 6 is the mitigation: an inscription must *do* something. Enforced by the reachability test, not by good intentions. |
| WebGPU gate excludes much of itch's traffic | Med | Accepted. Framing for a technical audience is the mitigation, not a fallback renderer. |
| Shader ships blind | Med | The harness has already caught the class of bug it was built for, twice. Residual risk is real and permanent. |
| Perf on weak GPUs unmeasured | Med | No fps numbers from real hardware yet. All knobs scale cost roughly linearly. |
| Scope drift toward Deepdelve | High | §12 exists to make the fork explicit. The test for any new feature is pillar 1: does it require storing the world? |
