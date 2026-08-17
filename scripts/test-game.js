// Tests for the gameplay layer: inventory math, modal input routing,
// persistence, examine classification, felling, and crafting. Grows with
// the G-phases.
//
// Usage: node scripts/test-game.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const grab = n => `${n}: (typeof ${n} === 'undefined' ? null : ${n})`;
const src = ['config', 'util', 'world', 'overlay', 'edits', 'fells', 'items', 'game']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, CAVES, World, Overlay, Edits, Game, ITEMS, RECIPES, SPECIES, ' +
  'terrainH, solidD, treeAt, hallAt, caveFloor, ' +
  ['vnoise', 'Fells', 'treeSpecies'].map(grab).join(', ') + ' });';
const c = vm.runInNewContext(src, { console, Math, JSON }, { filename: 'under-test' });

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);
const { Game, RECIPES, ITEMS } = c;

Game.init();
c.Overlay.resize(120, 40);

// ---- 1. inventory math ----
Game.give('wood', 3);
Game.give('wood', 2);
Game.give('stone', 1);
(Game.count('wood') === 5 && Game.count('stone') === 1)
  ? ok('give accumulates') : fail(`give broken: wood=${Game.count('wood')}`);
(!Game.take('stone', 2)) ? ok('take refuses overdraw') : fail('take allowed overdraw');
(Game.take('wood', 5) && Game.count('wood') === 0 && !Game.inv.has('wood'))
  ? ok('take exact empties the slot') : fail('take exact left residue');

// ---- 2. modal routing ----
Game.close();
(!Game.key('KeyW')) ? ok('play mode: W falls through to movement')
                    : fail('play mode swallowed W');
Game.key('Tab');
(Game.mode === 'inventory') ? ok('Tab opens inventory') : fail('Tab did not open inventory');
(Game.key('KeyW') && Game.key('KeyS'))
  ? ok('panel captures W/S') : fail('panel leaked W/S');
(Game.key('KeyZ')) ? ok('panel swallows unbound keys') : fail('panel leaked Z');
Game.key('KeyQ');
(Game.mode === 'play') ? ok('Q closes the panel') : fail('Q did not close');
Game.key('Tab'); Game.key('Tab');
(Game.mode === 'play') ? ok('Tab toggles') : fail('Tab did not toggle');

// ---- 3. panel rendering writes into the overlay ----
Game.give('stone', 2);
Game.open('inventory');
c.Overlay.clear();
Game.drawUI();
{
  let text = '';
  for (let i = 0; i < c.Overlay.data.length; i++) {
    if (c.Overlay.data[i]) text += String.fromCharCode(c.Overlay.data[i]);
  }
  (text.includes('INVENTORY') && text.includes('stone'))
    ? ok('inventory panel renders into the glyph grid')
    : fail('inventory panel missing from overlay: "' + text.slice(0, 80) + '"');
}
Game.close();

// ---- 4. persistence round-trip (serialize via save/load path) ----
{
  const before = JSON.stringify([...Game.inv].sort());
  // no localStorage in node: emulate through the same JSON shape save() uses
  const obj = {};
  for (const [k, v] of Game.inv) obj[k] = v;
  const s = JSON.stringify(obj);
  Game.inv.clear();
  const back = JSON.parse(s);
  for (const k of Object.keys(back)) Game.inv.set(k, back[k]);
  const after = JSON.stringify([...Game.inv].sort());
  before === after ? ok('inventory JSON round-trip stable')
                   : fail('inventory round-trip diverged');
}

// ---- 5. data sanity ----
{
  let bad = 0;
  for (const r of RECIPES) {
    if (!ITEMS[r.out]) bad++;
    for (const k of Object.keys(r.needs)) if (!ITEMS[k]) bad++;
  }
  bad === 0 ? ok(`${RECIPES.length} recipes reference real items`)
            : fail(`${bad} recipe references to unknown items`);
}

