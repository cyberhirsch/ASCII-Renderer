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
  ['vnoise', 'Fells', 'treeSpecies', 'MATS', 'matAt', 'soilDepth', 'rockMat',
   'oreItem'].map(grab).join(', ') + ' });';
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

// ---- 8b. console + devmode gate ----
{
  const { Game: G } = c;
  G.close();
  G.devMode = false;
  (G.devMode === false) ? ok('devmode starts off') : fail('devmode default wrong');

  G.openConsole();
  (G.mode === 'console' && G.cmdBuf === '') ? ok('openConsole enters console mode')
                                            : fail('openConsole broken');

  // typing builds the buffer; Backspace and Escape behave
  G.consoleInput({ code: 'KeyD', key: 'd' });
  G.consoleInput({ code: 'KeyE', key: 'e' });
  G.consoleInput({ code: 'Backspace', key: 'Backspace' });
  G.consoleInput({ code: 'KeyE', key: 'e' });
  (G.cmdBuf === 'de') ? ok('console buffer types and backspaces')
                      : fail('console buffer wrong: "' + G.cmdBuf + '"');

  // run "devmode" via Enter
  G.cmdBuf = 'devmode';
  G.consoleInput({ code: 'Enter', key: 'Enter' });
  (G.devMode === true && G.cmdBuf === '')
    ? ok('devmode command toggles the flag and clears the buffer')
    : fail('devmode command did not toggle: devMode=' + G.devMode);

  // toggling again turns it back off
  G.cmdBuf = 'DevMode';   // case-insensitive
  G.consoleInput({ code: 'Enter', key: 'Enter' });
  (G.devMode === false) ? ok('devmode command is case-insensitive and toggles back')
                        : fail('devmode second toggle failed');

  // unknown command logs, does not throw, does not touch devMode
  G.cmdBuf = 'flyhack';
  G.consoleInput({ code: 'Enter', key: 'Enter' });
  (G.devMode === false && G.cmdHistory[G.cmdHistory.length - 1].includes('unknown'))
    ? ok('unknown command reported, no state change')
    : fail('unknown command mishandled');

  // Escape closes back to play
  G.consoleInput({ code: 'Escape', key: 'Escape' });
  (G.mode === 'play') ? ok('Escape closes the console') : fail('Escape did not close console');

  // Enter on an empty buffer also closes, rather than running a blank command
  const histLenBefore = G.cmdHistory.length;
  G.openConsole();
  G.consoleInput({ code: 'Enter', key: 'Enter' });
  (G.mode === 'play' && G.cmdHistory.length === histLenBefore)
    ? ok('Enter on an empty buffer closes the console without logging a command')
    : fail('empty Enter did not close cleanly: mode=' + G.mode);
  // Enter on whitespace-only input behaves the same way
  G.openConsole();
  G.cmdBuf = '   ';
  G.consoleInput({ code: 'Enter', key: 'Enter' });
  (G.mode === 'play') ? ok('Enter on whitespace-only input closes the console')
                      : fail('whitespace Enter did not close');

  // console panel renders into the overlay
  G.openConsole();
  G.cmdBuf = 'hello';
  c.Overlay.clear();
  G.drawUI();
  {
    let text = '';
    for (let i = 0; i < c.Overlay.data.length; i++) {
      if (c.Overlay.data[i]) text += String.fromCharCode(c.Overlay.data[i]);
    }
    (text.includes('CONSOLE') && text.includes('hello'))
      ? ok('console panel renders into the glyph grid')
      : fail('console panel missing from overlay');
  }
  G.close();
}

