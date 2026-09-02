// Tests for the asset catalogue and the ASCII tracer that draws it.
//
// The interesting one is the support test. Every review pass on the sheet so
// far has come back with the same sentence in it - "floating stones", "rocks
// are floating", "floating pieces when decaying" - because a facet is a
// bounding sphere with cuts taken out of it and putting its centre a radius
// above the ground leaves it hanging. That is a class of bug, not an
// instance, so it is checked here rather than fixed three times.
//
// Usage: node scripts/test-assets.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const src = ['js/config.js', 'js/util.js', 'js/items.js', 'js/webgpu/atlas.js',
             'js/assets.js', 'js/assetview.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n') + '\n({ CFG, ASSET, AMAT, Assets, AssetView, Build, Artifact, ' +
  'InWorld, assetCtx, partsBounds, partBounds, convVerts, stageOf, ' +
  'transformParts, figureParts, sinkParts, beam, rotApply, basisOf, ' +
  'matMul, GlyphAtlas, PROPS });';
const c = vm.runInNewContext(src, { console, Math, JSON }, { filename: 'under-test' });

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);
const { Assets, AssetView, ASSET, AMAT, partsBounds, partBounds } = c;

const ALL = Assets.all();
const DECAYS = [0, 0.2, 0.45, 0.7, 0.9, 1];

// ---- 1. the catalogue is well formed ----
{
  const ids = new Set();
  let dup = null, orphan = null, unnamed = null;
  for (const e of ALL) {
    if (ids.has(e.id)) dup = e.id;
    ids.add(e.id);
    if (!Assets.GROUPS.some(g => g.id === e.g)) orphan = e.id;
    if (!e.name || !e.why) unnamed = e.id;
  }
  ids.size === ALL.length && !dup ? ok(`${ALL.length} assets, ids unique`)
    : fail('duplicate asset id: ' + dup);
  !orphan ? ok('every asset is in a declared group') : fail('orphan group: ' + orphan);
  // pillar 6 in miniature: an entry that cannot say why it exists is flavour
  !unnamed ? ok('every asset says what it is for') : fail('no reason given: ' + unnamed);
  const mats = new Set();
  for (const e of ALL) for (const p of Assets.make(e.id, { decay: 0.5 }).parts) mats.add(p.mat);
  const bad = [...mats].filter(m => m !== 'ground' && !AMAT[m]);
  !bad.length ? ok('every material drawn is a declared one')
    : fail('undeclared material: ' + bad.join(', '));
}

// ---- 2. determinism ----
{
  const a = JSON.stringify(Assets.make('longhouse', { decay: 0.6 }).parts);
  const b = JSON.stringify(Assets.make('longhouse', { decay: 0.6 }).parts);
  a === b ? ok('two builds of a seed agree part for part') : fail('build is not deterministic');
  // and a neighbour's parts do not shift when this one is asked for
  const x = JSON.stringify(Assets.make('granary', { decay: 0.3 }).parts);
  Assets.make('tower', { decay: 0.9 });
  const y = JSON.stringify(Assets.make('granary', { decay: 0.3 }).parts);
  x === y ? ok('assets are keyed independently') : fail('one asset perturbs another');
}

// ---- 3. nothing floats ----
// A part is supported if it reaches the ground, or if some other part whose
// footprint it overlaps rises to meet it. Approximate on purpose: it is
// looking for a stone hanging in mid-air, not proving a structure stands up.
function unsupported(parts) {
  const B = parts.map(partBounds);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const b = B[i];
    if (b.lo[2] <= 0.03) continue;                      // on the ground
    let held = false;
    for (let j = 0; j < parts.length && !held; j++) {
      if (j === i) continue;
      const o = B[j];
      if (o.hi[0] < b.lo[0] - 0.02 || o.lo[0] > b.hi[0] + 0.02) continue;
      if (o.hi[1] < b.lo[1] - 0.02 || o.lo[1] > b.hi[1] + 0.02) continue;
      if (o.hi[2] >= b.lo[2] - 0.06 && o.lo[2] <= b.hi[2] + 0.06) held = true;
    }
    if (!held) out.push({ i, k: parts[i].k, mat: parts[i].mat, z: b.lo[2] });
  }
  return out;
}
{
  const bad = [];
  for (const e of ALL) {
    if (e.kindOf === 'carry' || e.kindOf === 'find') continue;   // held, not stood
    for (const d of DECAYS) {
      const f = unsupported(Assets.make(e.id, { decay: d, figure: false }).parts);
      if (f.length) bad.push(`${e.id}@${d}: ${f.length} (${f[0].k}/${f[0].mat} ` +
        `at z=${f[0].z.toFixed(2)})`);
    }
  }
  !bad.length ? ok('nothing floats, at any decay')
    : fail('floating parts:\n        ' + bad.slice(0, 12).join('\n        '));
}