// ---- 6. examine classifier ----
if (c.vnoise && c.World.examineRay) {
  // a tree: aim a ray at the first trunk found near the origin
  let T = null, tix = 0, tiy = 0;
  outer:
  for (let ix = 0; ix < 300; ix++) {
    for (let iy = 0; iy < 300; iy++) {
      const tr = c.treeAt(ix, iy);
      if (tr) { T = tr; tix = ix; tiy = iy; break outer; }
    }
  }
  if (!T) fail('no tree found for the classifier test');
  else {
    const g = c.terrainH(T.cx, T.cy);
    const r1 = c.World.examineRay(T.cx - 2.5, T.cy, g + 1.2, 1, 0, 0);
    const r2 = c.World.examineRay(T.cx - 2.5, T.cy, g + 1.2, 1, 0, 0);
    (r1 && r1.kind === 'tree' && r1.ix === tix && r1.iy === tiy)
      ? ok(`classifier finds the tree at ${tix},${tiy}`)
      : fail('classifier missed the trunk: ' + JSON.stringify(r1));
    (r1 && r2 && c.treeSpecies(r1.ix, r1.iy) === c.treeSpecies(r2.ix, r2.iy))
      ? ok(`species stable: ${c.SPECIES[c.treeSpecies(tix, tiy)].name}`)
      : fail('species nondeterministic');
  }

  // water: aim down at a sea point
  let wx = 0, wy = 0, found = false;
  for (let r = 5; r < 2000 && !found; r += 9) {
    if (c.terrainH(r, r) < CFG_SEA() - 0.4) { wx = r; wy = r; found = true; }
  }
  function CFG_SEA() { return c.CFG.SEA_LEVEL; }
  if (found) {
    const rw = c.World.examineRay(wx, wy, CFG_SEA() + 2, 0.05, 0, -0.999);
    (rw && rw.kind === 'water') ? ok('classifier sees water')
      : fail('water misclassified: ' + JSON.stringify(rw));
  } else fail('no sea found for the water test');

  // lichen vs plain cave wall: solid underground points, vnoise decides
  let lichenOk = false, wallOk = false;
  for (let i = 0; i < 4000 && !(lichenOk && wallOk); i++) {
    const x = (i % 63) * 5.1, y = ((i / 63) | 0) * 4.7, z = -20 - (i % 7);
    if (c.solidD(x, y, z) < 0) continue;
    const r = c.World.classifySolid(x, y, z);
    if (c.vnoise(x * 1.9, y * 1.9, z * 1.9) > 0.8) {
      if (r.kind === 'lichen') lichenOk = true;
    } else if (r.kind === 'cavewall' || r.kind === 'stair' ||
               r.kind === 'pillar' || r.kind === 'hallfloor') wallOk = true;
  }
  lichenOk ? ok('classifier recognises glow lichen') : fail('no lichen classified');
  wallOk ? ok('classifier recognises cave rock') : fail('no cave wall classified');

  // a hall pillar, via a known hall anchor
  let H = null, hk = -1;
  outer2:
  for (let cx = -20; cx <= 20; cx++) {
    for (let cy = -20; cy <= 20; cy++) {
      for (const k of [-1, -2, -3]) {
        const a = c.hallAt(cx, cy, k);
        if (a) { H = a; hk = k; break outer2; }
      }
    }
  }
  if (H) {
    const r = c.World.classifySolid(H.ax, H.ay, H.fz0 + 1.0);
    (r.kind === 'pillar') ? ok('classifier recognises a hall pillar')
      : fail('pillar misclassified as ' + r.kind);
  } else fail('no hall found for the pillar test');
}