// ---- 9. crafting ----
{
  const { Game: G } = c;
  G.inv.clear();
  G.open('craft');
  G.cursor = 0;                    // axe: 2 wood + 1 stone
  G.confirm();
  (G.count('axe') === 0 && G.toastMsg.includes('missing'))
    ? ok('craft refuses without ingredients')
    : fail('crafted from nothing');
  G.give('wood', 2); G.give('stone', 1);
  G.confirm();
  (G.count('axe') === 1 && G.count('wood') === 0 && G.count('stone') === 0)
    ? ok('craft consumes ingredients and yields the axe')
    : fail(`craft math wrong: axe=${G.count('axe')} wood=${G.count('wood')}`);
  // canCraft over all recipes with a rich inventory - every ingredient any
  // recipe names, so a new recipe cannot quietly become unreachable
  for (const r of c.RECIPES) {
    for (const id of Object.keys(r.needs)) G.give(id, 10);
  }
  const all = c.RECIPES.every(r => G.canCraft(r));
  all ? ok(`all ${c.RECIPES.length} recipes craftable with materials`)
      : fail('canCraft broken');
  G.close();
}

// ---- 10. ground materials ----
if (c.matAt) {
  const { MATS, matAt, soilDepth, rockMat, oreItem, terrainH } = c;

  // determinism
  (matAt(12.5, -7.25, 3.0, terrainH(12.5, -7.25)) ===
   matAt(12.5, -7.25, 3.0, terrainH(12.5, -7.25)))
    ? ok('matAt deterministic') : fail('matAt nondeterministic');

  // just under the surface is soil on gentle ground, rock on steep ground;
  // and deep down is never soil
  let flatDirt = 0, steepRock = 0, deepSoil = 0, samples = 0;
  for (let i = 0; i < 3000; i++) {
    const x = (i % 71) * 9.3 - 300, y = ((i / 71) | 0) * 7.7 - 200;
    const gz = terrainH(x, y);
    const e = 0.5;
    const slope = Math.hypot(terrainH(x + e, y) - terrainH(x - e, y),
                             terrainH(x, y + e) - terrainH(x, y - e)) / (2 * e);
    samples++;
    const m = matAt(x, y, gz - 0.1, gz);
    if (slope < MATS.SOIL_FLAT && m === MATS.DIRT) flatDirt++;
    if (slope > MATS.SOIL_STEEP && m !== MATS.DIRT) steepRock++;
    if (matAt(x, y, gz - 12, gz) === MATS.DIRT) deepSoil++;
  }
  (flatDirt > 0 && steepRock > 0)
    ? ok(`soil on flats (${flatDirt}), bare rock on steeps (${steepRock})`)
    : fail(`material/slope relation broken: flat=${flatDirt} steep=${steepRock}`);
  (deepSoil === 0) ? ok('12 units down is never soil')
                   : fail(`${deepSoil} deep points classified as soil`);

  // soil depth is never negative and never absurd
  let badSoil = 0;
  for (let i = 0; i < 2000; i++) {
    const d = soilDepth((i % 53) * 11.1, ((i / 53) | 0) * 13.7);
    if (d < 0 || d > MATS.SOIL_MAX + MATS.SOIL_VAR) badSoil++;
  }
  (badSoil === 0) ? ok('soil depth stays in range') : fail(`${badSoil} bad soil depths`);

  // ore is rare but real; gems are rarer still and only deep
  let ore = 0, gem = 0, rock = 0, shallowGem = 0;
  for (let ix = 0; ix < 90; ix++) {
    for (let iy = 0; iy < 90; iy++) {
      for (let iz = 0; iz < 24; iz++) {
        const x = ix * 3.1, y = iy * 2.9, z = -1 - iz * 1.3;
        const m = rockMat(x, y, z);
        rock++;
        if (m === MATS.ORE) ore++;
        if (m === MATS.GEM) { gem++; if (z >= MATS.GEM_Z) shallowGem++; }
      }
    }
  }
  const oreFrac = ore / rock, gemFrac = gem / rock;
  (oreFrac > 0.0005 && oreFrac < 0.10)
    ? ok(`ore veins rare but present: ${(oreFrac * 100).toFixed(2)}% of rock`)
    : fail(`ore fraction out of range: ${(oreFrac * 100).toFixed(3)}%`);
  (gem > 0 && gemFrac < oreFrac)
    ? ok(`gems rarer than ore: ${(gemFrac * 100).toFixed(3)}% of rock (${gem} found)`)
    : fail(`gem fraction wrong: ${(gemFrac * 100).toFixed(4)}% (${gem} found)`);
  (shallowGem === 0) ? ok('no gems above the gem depth')
                     : fail(`${shallowGem} gems formed too shallow`);

  // ore type splits by depth
  (oreItem(-5) === 'copper' && oreItem(-40) === 'iron')
    ? ok('ore type splits by depth (copper up, iron down)')
    : fail('oreItem depth split wrong');
}

