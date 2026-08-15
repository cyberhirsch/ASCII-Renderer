# PRD: ASCII Cyberpunk City Engine

## 1. Summary
A browser-based, single-HTML-file engine that renders a walkable, grid-based 3D city entirely in ASCII/Unicode characters. A custom raycaster (JavaScript + Canvas, no game engine, no 3D models/textures/shaders) determines perspective, depth, occlusion, and visibility per frame, then draws the result as styled text — letters, numbers, and symbols standing in for geometry, lighting, and material.

Status: working prototype ("Asciity" per community naming), single HTML file, publicly demoed via video, not yet released.

## 2. Background
Source material for this PRD is a YouTube devlog ("A Walkable ASCII Cyberpunk City in One HTML File," Grow Now! Games) plus its comment section. The video demonstrates a first-person walk through a night-time cyberpunk city block: roads, multi-story buildings, trees, parked/moving cars, and pedestrians, all rendered as ASCII with a glow/dither aesthetic and a synced ambient soundtrack.

Core technical claims from the creator (transcript):
- Single HTML file; vanilla JavaScript + Canvas 2D. No Unity/Unreal, no 3D assets.
- World model is a grid: cells store road/building/tree/car/pedestrian occupancy plus attributes like building height.
- Per-frame rendering casts rays from the camera across the grid; first-hit distance drives perspective, scale, and occlusion (painter's-algorithm-style depth sorting).
- Distance-based character/brightness falloff: near objects render as larger, brighter character clusters; distant objects shrink and fade to black.
- Engine also handles basic simulation: collision, car movement, pedestrian movement.

## 3. Goals
- Ship a self-contained, dependency-free ASCII city walking demo that is genuinely playable/exploitable (not just a rendered clip).
- Preserve and deepen the "alive" quality reviewers responded to: motion, density, atmosphere, and legibility despite the ASCII constraint.
- Keep the project technically minimal and inspectable — single file, no build step, no external engine — as a deliberate constraint/aesthetic, not a limitation to "graduate" out of.

## 4. Non-Goals (for this iteration)
- Full game systems (quests, combat, inventory, NPC AI beyond ambient wandering).
- Multiplayer.
- Porting off Canvas 2D/vanilla JS to a framework or engine, unless a specific performance wall is hit.
- Photorealism or leaving the ASCII-only rendering constraint.

## 5. Target Audience
- Primary: creative-coding / demoscene / indie-dev audience who value visible technique (raycasting, procedural cities, ASCII art) over production polish.
- Secondary: players who want an atmospheric, explorable "cyberspace" toy — comparisons drawn by viewers include Neuromancer/Sprawl trilogy, Blade Runner, Dwarf Fortress adventure mode, and early Wolfenstein/DOOM raycasting.

## 6. Current Feature Set (as demonstrated)
| Feature | Description |
|---|---|
| Grid-based city model | Stores road/building/tree/car/pedestrian placement and building height per cell |
| Raycast renderer | Per-frame rays from camera resolve first hit, distance, and occlusion |
| ASCII character mapping | Distance/brightness mapped to character size, density, and glyph choice |
| Depth fade | Near = large/bright clusters; far = small, dim, fading to black |
| Object sorting | Correct front/behind ordering for overlapping objects (buildings, trees, cars, pedestrians) |
| Transparency | Foliage (trees) rendered with a see-through/dithered effect — called out repeatedly as a standout detail |
| Basic simulation | Car and pedestrian movement, collision handling |
| Player movement | First-person walk-through with camera-driven raycasting |
| Audio | Ambient synced soundtrack (viewer-noted "'80s tom toms" percussion vibe) |

## 7. Requested / Candidate Features (sourced from viewer feedback)
Ranked informally by frequency/specificity of the ask:

1. **Day/night cycle** with sky dithering using Unicode shade block characters (░▒▓) — most specific, most-repeated request.
2. **Water/rivers** — a waterfront or river running through the city, for visual variety and scene composition.
3. **Deeper atmosphere pass** — more detail density, lighting variation, weather, or fog to extend the cyberpunk mood.
4. **Public/playable release** — many commenters explicitly ask for a downloadable or web-hosted build, not just video capture.
5. **Expanded interaction** — turning the tech demo into an actual small game (a "low-end robot" player character concept was suggested), possibly with a specific creative direction rather than open-world wandering.
6. **Scale showcase** — feedback that the city already communicates scale well; a candidate direction is leaning into bigger/denser environments.

## 8. Proposed Scope for Next Milestone
Given the above, a reasonable next milestone (subject to the creator's own priorities — this is not yet confirmed) breaks into:

**8.1 Rendering/Atmosphere**
- Implement day/night cycle: time-of-day state driving a sky gradient rendered via Unicode shade characters, plus corresponding changes to ambient brightness/character palette used for buildings and street-level objects.
- Add a water tile type (river/canal) to the grid model with its own render treatment (e.g., animated glyph flicker to suggest reflections/movement).

**8.2 Release**
- Package the single HTML file for public/static hosting (no server dependency beyond static file serving) so it can be shared as a playable link rather than only a video.
- Define minimum browser/perf target (desktop Chrome/Firefox, target frame rate at a given grid/view-distance size).

**8.3 Simulation depth (stretch)**
- Extend pedestrian/car behavior beyond ambient wandering (basic pathing along road grid, simple traffic rules) if it doesn't compromise frame rate.

## 9. Technical Constraints & Principles
- Single HTML file, vanilla JS + Canvas — maintain as a hard constraint unless proven unworkable.
- No 3D engine, no model/texture assets — all visual output must reduce to character + color + brightness.
- Performance budget must accommodate raycasting per-frame over the full grid at interactive frame rates in-browser with no build/compile step.

## 10. Decisions (2026-08-15)
- **Scope:** Walkable tech demo only — raycast ASCII city with roads, buildings, trees, cars, pedestrians, first-person movement. No game loop.
- **World:** Fully procedural, seeded generation (road grid, building heights, tree placement).
- **File layout:** Develop as split JS modules; a minimal build step inlines everything into one shippable `index.html` for release.
- **Audio:** Skipped for this milestone.

## 10b. Sunlight + AO — SHIPPED (2026-08-15)
- **Sunlight:** per-cell shadow-height map baked at generation (`js/light.js`); a point at height z is sunlit iff z ≥ shadowH. Directional face term + cast shadows, one lookup per sample.
- **Ambient occlusion:** neighbor-occupancy bake, height-faded (contact darkening at building bases).
- **Day mode** (default; `N` toggles night): dithered sky gradient + sun disc, buildings desaturate to concrete gray, distance fades to bright haze with far surfaces tinting sky-blue (aerial perspective). Night keeps neon/lit-windows/starfield.
- Also shipped: fullscreen (grid sized from window, `F` key) and free mouse-look (pitch via horizon offset).

## 10a. Remaining Open Questions
- Controls: WASD + mouse-look vs. keyboard-only turning (default assumption: WASD move, arrow keys/mouse turn).
- Target frame rate and canvas resolution (default assumption: 60 fps desktop, character grid ~160×90).

## 11. Success Metrics
- Qualitative: maintain or grow the "feels alive" response — motion, density, atmosphere — in future demos/releases.
- Distribution: at least one publicly playable (non-video) build available.
- Technical: day/night cycle and water tiles integrated without breaking the single-file/no-dependency constraint or dropping frame rate below the established baseline.

## 12. Source
Compiled from a YouTube devlog transcript, video description, and public comments (Grow Now! Games channel, "A Walkable ASCII Cyberpunk City in One HTML File," published 2026-08-13). All feature requests in Section 7 are third-party viewer suggestions, not confirmed roadmap commitments.
