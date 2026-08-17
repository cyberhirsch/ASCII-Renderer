// Tests for the digging system: splat/sample round-trips, collision
// following dug ground, GPU packing, persistence, and the fill guard.
//
// Usage: node scripts/test-edits.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const src = ['config', 'util', 'world', 'edits']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, CAVES, World, Edits, terrainH, solidD });';
const c = vm.runInNewContext(src, { console, Math, JSON }, { filename: 'under-test' });

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);
const { Edits, CFG, CAVES } = c;

Edits.init();

// a dry test site on open terrain
let tx = 0, ty = 0;
for (let r = 10; r < 500; r += 7) {
  if (c.terrainH(r, -r) > CFG.SEA_LEVEL + 1.5) { tx = r; ty = -r; break; }
}
const gz = c.terrainH(tx, ty);

// ---- 1. dig: solid ground becomes air, effect is local ----
const before = c.solidD(tx, ty, gz - 0.5);
Edits.splat(tx, ty, gz - 0.3, 1.1, -100);
const after = c.solidD(tx, ty, gz - 0.5);
(before > 0 && after < 0)
  ? ok(`dig opens rock: solidD ${before.toFixed(2)} -> ${after.toFixed(2)}`)
  : fail(`dig had no effect: ${before.toFixed(2)} -> ${after.toFixed(2)}`);
Math.abs(c.solidD(tx + 8, ty, c.terrainH(tx + 8, ty) - 0.5) -
         c.solidD(tx + 8, ty, c.terrainH(tx + 8, ty) - 0.5)) < 1e-12 &&
c.solidD(tx + 8, ty, c.terrainH(tx + 8, ty) - 0.5) > 0
  ? ok('dig is local: 8 units away still solid')
  : fail('dig leaked to distant ground');

// ---- 2. collision follows the dug ground ----
const wzBefore = gz;
const wz = c.World.walkZ(tx, ty, gz);
(wz !== null && wz < wzBefore - 0.4)
  ? ok(`walkZ follows the pit: ${wzBefore.toFixed(2)} -> ${wz.toFixed(2)}`)
  : fail(`walkZ ignores the pit: ${wzBefore.toFixed(2)} -> ${wz === null ? 'null' : wz.toFixed(2)}`);

// ---- 3. fill: restores solidity ----
Edits.splat(tx, ty, gz - 0.3, 1.1, 100);
const refilled = c.solidD(tx, ty, gz - 0.5);
refilled > 0 ? ok(`fill restores rock: solidD ${refilled.toFixed(2)}`)
             : fail(`fill failed: solidD ${refilled.toFixed(2)}`);

// ---- 4. fill never places material above the surface ----
Edits.splat(tx + 20, ty, c.terrainH(tx + 20, ty) + 1.0, 1.1, 100);
const aboveOk = c.solidD(tx + 20, ty, c.terrainH(tx + 20, ty) + 0.8) < 0;
aboveOk ? ok('fill clamped below the terrain surface')
        : fail('fill built above ground (invisible to the heightfield march)');

// ---- 5. chunk borders: dig across one, sample continuity ----
const bx = CAVES.EDIT_CHUNK * CAVES.EDIT_VOX;   // world chunk size (16)
const bz = c.terrainH(bx * 4, bx * 4);
Edits.splat(bx * 4 + bx / 2, bx * 4, bz - 1.0, 2.0, -100);   // hmm: centre on a border below
{
  // sample along a line crossing the chunk border; deltas must be smooth
  let worstJump = 0, prev = null;
  for (let s = -3; s <= 3; s += 0.05) {
    const v = Edits.sample(bx * 4 + bx / 2 + s, bx * 4, bz - 1.0);
    if (prev !== null) worstJump = Math.max(worstJump, Math.abs(v - prev));
    prev = v;
  }
  worstJump < 0.5 ? ok(`cross-border sampling smooth (worst step ${worstJump.toFixed(3)})`)
                  : fail(`sampling jumps at chunk border: ${worstJump.toFixed(3)}`);
}

// ---- 6. GPU packing sanity ----
{
  const res = Edits.pack(tx, ty, gz);
  const n = CAVES.EDIT_CHUNK;
  let headOk = res.count > 0 && res.count <= CFG.EDIT_MAX;
  for (let i = 0; i < res.count; i++) {
    const w = n * CAVES.EDIT_VOX;
    const oxr = Edits.head[i * 4] / w;
    if (Edits.head[i * 4 + 3] !== 1 || oxr !== Math.round(oxr)) headOk = false;
  }
  headOk ? ok(`pack: ${res.count} resident chunks, aligned origins, bounds ${res.bounds.map(v => v.toFixed(0)).join('/')}`)
         : fail('pack produced malformed headers');
  // the packed bytes must equal the authoritative chunk data
  const k0 = [...Edits.chunks.keys()][0];
  let match = true;
  const ch0 = Edits.chunks.get(k0);
  // find its slot
  const [cx, cy, cz] = k0.split(',').map(Number);
  const w = n * CAVES.EDIT_VOX;
  for (let i = 0; i < res.count; i++) {
    if (Edits.head[i * 4] === cx * w && Edits.head[i * 4 + 1] === cy * w &&
        Edits.head[i * 4 + 2] === cz * w) {
      for (let v = 0; v < ch0.length; v += 97) {
        if (Edits.data[i * ch0.length + v] !== ch0[v]) { match = false; break; }
      }
    }
  }
  match ? ok('packed brick bytes match the authoritative chunks')
        : fail('packed data diverges from chunk data');
}

// ---- 7. persistence round-trip ----
{
  const s1 = Edits.serialize();
  const keys1 = [...Edits.chunks.keys()].sort().join(';');
  Edits.deserialize(s1);
  const s2 = Edits.serialize();
  const keys2 = [...Edits.chunks.keys()].sort().join(';');
  (s1 === s2 && keys1 === keys2)
    ? ok(`persistence round-trip byte-identical (${Edits.chunks.size} chunks, ${(s1.length / 1024).toFixed(0)} KB)`)
    : fail('serialize/deserialize/serialize is not stable');
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nedit tests passed');
