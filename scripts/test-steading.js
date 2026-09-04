// Tests for the seam between the record and the catalogue: what stands on a
// site, where it stands, and how far gone it is.
//
// The promises worth checking are the ones a player would notice being
// broken - a village that rearranges itself between visits, a building
// floating off the hillside, a ruin that looks newer than the record says
// it is, or a place so dense the renderer cannot afford it.
//
// Usage: node scripts/test-steading.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const src = ['js/config.js', 'js/util.js', 'js/items.js', 'js/chronicle.js',
             'js/assets.js', 'js/steading.js', 'js/lore.js', 'js/npc.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n') + '\n({ CFG, HIST, ASSET, Chronicle, Steading, Build, terrainH, ' +
  'partsBounds, Lore, NPC });';
const c = vm.runInNewContext(src, { console, Math, JSON }, { filename: 'under-test' });
const { CFG, HIST, Chronicle, Steading, Build, NPC } = c;

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);
const note = m => console.log('  --  ' + m);

const SEEDS = [8151623, 42, 99991, 12345];
const runs = {};
for (const sd of SEEDS) { CFG.SEED = sd; runs[sd] = Chronicle.run(); }
CFG.SEED = 8151623;
const S = runs[8151623];

// ---- 1. every site plans something, and only things that can be built ----
{
  let empty = 0, unknown = 0, total = 0;
  const kinds = new Set();
  for (const sd of SEEDS) {
    const R = runs[sd];
    CFG.SEED = sd;
    for (const s of R.sites) {
      const plan = Steading.plan(R, s, R.now);
      total += plan.length;
      if (!plan.length) empty++;
      for (const b of plan) { kinds.add(b.build); if (!Build[b.build]) unknown++; }
    }
  }
  CFG.SEED = 8151623;
  (empty === 0) ? ok(`every site raises something (${total} buildings over ${SEEDS.length} worlds)`)
                : fail(`${empty} sites stand empty`);
  (unknown === 0) ? ok(`every building named is one the catalogue can build (${kinds.size} kinds used)`)
                  : fail(`${unknown} plans name a building that does not exist`);
}

// ---- 2. a village does not rearrange itself between visits ----
{
  const s = S.sites[0];
  const a = JSON.stringify(Steading.plan(S, s, S.now));
  const b = JSON.stringify(Steading.plan(S, s, S.now));
  (a === b) ? ok('the same site plans the same village twice')
            : fail('steading layout is not deterministic');
}

// ---- 3. nothing floats, and nothing is buried whole ----
// Every building is placed on the terrain height at its own footprint, not
// the site centre's - a hall on a slope has to meet the ground it is on.
{
  let off = 0, checked = 0;
  for (const s of S.sites.slice(0, 40)) {
    for (const b of Steading.plan(S, s, S.now)) {
      checked++;
      if (Math.abs(b.pos[2] - c.terrainH(b.pos[0], b.pos[1])) > 1e-9) off++;
    }
  }
  (off === 0) ? ok(`every building sits on its own ground (${checked} checked)`)
              : fail(`${off} buildings float off the terrain`);
}

// ---- 4. decay runs one way, and agrees with the record ----
{
  let back = 0, checked = 0, disagree = 0;
  for (const s of S.sites) {
    if (s.abandoned < 0) {
      if (Steading.decay(S, s, S.now) !== 0) disagree++;
      continue;
    }
    let prev = -1;
    for (let y = s.abandoned; y <= S.now; y += 200) {
      const d = Steading.decay(S, s, y);
      if (d < prev - 1e-9) back++;
      prev = d;
      checked++;
    }
    // the record's own stage and this decay must not contradict each other
    const st = Chronicle.stage(S, s, S.now);
    const d = Steading.decay(S, s, S.now);
    if (st === 0 && d > 0.01) disagree++;
    if (st >= 4 && d < 0.4) disagree++;
  }
  (back === 0) ? ok(`a building never un-ruins itself (${checked} samples)`)
               : fail(`${back} steadings repaired themselves over time`);
  (disagree === 0) ? ok('decay and the record agree about what is standing')
                   : fail(`${disagree} sites where the shape and the record disagree`);
  const lived = S.sites.filter(s => s.abandoned < 0).length;
  note(`${lived} sites still lived in at year ${S.now}, and they read as decay 0`);
}

