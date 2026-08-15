# ASCII City

A walkable cyberpunk city rendered entirely in ASCII characters. Custom raycast
engine in vanilla JavaScript + Canvas 2D — no game engine, no 3D models, no
textures, no shaders. Ships as a single HTML file.

![](docs/screenshot.png)

## Run

Open `dist/index.html` in a browser. That's it — the file is self-contained.

**Controls:** WASD move · arrow keys turn · Shift run · click the canvas for mouse-look.

## How it works

- The world is a seeded procedural grid (`js/world.js`): a road lattice with
  lane markings and sidewalks carves the map into blocks; blocks fill with
  building footprints of varying height, plazas, and trees.
- Every frame, a DDA raycaster (`js/renderer.js`) marches one ray per screen
  column through the grid. Perpendicular hit distance drives perspective and
  scale; front-to-back column clipping handles occlusion between buildings of
  different heights. Floor casting fills the ground, billboard projection
  draws cars and pedestrians with a per-cell depth buffer.
- Tree foliage is transparent: dithered glyph coverage that doesn't advance
  the occlusion clip, so the world shows through the gaps.
- Everything reduces to (glyph, color, depth) in a character-cell framebuffer.
  Brightness flows through a single composable stage (`Renderer.shade`) —
  distance fade today; sunlight and ambient occlusion multiply in later.
  Brightness picks the glyph and palette level; bright glyphs get a bloom pass.
- One batched `fillText` per same-color run per row keeps the draw pass fast
  (~6.5 ms/frame at 150×68 characters).

## Development

Source is split into plain scripts under `js/`, loaded by `index.html` in
order (shared global scope, no modules, no build step needed for dev — just
serve the folder and open it).

```bash
node build.js
```

inlines all scripts into `dist/index.html` for release.

## Project docs

See [PRD.md](PRD.md) for scope, decisions, and the feature backlog
(day/night cycle, water, sunlight + AO, audio).
