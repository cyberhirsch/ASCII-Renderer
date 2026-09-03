// Tests for the infinite procedural terrain: smoothness, range, sea coverage,
// tree density, spawn validity, and JS-side determinism. The WGSL twin cannot
// run here; parity rests on the functions being line-for-line ports (see the
// KEEP IN SYNC comments in js/webgpu/shaders.js and js/util.js).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const src = ['config', 'util', 'world']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, terrainH, treeAt, World });';
const c = vm.runInNewContext(src, { console, Math }, { filename: 'under-test' });

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);

// range and statistics over a wide area
let min = Infinity, max = -Infinity, sum = 0, below = 0;
const N = 200;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const h = c.terrainH(i * 7.3 - 700, j * 7.3 - 700);
  if (h < min) min = h;
  if (h > max) max = h;
  sum += h;
  if (h < c.CFG.SEA_LEVEL) below++;
}
ok(`height min=${min.toFixed(2)} max=${max.toFixed(2)} mean=${(sum / (N * N)).toFixed(2)} (amp ${c.CFG.TERRAIN_MAX})`);
if (max > c.CFG.TERRAIN_MAX + 1e-6) fail('height exceeds TERRAIN_MAX');
if (max < c.CFG.TERRAIN_MAX * 0.55) fail('mountains too low');
if (min > c.CFG.SEA_LEVEL) fail('no terrain below sea level anywhere');
const seaFrac = below / (N * N);
(seaFrac > 0.03 && seaFrac < 0.6)
  ? ok(`sea coverage ${(seaFrac * 100).toFixed(1)}%`)
  : fail(`sea coverage out of range: ${(seaFrac * 100).toFixed(1)}%`);

// smoothness: worst step across a 0.25 lattice must stay well under the old
// 0.5-unit terracing — this is the "no minecraft" property
let worst = 0;
for (let i = 0; i < 4000; i++) {
  const x = (i % 63) * 3.17, y = ((i / 63) | 0) * 2.71;
  const h0 = c.terrainH(x, y);
  const dh = Math.max(
    Math.abs(c.terrainH(x + 0.25, y) - h0),
    Math.abs(c.terrainH(x, y + 0.25) - h0));
  if (dh > worst) worst = dh;
}
worst < 0.45 ? ok(`smooth: worst 0.25-step delta ${worst.toFixed(3)}`)
             : fail(`terrain too steep/jagged: 0.25-step delta ${worst.toFixed(3)}`);

// determinism
const a1 = c.terrainH(1234.5, -987.25), a2 = c.terrainH(1234.5, -987.25);
a1 === a2 ? ok('terrainH deterministic') : fail('terrainH nondeterministic');

// tree density: forests exist but are not wall-to-wall
let trees = 0, cells = 0;
for (let ix = -400; ix < 400; ix += 2) for (let iy = -400; iy < 400; iy += 2) {
  cells++;
  if (c.treeAt(ix, iy)) trees++;
}
const density = trees / cells;
(density > 0.005 && density < 0.12)
  ? ok(`tree density ${(density * 100).toFixed(2)}% over ${cells} cells`)
  : fail(`tree density out of range: ${(density * 100).toFixed(2)}%`);

// tree params sane
let badTree = 0;
for (let ix = -50; ix < 50; ix++) for (let iy = -50; iy < 50; iy++) {
  const t = c.treeAt(ix, iy);
  if (!t) continue;
  if (t.cx < ix || t.cx > ix + 1 || t.cy < iy || t.cy > iy + 1) badTree++;
  if (t.r < 0.9 || t.r > 1.6 || t.trunkH < 2.5 || t.trunkH > 3.9) badTree++;
}
badTree === 0 ? ok('tree params in range') : fail(`${badTree} trees out of range`);

// Nothing grows out of a lake. Checked at the ANCHOR, which is what the
// gate uses and what the trunk is drawn from - a cell can be under water
// while the anchor a third of a cell away is not, and the tree is real.
// The shoreline count is the other half of it: refusing the water must not
// also shave the coast bald.
let wet = 0, shore = 0, wrongG = 0, found = 0;
for (let ix = -400; ix < 400; ix++) for (let iy = -400; iy < 400; iy++) {
  const t = c.treeAt(ix, iy);
  if (!t) continue;
  found++;
  if (t.g < c.CFG.SEA_LEVEL) wet++;
  if (t.g < c.CFG.SEA_LEVEL + 0.6) shore++;
  if (t.g !== c.terrainH(t.cx, t.cy)) wrongG++;
}
wet === 0 ? ok(`no trees in the water (${found} checked)`)
          : fail(`${wet} trees stand in water`);
wrongG === 0 ? ok('tree.g is the ground at the anchor')
             : fail(`${wrongG} trees carry the wrong ground height`);
shore > 100 ? ok(`${shore} trees still stand within 0.6 of the waterline`)
            : fail(`the coast went bald: only ${shore} shoreline trees`);

// spawn: dry, gentle, reachable
const [sx, sy] = c.World.findSpawn();
const sh = c.terrainH(sx, sy);
(sh >= c.CFG.SEA_LEVEL + 0.6)
  ? ok(`spawn at ${sx.toFixed(1)},${sy.toFixed(1)} h=${sh.toFixed(2)}`)
  : fail(`spawn is wet: h=${sh.toFixed(2)}`);

// far-field: the world keeps producing sane terrain a long way out
for (const d of [1e4, 1e5]) {
  const h = c.terrainH(d, -d);
  (h >= 0 && h <= c.CFG.TERRAIN_MAX) ? ok(`sane at distance ${d}: h=${h.toFixed(2)}`)
    : fail(`broken at distance ${d}: h=${h}`);
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nterrain tests passed');