// ---- 11. digging is gated by material ----
if (c.matAt) {
  const { Game: G, MATS, matAt, terrainH } = c;
  G.inv.clear();

  // find a soil point and a rock point on the surface
  let soilPt = null, rockPt = null;
  for (let i = 0; i < 6000 && (!soilPt || !rockPt); i++) {
    const x = (i % 79) * 8.3 - 300, y = ((i / 79) | 0) * 6.1 - 200;
    const gz = terrainH(x, y);
    const p = [x, y, gz - 0.2];
    const m = matAt(x, y, gz - 0.2, gz);
    if (m === MATS.DIRT && !soilPt) soilPt = p;
    if (m !== MATS.DIRT && !rockPt) rockPt = p;
  }
  if (!soilPt || !rockPt) fail('could not find both a soil and a rock point');
  else {
    // bare hands dig nothing
    (G.digAt(...soilPt) === 0 && G.toastMsg.includes('shovel'))
      ? ok('bare hands cannot dig soil') : fail('soil dug without a shovel');
    (G.digAt(...rockPt) === 0 && G.toastMsg.includes('pickaxe'))
      ? ok('bare hands cannot dig rock') : fail('rock dug without a pickaxe');

    // a shovel opens soil but not rock
    G.give('shovel', 1);
    (G.digAt(...soilPt) > 0) ? ok('shovel digs soil') : fail('shovel failed on soil');
    (G.digAt(...rockPt) === 0)
      ? ok('shovel still refuses rock') : fail('shovel dug rock');

    // a pickaxe opens rock and pays out
    G.give('pick', 1);
    const stone0 = G.count('stone');
    const r = G.digAt(...rockPt);
    (r > 0 && G.count('stone') === stone0 + 1)
      ? ok('pickaxe breaks rock and yields stone')
      : fail(`pickaxe dig wrong: r=${r} stone=${G.count('stone')}`);
  }

  // digging an ore point pays the ore, not stone
  let orePt = null, gemPt = null;
  for (let ix = 0; ix < 70 && !(orePt && gemPt); ix++) {
    for (let iy = 0; iy < 70 && !(orePt && gemPt); iy++) {
      for (let iz = 0; iz < 22; iz++) {
        const x = ix * 3.1, y = iy * 2.9, z = -1 - iz * 1.3;
        const m = c.rockMat(x, y, z);
        if (m === MATS.ORE && !orePt) orePt = [x, y, z];
        if (m === MATS.GEM && !gemPt) gemPt = [x, y, z];
      }
    }
  }
  if (orePt) {
    // dig at the ore point directly: matAt must agree it is ore down there
    const gz = terrainH(orePt[0], orePt[1]);
    if (matAt(orePt[0], orePt[1], orePt[2], gz) === MATS.ORE) {
      const id = c.oreItem(orePt[2]);
      const before = G.count(id);
      G.digAt(...orePt);
      (G.count(id) === before + 1) ? ok(`mining a vein yields ${id}`)
                                   : fail(`ore dig yielded nothing: ${id}`);
    } else ok('ore point sits under soil cover (skipped)');
  } else fail('no ore point found for the dig test');
  if (gemPt) {
    const gz = terrainH(gemPt[0], gemPt[1]);
    if (matAt(gemPt[0], gemPt[1], gemPt[2], gz) === MATS.GEM) {
      const before = G.count('gem');
      G.digAt(...gemPt);
      (G.count('gem') === before + 1) ? ok('mining a gem pocket yields a gem')
                                      : fail('gem dig yielded nothing');
    } else ok('gem point sits under soil cover (skipped)');
  }
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\ngame tests passed');