// ---- 5. size follows the record: a big place is a bigger place ----
{
  let small = null, big = null;
  for (const s of S.sites) {
    if (s.kind !== 'farm') continue;
    if (!small || s.peak < small.peak) small = s;
    if (!big || s.peak > big.peak) big = s;
  }
  if (small && big && big.peak > small.peak * 2) {
    const a = Steading.plan(S, small, S.now).length;
    const b = Steading.plan(S, big, S.now).length;
    (b >= a) ? ok(`a farm of ${Math.round(big.peak)} raises ${b} buildings, one of ${Math.round(small.peak)} raises ${a}`)
             : fail(`the bigger farm is smaller: ${b} vs ${a}`);
  } else note('no clear big/small farm pair at this seed (skipped)');
}

// ---- 6. what it costs the renderer ----
// The whole point of the seam is that a renderer can afford it. A steading
// has to fit a primitive budget, and the bounding volume has to be tight
// enough that one test throws the whole place away.
{
  let worst = 0, worstWho = '', tot = 0, n = 0, wide = 0;
  for (const s of S.sites) {
    const parts = Steading.parts(S, s, S.now);
    tot += parts.length; n++;
    if (parts.length > worst) { worst = parts.length; worstWho = s.kind + ' ' + s.name; }
    const B = c.partsBounds(parts);
    if (B.r > 60) wide++;
  }
  note(`${n} steadings, ${tot} primitives in all, ${Math.round(tot / n)} on average`);
  (worst < 1200) ? ok(`the heaviest place is ${worst} primitives (${worstWho})`)
                 : fail(`a steading costs ${worst} primitives - too many to draw`);
  (wide === 0) ? ok('every steading fits inside a sane bounding sphere')
               : fail(`${wide} steadings have a bounding sphere over 60 units`);
}

// ---- 7. the parts are real geometry, in world space ----
{
  const s = S.sites.find(x => x.kind === 'hold') || S.sites[0];
  const parts = Steading.parts(S, s, S.now);
  const KINDS = new Set(['box', 'cyl', 'sph', 'cone', 'conv', 'facet']);
  let bad = 0, nan = 0;
  for (const p of parts) {
    if (!KINDS.has(p.k)) bad++;
    const nums = [].concat(p.c || [], p.he || [], [p.r, p.z0, p.z1, p.r0, p.r1]);
    for (const v of nums) if (v !== undefined && !isFinite(v)) nan++;
  }
  (bad === 0) ? ok(`every part is a shape the renderer knows (${parts.length} parts)`)
              : fail(`${bad} parts are of an unknown kind`);
  (nan === 0) ? ok('no part has a broken number in it') : fail(`${nan} broken numbers`);
  const B = c.partsBounds(parts);
  const near = Math.hypot(B.c[0] - s.x, B.c[1] - s.y);
  (near < 30) ? ok(`the village is built where the record put it (${near.toFixed(1)} u off centre)`)
              : fail(`the village sits ${near.toFixed(0)} units from its own site`);
}

