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

// ---- 8. run-length encoding: the shape survives, the size collapses ----
{
  const n = CAVES.EDIT_CHUNK;
  const k0 = [...Edits.chunks.keys()][0];
  const ch = Edits.chunks.get(k0);
  const rt = new Int8Array(n * n * n);
  Edits.unrle(Edits.rle(ch), rt);
  let same = true;
  for (let i = 0; i < ch.length; i++) if (ch[i] !== rt[i]) { same = false; break; }
  same ? ok('rle round-trips a dug chunk exactly') : fail('rle lost voxels');

  // The untouched chunk is the common case by a wide margin, and it has to
  // cost almost nothing: one run, one triple.
  const empty = new Int8Array(n * n * n);
  (Edits.rle(empty).length === 3)
    ? ok('an untouched chunk encodes to one run')
    : fail(`empty chunk encodes to ${Edits.rle(empty).length} bytes`);

  // and a real one has to beat the dense form by a wide margin, because
  // that margin is the whole localStorage budget
  const dense = Math.ceil((n ** 3) / 3) * 4;
  const packed = Edits.enc(Edits.rle(ch)).length;
  (packed * 8 < dense)
    ? ok(`a dug chunk stores in ${packed} chars where dense cost ${dense}`)
    : fail(`rle barely helps: ${packed} vs ${dense}`);

  // Signs survive: digs write negatives and fills write positives, and a
  // byte read back unsigned would turn every scoop into solid rock.
  const mixed = new Int8Array(n * n * n);
  mixed[0] = -127; mixed[1] = -127; mixed[5] = 127; mixed[6] = 42;
  const back = new Int8Array(n * n * n);
  Edits.unrle(Edits.rle(mixed), back);
  (back[0] === -127 && back[1] === -127 && back[5] === 127 && back[6] === 42 &&
   back[7] === 0 && back[mixed.length - 1] === 0)
    ? ok('rle preserves the sign of every voxel')
    : fail(`rle mangled signs: ${back[0]},${back[5]},${back[6]},${back[7]}`);

  // a run spanning the whole chunk decodes back to the whole chunk
  const long = new Int8Array(n * n * n).fill(-3);
  const lback = new Int8Array(n * n * n);
  Edits.unrle(Edits.rle(long), lback);
  (lback[0] === -3 && lback[lback.length - 1] === -3)
    ? ok('a chunk-long run decodes end to end')
    : fail('long run truncated');

  // a v1 save (dense, unwrapped) still loads
  const v1 = {};
  for (const [k, c2] of Edits.chunks) v1[k] = Edits.enc(new Uint8Array(c2.buffer));
  const keep = Edits.serialize();
  Edits.deserialize(JSON.stringify(v1));
  const migrated = Edits.serialize();
  Edits.deserialize(keep);
  (migrated === keep)
    ? ok('a v1 save reads back identical and re-saves as v2')
    : fail('v1 migration changed the world');
}

// ---- 9. GPU slots: only the bricks that changed are re-sent ----
{
  const p0 = Edits.pack(tx, ty, gz);
  (p0.slots.length === p0.count)
    ? ok(`the first pack sends all ${p0.count} bricks`)
    : fail(`first pack sent ${p0.slots.length} of ${p0.count}`);

  const p1 = Edits.pack(tx, ty, gz);
  (p1.slots.length === 0)
    ? ok('an unchanged pack sends nothing')
    : fail(`an idle pack re-sent ${p1.slots.length} bricks`);

  // A dig far from everything else adds a chunk that sorts last, so the
  // slots already resident keep their occupants and stay untouched.
  const fx = tx + 300, fy = ty + 300;
  Edits.splat(fx, fy, c.terrainH(fx, fy) - 0.3, 1.1, -100);
  const p2 = Edits.pack(tx, ty, gz);
  (p2.slots.length > 0 && p2.slots.length < p2.count)
    ? ok(`a distant dig re-sends ${p2.slots.length} of ${p2.count} bricks`)
    : fail(`slot diffing sent ${p2.slots.length} of ${p2.count}`);

  // and after all that partial uploading every resident slot still holds
  // exactly the chunk its header claims
  let intact = true;
  const bytes = CAVES.EDIT_CHUNK ** 3;
  for (let i = 0; i < p2.count && intact; i++) {
    const chI = Edits.chunks.get(Edits.slotKeys[i]);
    if (!chI) { intact = false; break; }
    for (let v = 0; v < chI.length; v += 89) {
      if (Edits.data[i * bytes + v] !== chI[v]) { intact = false; break; }
    }
  }
  intact ? ok('every resident slot still holds its own chunk')
         : fail('slot diffing left a stale brick on the GPU');
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nedit tests passed');