// ---- 4. a new building is a whole building ----
// The sheet asked this one directly: is it 100% intact when no decay is
// there? It has to be, or every stage below it is measured from nothing.
{
  // measured on the built thing only: what grows back through a ruin is
  // taller than the ruin, and counting it would say a wall got higher
  const GREEN = new Set(['moss', 'leaf', 'turf']);
  const built = ps => partsBounds(ps.filter(p => !GREEN.has(p.mat)));
  const bad = [], inert = [];
  for (const e of ALL) {
    if (e.kindOf !== 'building') continue;
    const A = Assets.make(e.id, { decay: 0, figure: false }).parts;
    const B = Assets.make(e.id, { decay: 0.9, figure: false }).parts;
    const ha = built(A).hi[2], hb = built(B).hi[2];
    // nothing a building is made of gets taller by being left alone
    if (hb > ha + 0.02) bad.push(`${e.id}: ${ha.toFixed(1)}m -> ${hb.toFixed(1)}m`);
    // and decay has to do something, even where that something is not height
    if (JSON.stringify(A) === JSON.stringify(B)) inert.push(e.id);
  }
  !bad.length ? ok('no building grows by being abandoned')
    : fail('decay adds height to:\n        ' + bad.join('\n        '));
  !inert.length ? ok('decay changes every building')
    : fail('decay does nothing to: ' + inert.join(', '));
}
{
  // and the ragged top has to arrive with the decay, not be there from the
  // day it was built
  const P = [];
  const ctx = c.assetCtx({ key: 'wall-test', decay: 0 });
  const wallRun = vm.runInNewContext(
    fs.readFileSync(path.join(root, 'js/config.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(root, 'js/util.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(root, 'js/assets.js'), 'utf8') +
    '\n(wallRun)', { console, Math, JSON });
  wallRun(P, ctx, 'wt', -4, 0, 4, 0, 2.0, 0.4, 'stone', 8);
  const tops = P.filter(p => p.k === 'box').map(p => p.c[2] + p.he[2]);
  const flat = tops.length && tops.every(t => Math.abs(t - 2.0) < 1e-6);
  flat ? ok('an undecayed wall has a straight top')
       : fail('wall at decay 0 is already ragged: ' + tops.map(t => t.toFixed(2)).join(' '));
}

// ---- 5. bounds are the real bounds ----
// A cylinder bounded by spheres at each end claimed a flat plinth was as
// tall as it was wide, and the sheet prints these numbers as metres.
{
  const p = c.Assets.byId('tower') ? null : null;
  const disc = { k: 'cyl', c: [0, 0], r: 3, z0: 0, z1: 0.4, mat: 'stone', q: null };
  const b = partBounds(disc);
  (Math.abs(b.lo[2]) < 1e-9 && Math.abs(b.hi[2] - 0.4) < 1e-9 &&
   Math.abs(b.hi[0] - 3) < 1e-9)
    ? ok('a flat cylinder is bounded as a disc, not a sphere')
    : fail(`disc bounds wrong: z ${b.lo[2]}..${b.hi[2]}, x ${b.hi[0]}`);
  // and a cylinder laid on its side is bounded the other way round
  const lying = { k: 'cyl', c: [0, 0], r: 0.5, z0: 0, z1: 2, mat: 'stone', q: [0, Math.PI / 2] };
  const lb = partBounds(lying);
  (Math.abs(lb.hi[0] - 2) < 1e-6 && Math.abs(lb.hi[2] - 0.5) < 1e-6)
    ? ok('a rotated cylinder is bounded along its own axis')
    : fail(`lying cylinder bounds wrong: x..${lb.hi[0]} z..${lb.hi[2]}`);
  // and every asset's box actually contains its parts
  let leak = null;
  for (const e of ALL) {
    const m = Assets.make(e.id, { decay: 0.5 });
    for (const part of m.parts) {
      const pb = partBounds(part);
      for (let k = 0; k < 3; k++) {
        if (pb.lo[k] < m.bounds.lo[k] - 1e-6 || pb.hi[k] > m.bounds.hi[k] + 1e-6) {
          leak = e.id + ' ' + part.k;
        }
      }
    }
  }
  !leak ? ok('an asset\'s bounds contain all of its parts') : fail('part outside bounds: ' + leak);
}

// ---- 6. the convex bodies are closed ----
{
  let open = null;
  for (const e of ALL) {
    for (const p of Assets.make(e.id, { decay: 0.4 }).parts) {
      if (p.k !== 'conv') continue;
      if (c.convVerts(p.planes).length < 4) open = e.id;
    }
  }
  !open ? ok('every convex body has a solid interior')
        : fail('unbounded or empty convex body in ' + open);
  // the gable's pitch plane must contain both the ridge and the eave, which
  // is the pair that was transposed and built a roof the wrong shape
  const g = c.Build.longhouse(c.assetCtx({ key: 'g', decay: 0 })).find(p => p.k === 'conv');
  if (!g) fail('no roof on an undecayed longhouse');
  else {
    const V = c.convVerts(g.planes);
    const top = Math.max(...V.map(v => v[2])), wide = Math.max(...V.map(v => Math.abs(v[1])));
    top > 1.2 && wide > 1.5 ? ok('the roof is a ridge over a span')
      : fail(`roof is the wrong shape: rise ${top.toFixed(2)} span ${wide.toFixed(2)}`);
  }
}

// ---- 7. transforms compose ----
{
  const base = [{ k: 'box', c: [1, 0, 0], he: [0.5, 0.2, 0.2], mat: 'stone', q: [0.4, 0.3] }];
  const once = c.transformParts(c.transformParts(base, { yaw: 0.7 }), { yaw: -0.7 });
  const b0 = partBounds(base[0]), b1 = partBounds(once[0]);
  let same = true;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(b0.lo[k] - b1.lo[k]) > 1e-6 || Math.abs(b0.hi[k] - b1.hi[k]) > 1e-6) same = false;
  }
  same ? ok('a rotation and its inverse compose to nothing')
       : fail('transformParts does not compose');
  // a held thing has to end up in front of the eye, not behind it
  for (const e of ALL.filter(x => x.hold)) {
    const m = Assets.make(e.id, { view: 'fp' });
    // a long haft passes the shoulder, which is what carrying one is like -
    // what must not happen is the whole thing ending up behind the head
    if (m.bounds.hi[0] < 0.30 || m.bounds.lo[0] < -0.40) {
      fail('held behind the eye: ' + e.id); break;
    }
    if (m.bounds.hi[2] > CFGEYE() + 0.9) { fail('held over the head: ' + e.id); break; }
  }
  function CFGEYE() { return c.CFG.EYE; }
  ok('everything holdable is held in front of the eye');

  // ...and nothing that has stopped being an object is held at all. Once a
  // find is down to a stain in the soil there is nothing to pick up, so the
  // first-person view has to decline rather than hold a discolouration up.
  const finds = ALL.filter(x => x.kindOf === 'find' && x.hold);
  let heldStain = null, noStain = null;
  for (const e of finds) {
    const gone = Assets.make(e.id, { view: 'fp', cond: 0.02 });
    if (gone.held) heldStain = e.id;
    if (!gone.gone) noStain = e.id;
    const kept = Assets.make(e.id, { view: 'fp', cond: 1 });
    if (!kept.held) heldStain = e.id + ' (sound)';
  }
  !heldStain && !noStain
    ? ok('a stain is not something you can hold')
    : fail('stain held in hand: ' + (heldStain || noStain));
}