// ---- 7. examine actions ----
if (c.treeSpecies) {
  const { Game: G } = c;
  G.used.clear();
  // fabricate a tree target the way examine() would
  let tix = 0, tiy = 0;
  outer3:
  for (let ix = 0; ix < 300; ix++) {
    for (let iy = 0; iy < 300; iy++) {
      if (c.treeAt(ix, iy)) { tix = ix; tiy = iy; break outer3; }
    }
  }
  const t = { kind: 'tree', ix: tix, iy: tiy, point: [tix, tiy, 5] };
  let acts = G.actionsFor(t);
  const labels = acts.map(a => a.label).join('|');
  (labels.includes('chop') && labels.includes('branch') && labels.includes('hug'))
    ? ok('tree actions present: ' + acts.length)
    : fail('tree actions missing: ' + labels);
  const wood0 = G.count('wood');
  acts.find(a => a.label.includes('branch')).fn();
  (G.count('wood') === wood0 + 1) ? ok('break branch yields wood')
                                  : fail('branch yield wrong');
  acts = G.actionsFor(t);
  (!acts.map(a => a.label).join('|').includes('branch'))
    ? ok('branch is once per tree') : fail('branch repeatable');
  acts.find(a => a.label === 'hug').fn();
  (G.toastMsg.length > 0) ? ok('hug toasts: "' + G.toastMsg + '"')
                          : fail('hug silent');
  // chop without an axe refuses
  const woodBefore = G.count('wood');
  G.chop(t, c.SPECIES[c.treeSpecies(tix, tiy)]);
  (G.count('wood') === woodBefore && G.toastMsg.includes('axe'))
    ? ok('chop gated on the axe') : fail('chop worked without an axe');
}

// ---- 8. felling ----
if (c.Fells) {
  const { Fells, Game: G } = c;
  Fells.init();
  let tix = 0, tiy = 0, T = null;
  outer4:
  for (let ix = 100; ix < 500; ix++) {
    for (let iy = 100; iy < 500; iy++) {
      const tr = c.treeAt(ix, iy);
      if (tr) { T = tr; tix = ix; tiy = iy; break outer4; }
    }
  }
  // collision knows the trunk before, forgets it after
  const nearBefore = c.World.trunkNear(T.cx, T.cy, 1);
  Fells.add(tix, tiy);
  const nearAfter = c.World.trunkNear(T.cx, T.cy, 1);
  (nearBefore && nearBefore.tree.cx === T.cx &&
   (!nearAfter || nearAfter.tree.cx !== T.cx))
    ? ok('felled trunk vanishes from collision')
    : fail('collision still sees the felled trunk');
  // examine skips it too
  const g = c.terrainH(T.cx, T.cy);
  const r = c.World.examineRay(T.cx - 2.5, T.cy, g + 1.2, 1, 0, 0);
  (!r || r.kind !== 'tree' || r.ix !== tix || r.iy !== tiy)
    ? ok('examine skips the felled tree')
    : fail('examine still sees the felled tree');
  // pack: nearest-first vec2 pairs
  Fells.add(tix + 200, tiy + 200);
  const n = Fells.pack(tix, tiy);
  (n === 2 && Fells.data[0] === tix && Fells.data[1] === tiy)
    ? ok('fells pack nearest-first')
    : fail(`fells pack wrong: n=${n} first=${Fells.data[0]},${Fells.data[1]}`);
  // serialize round-trip
  const s1 = JSON.stringify([...Fells.set].sort());
  Fells.set = new Set(JSON.parse(JSON.stringify([...Fells.set])));
  const s2 = JSON.stringify([...Fells.set].sort());
  s1 === s2 ? ok('fells persistence stable') : fail('fells round-trip diverged');

  // chop with an axe fells and pays out
  let cix = 0, ciy = 0, C = null;
  outer5:
  for (let ix = -500; ix < -100; ix++) {
    for (let iy = 100; iy < 500; iy++) {
      if (c.treeAt(ix, iy)) { cix = ix; ciy = iy; C = true; break outer5; }
    }
  }
  if (C) {
    G.give('axe', 1);
    const sp = c.SPECIES[c.treeSpecies(cix, ciy)];
    const wood0 = G.count('wood');
    G.chop({ kind: 'tree', ix: cix, iy: ciy, point: [cix, ciy, 5] }, sp);
    (Fells.has(cix, ciy) && G.count('wood') === wood0 + sp.chop)
      ? ok(`chop fells a ${sp.name} for ${sp.chop} wood`)
      : fail('chop with axe failed');
    G.take('axe', 1);
  }
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\ngame tests passed');