// ---- 8. the sphere the occlusion path leans on ----
// Every shadow and ambient ray tests one sphere before it tests anything
// else, and skips the whole village if it misses. If that sphere does not
// truly contain every building, light passes straight through walls - and
// it fails silently, because the only symptom is a shadow that is not there.
{
  const MH = 256, MP = 8192;
  const head = new Float32Array(MH * 8), prim = new Float32Array(MP * 20);
  let checked = 0, outside = 0, seeds = 0;
  for (const sd of SEEDS) {
    CFG.SEED = sd;
    const R = runs[sd];
    for (const s of R.sites.slice(0, 12)) {
      const r = Steading.pack(R, s.x, s.y, R.now, head, prim, MH, MP);
      if (!r.heads) continue;
      seeds++;
      if (!r.all) { outside++; continue; }
      for (let i = 0; i < r.heads; i++) {
        const h = i * 8;
        const d = Math.hypot(head[h] - r.all[0], head[h + 1] - r.all[1],
                             head[h + 2] - r.all[2]);
        checked++;
        if (d + head[h + 3] > r.all[3] + 1e-3) outside++;
      }
    }
  }
  CFG.SEED = 8151623;
  (seeds > 0 && outside === 0)
    ? ok(`the occlusion sphere holds every building it claims (${checked} checked)`)
    : fail(`${outside} buildings stick out of the sphere that culls them`);

  // and an empty pack says so rather than handing back a sphere at the origin
  const far = Steading.pack(S, 1e6, 1e6, S.now, head, prim, MH, MP);
  (far.heads === 0 && far.all === null)
    ? ok('nothing resident means no sphere, not a sphere around nothing')
    : fail(`empty pack returned ${JSON.stringify(far.all)}`);
}

// ---- moving the people without laying the village out again ----
// A village is thousands of primitives and none of them change when
// somebody takes a step, so the people are rewritten in place. This is the
// promise that makes that safe: the rewrite touches their slots and nothing
// else, and what it writes is what a full repack would have written.
{
  const S = c.Lore.init();
  const MH = CFG.STEAD_HEAD, MP = CFG.STEAD_PRIM;
  const head = new Float32Array(MH * 8), prim = new Float32Array(MP * 20);
  const e = NPC.elder();
  NPC.tick(0);
  const r = Steading.pack(S, e.x, e.y, S.now, head, prim, MH, MP);
  (Steading.folk && Steading.folk.length > 0)
    ? ok(`packing a village records where its ${Steading.folk.length} people landed`)
    : fail('nobody was recorded during the pack');

  // a full repack at a later moment is the reference
  const h2 = new Float32Array(MH * 8), p2 = new Float32Array(MP * 20);
  NPC.tick(83.5);
  const r2 = Steading.pack(S, e.x, e.y, S.now, h2, p2, MH, MP);
  // and the cheap path has to land in exactly the same place
  NPC.tick(0);
  Steading.pack(S, e.x, e.y, S.now, head, prim, MH, MP);
  NPC.tick(83.5);
  const m = Steading.repose(head, prim);
  m ? ok(`reposing touches ${m.headTo - m.headFrom} headers and ${m.primTo - m.primFrom} primitives`)
    : fail('repose reported nothing moved');
  let dp = 0, dh = 0;
  for (let i = 0; i < r.prims * 20; i++) if (prim[i] !== p2[i]) dp++;
  for (let i = 0; i < r.heads * 8; i++) if (head[i] !== h2[i]) dh++;
  (dp === 0 && dh === 0)
    ? ok('and lands on exactly what a full repack would have written')
    : fail(`${dp} primitive floats and ${dh} header floats differ from a repack`);
  (r2.heads === r.heads && r2.prims === r.prims)
    ? ok('and the set is the same size either way')
    : fail('a repack after moving produced a different set');

  // the resident sphere already covers everywhere anybody can get to
  let outside = 0;
  for (let t = 0; t < 400; t += 6.5) {
    NPC.tick(t);
    for (const f of Steading.folk) {
      const B = c.partsBounds(NPC.parts(f.who));
      const d = Math.hypot(B.c[0] - r.all[0], B.c[1] - r.all[1], B.c[2] - r.all[2]);
      if (d + B.r > r.all[3] + 1e-6) outside++;
    }
  }
  (outside === 0) ? ok('and nobody ever walks out of the sphere that holds them')
                  : fail(`${outside} times somebody left the resident sphere`);
  NPC.tick(0);
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nsteading tests passed');