// ---- 8. the tracer ----
{
  // a ray straight down the axis of a unit sphere at the origin
  const h = AssetView.hitSphere([0, 0, 5], [0, 0, -1], [0, 0, 0], 1);
  h && Math.abs(h[0] - 4) < 1e-6 && Math.abs(h[3] - 1) < 1e-6
    ? ok('sphere hit distance and normal') : fail('hitSphere wrong: ' + JSON.stringify(h));
  // a cone's slope normal points away from its axis and downward on a taper
  const cn = AssetView.hitCone([3, 0, 0.5], [-1, 0, 0], [0, 0], 0, 2, 1, 0, null);
  cn && cn[1] > 0 && cn[3] > 0
    ? ok('cone side normal leans out and up') : fail('hitCone normal wrong: ' + JSON.stringify(cn));
  // the glyph ramp is monotone in tone: brighter never picks a lighter glyph
  const R = AssetView.ramp();
  let mono = true, prev = -1;
  for (let i = 0; i <= 40; i++) {
    const g = R.indexOf(AssetView.glyph(i / 40 * 0.72, 0, 0));
    if (g < prev) mono = false;
    prev = g;
  }
  mono ? ok('the ramp is monotone in luminance') : fail('ramp is not monotone');
  R.length > 8 ? ok(`ramp has ${R.length} steps`) : fail('ramp too short: ' + R.length);
}

// ---- 9. every asset draws something ----
{
  const thin = [];
  for (const e of ALL) {
    for (const d of [0, 0.5, 0.95]) {
      const view = e.hold && d === 0.5 ? 'fp' : 'orbit';
      const m = Assets.make(e.id, { decay: d, cond: 1 - d, figure: false, view });
      const f = AssetView.render(m.parts, { cols: 44, rows: 18, view });
      const ink = f.ch.filter(x => x && x !== ' ').length;
      if (ink < 30) thin.push(`${e.id}@${d} (${ink} cells, ${m.parts.length} parts)`);
      if (f.ch.some(x => x === undefined)) fail('unpainted cell in ' + e.id);
    }
  }
  !thin.length ? ok('every asset draws something at every stage')
    : fail('nearly empty:\n        ' + thin.join('\n        '));
}

// ---- 10. the stage words line up with the decay axis ----
{
  const seen = DECAYS.map(d => c.stageOf(d));
  const names = ASSET.STAGES.map(s => s[1]);
  seen[0] === names[0] && seen[seen.length - 1] === names[names.length - 1]
    ? ok('the decay axis runs from standing to footings')
    : fail('stage words do not span the axis: ' + seen.join(' -> '));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall asset tests passed');
process.exit(failures ? 1 : 0);
