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
const src = ['config', 'quality', 'util', 'world', 'sky', 'overlay', 'edits',
             'removed', 'chronicle', 'assets', 'steading', 'entities',
             'lore', 'npc', 'quest', 'tales', 'relic', 'items', 'game', 'player']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, CAVES, World, Overlay, Edits, Game, ITEMS, RECIPES, SPECIES, ' +
  'terrainH, solidD, treeAt, hallAt, caveFloor, ' +
  ['vnoise', 'Removed', 'treeSpecies', 'MATS', 'matAt', 'soilDepth', 'rockMat',
   'oreItem', 'Sky', 'PROPS', 'stoneAt', 'rockAt', 'Lore', 'hallIdAt',
   'Quality', 'saveKey', 'tinCountry', 'Chronicle', 'hallAt', 'Player',
   'Steading', 'Entities', 'NPC', 'Quest', 'Tales', 'Relic']
    .map(grab).join(', ') + ' });';
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
if (c.Removed) {
  const { Removed, Game: G } = c;
  Removed.init();
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
  Removed.add(tix, tiy);
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
  Removed.add(tix + 200, tiy + 200);
  const n = Removed.pack(tix, tiy);
  (n === 2 && Removed.data[0] === tix && Removed.data[1] === tiy)
    ? ok('removed pack nearest-first')
    : fail(`removed pack wrong: n=${n} first=${Removed.data[0]},${Removed.data[1]}`);
  // serialize round-trip
  const s1 = JSON.stringify([...Removed.set].sort());
  Removed.set = new Set(JSON.parse(JSON.stringify([...Removed.set])));
  const s2 = JSON.stringify([...Removed.set].sort());
  s1 === s2 ? ok('removed persistence stable') : fail('removed round-trip diverged');

  // chop with an axe removed and pays out
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
    (Removed.has(cix, ciy) && G.count('wood') === wood0 + sp.chop)
      ? ok(`chop removed a ${sp.name} for ${sp.chop} wood`)
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

  // a recipe that yields more than one gives more than one
  {
    const multi = c.RECIPES.filter(r => r.n > 1);
    (multi.length > 0) ? ok(`${multi.length} recipe(s) yield more than one`)
                       : fail('no multi-yield recipe to check');
    for (const r of multi) {
      G.inv.clear();
      for (const [id, cnt] of Object.entries(r.needs)) G.give(id, cnt);
      G.cursor = c.RECIPES.indexOf(r);
      G.confirm();
      (G.count(r.out) === r.n)
        ? ok(`${r.out} smelts ${r.n} at a time and spends the lot`)
        : fail(`${r.out} yielded ${G.count(r.out)}, wanted ${r.n}`);
      const leftover = Object.keys(r.needs).some(id => G.count(id) !== 0);
      (!leftover) ? ok(`${r.out} consumed every ingredient`)
                  : fail(`${r.out} left ingredients behind`);
    }
  }
  G.close();
}

// ---- 9b. overlay clear air around text ----
{
  const O = c.Overlay;
  const B = O.BLANK;
  O.clear();
  O.write(10, 5, 'STAIR WELL');
  const row = 5 * O.cols;
  const at = x => O.data[row + x];
  // text spans 10..19, so the clear air sits at 9 and 20
  (at(9) === B && at(10) === 'S'.charCodeAt(0) && at(19) === 'L'.charCodeAt(0)
   && at(20) === B)
    ? ok('clear air on both sides of an insert')
    : fail(`end blanks wrong: ${at(9)},${at(10)},${at(19)},${at(20)}`);
  // the space between the two words is cleared, not left showing the field
  (at(15) === B)
    ? ok('spaces between words are cleared')
    : fail(`inner space not cleared: ${at(15)}`);
  // everything beyond the insert is untouched, so the scene shows there
  (at(8) === 0 && at(21) === 0)
    ? ok('cells beyond the insert stay transparent')
    : fail(`overlay bled past the insert: ${at(8)},${at(21)}`);
  // a character outside the ASCII atlas clears rather than drawing garbage
  O.clear();
  O.write(3, 7, 'a·b');
  (O.data[7 * O.cols + 4] === B)
    ? ok('non-ASCII clears instead of drawing')
    : fail('non-ASCII not cleared');
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

  // Ore type: depth decides iron, and above that the ground decides between
  // copper and tin. Bronze needs both, so the map has to actually contain
  // both - a world that is all tin country or none of it cannot be alloyed
  // in, and that would be a dead end nobody could see coming.
  {
    const { tinCountry } = c;
    let cu = null, sn = null;
    for (let d = 0; d < 6000 && (cu === null || sn === null); d += 23) {
      if (cu === null && !tinCountry(d, -d)) cu = d;
      if (sn === null && tinCountry(d, -d)) sn = d;
    }
    (cu !== null && sn !== null)
      ? ok(`the map holds both metals: copper ground at ${cu}, tin country at ${sn}`)
      : fail('no tin country found, or no copper ground');
    (oreItem(cu, -cu, -40) === 'iron' && oreItem(sn, -sn, -40) === 'iron')
      ? ok('deep ore is iron wherever you stand')
      : fail('deep ore is not iron everywhere');
    (oreItem(cu, -cu, -5) === 'copper' && oreItem(sn, -sn, -5) === 'tin')
      ? ok('shallow ore follows the country: copper outside it, tin within')
      : fail('the tin province is not respected');

    // How much of the world is tin country. Too little and bronze is a
    // lottery; too much and the journey the alloy is supposed to cost
    // stops being a journey at all.
    let inTin = 0, total = 0;
    for (let x = -3000; x <= 3000; x += 60)
      for (let y = -3000; y <= 3000; y += 60) { total++; if (tinCountry(x, y)) inTin++; }
    const frac = inTin / total;
    (frac > 0.03 && frac < 0.40)
      ? ok(`tin country covers ${(frac * 100).toFixed(1)}% of the map`)
      : fail(`tin country covers ${(frac * 100).toFixed(1)}% - bronze is a lottery or a gift`);

    // and it has to be somewhere, not everywhere: a walk, not a shimmer
    let runs = 0, was = tinCountry(-3000, 0);
    for (let x = -3000; x <= 3000; x += 20) {
      const now = tinCountry(x, 0);
      if (now !== was) runs++;
      was = now;
    }
    (runs > 0 && runs < 40)
      ? ok(`tin country is regions, not speckle (${runs} crossings over 6000 u)`)
      : fail(`tin province granularity wrong: ${runs} crossings`);
  }
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
      const id = c.oreItem(...orePt);
      const before = G.count(id);
      G.digAt(...orePt);
      (G.count(id) === before + 1) ? ok(`mining a vein yields ${id}`)
                                   : fail(`ore dig yielded nothing: ${id}`);
    } else ok('ore point sits under soil cover (skipped)');
  } else fail('no ore point found for the dig test');

  // ---- the pick ladder: a point only bites what it is harder than ----
  {
    // an iron vein and a gem pocket, deep enough that both are real
    let ironPt = null;
    for (let ix = 0; ix < 70 && !ironPt; ix++)
      for (let iy = 0; iy < 70 && !ironPt; iy++)
        for (let iz = 0; iz < 22; iz++) {
          const x = ix * 3.1, y = iy * 2.9, z = -15 - iz * 1.3;
          if (c.rockMat(x, y, z) === MATS.ORE &&
              matAt(x, y, z, terrainH(x, y)) === MATS.ORE) { ironPt = [x, y, z]; break; }
        }
    (ironPt && c.oreItem(...ironPt) === 'iron')
      ? ok('found an iron vein to test the ladder on')
      : fail('no iron vein found');

    if (ironPt && gemPt && matAt(gemPt[0], gemPt[1], gemPt[2], terrainH(gemPt[0], gemPt[1])) === MATS.GEM) {
      G.inv.clear();
      G.give('pick', 1);
      (G.pickTier() === 1) ? ok('a stone pick is the first rung') : fail('pickTier wrong');
      (G.digAt(...ironPt) === 0 && G.toastMsg.includes('bronze'))
        ? ok('a stone pick turns on iron, and says so')
        : fail(`stone pick cut iron: "${G.toastMsg}"`);
      (G.digAt(...gemPt) === 0 && G.toastMsg.includes('iron'))
        ? ok('a stone pick turns on a gem pocket, and says so')
        : fail(`stone pick cut a gem: "${G.toastMsg}"`);

      G.give('bronzepick', 1);
      (G.pickTier() === 2) ? ok('bronze is the second rung') : fail('bronze tier wrong');
      const fe = G.count('iron');
      (G.digAt(...ironPt) > 0 && G.count('iron') === fe + 1)
        ? ok('a bronze pick frees iron') : fail('bronze pick failed on iron');
      (G.digAt(...gemPt) === 0)
        ? ok('but bronze still turns on a gem pocket') : fail('bronze pick cut a gem');

      G.give('ironpick', 1);
      (G.pickTier() === 3) ? ok('iron is the top rung') : fail('iron tier wrong');
      const gm = G.count('gem');
      (G.digAt(...gemPt) > 0 && G.count('gem') === gm + 1)
        ? ok('an iron pick frees a gem') : fail('iron pick failed on a gem');

      // the ladder has to actually be climbable from nothing but the ground
      const chain = ['bronze', 'bronzepick', 'ironpick'];
      const byOut = {};
      for (const r of c.RECIPES) byOut[r.out] = r;
      const reachable = chain.every(id => byOut[id] &&
        Object.keys(byOut[id].needs).every(n =>
          ['wood', 'stone', 'copper', 'tin', 'iron', 'gem', 'lichen'].includes(n) ||
          byOut[n] !== undefined));
      reachable ? ok('every rung is craftable from what the ground gives')
                : fail('a rung of the ladder needs something unobtainable');
    } else ok('no gem/iron pair available at this seed (skipped)');
  }
  if (gemPt) {
    const gz = terrainH(gemPt[0], gemPt[1]);
    if (matAt(gemPt[0], gemPt[1], gemPt[2], gz) === MATS.GEM) {
      G.give('ironpick', 1);   // gem pockets are the top rung; say so here
      const before = G.count('gem');
      G.digAt(...gemPt);
      (G.count('gem') === before + 1) ? ok('mining a gem pocket yields a gem')
                                      : fail('gem dig yielded nothing');
    } else ok('gem point sits under soil cover (skipped)');
  }
}

// ---- 12. day/night cycle ----
if (c.Sky) {
  const { Sky } = c;

  // the sun crosses the horizon twice and peaks at noon
  Sky.setHour(12);
  const noonH = Sky.sunHeight();
  Sky.setHour(0);
  const midH = Sky.sunHeight();
  (noonH > 0.9 && midH < -0.9)
    ? ok(`sun high at noon (${noonH.toFixed(2)}), below at midnight (${midH.toFixed(2)})`)
    : fail(`sun arc wrong: noon=${noonH.toFixed(2)} midnight=${midH.toFixed(2)}`);
  Sky.setHour(6);
  (Math.abs(Sky.sunHeight()) < 0.05)
    ? ok('sun sits on the horizon at 06:00') : fail('sunrise not at 06:00');

  // night factor: 0 by day, 1 at midnight, monotone across the evening
  Sky.setHour(12);
  const dayN = Sky.night();
  Sky.setHour(0);
  const nightN = Sky.night();
  (dayN < 0.01 && nightN > 0.99)
    ? ok('night factor spans 0 by day to 1 at midnight')
    : fail(`night factor wrong: day=${dayN} night=${nightN}`);

  // the moon is up when the sun is down
  Sky.setHour(0);
  const sd = Sky.sunDir(), md = Sky.moonDir();
  (sd[2] < 0 && md[2] > 0)
    ? ok('moon is up at midnight while the sun is down')
    : fail(`moon/sun elevation wrong: sun.z=${sd[2].toFixed(2)} moon.z=${md[2].toFixed(2)}`);
  Sky.setHour(12);
  (Sky.sunDir()[2] > 0 && Sky.moonDir()[2] < 0)
    ? ok('moon is down at noon') : fail('moon up at noon');

  // directions stay unit length all the way round
  let worstLen = 0, badCol = 0;
  for (let i = 0; i <= 96; i++) {
    Sky.t = i / 96;
    for (const d of [Sky.sunDir(), Sky.moonDir()]) {
      worstLen = Math.max(worstLen, Math.abs(Math.hypot(...d) - 1));
    }
    const s = Sky.state();
    for (const v of [...s.sunCol, ...s.ambCol, ...s.skyLo, ...s.skyHi,
                     s.sunI, s.ambI, s.night]) {
      if (!isFinite(v) || v < 0 || v > 4) badCol++;
    }
  }
  (worstLen < 1e-9) ? ok('sun and moon directions stay unit length')
                    : fail(`direction length drifts by ${worstLen}`);
  (badCol === 0) ? ok('every colour stays finite and in range across the cycle')
                 : fail(`${badCol} bad colour components over the cycle`);

  // the golden hour: the light warms long before the sun is down
  Sky.setHour(18);                    // sun exactly on the horizon
  (Sky.warmth() > 0.95 && Sky.dusk() > 0.95)
    ? ok('the light is fully warm as the sun touches the horizon')
    : fail(`not warm at sunset: warmth ${Sky.warmth().toFixed(2)}`);
  // the golden hour should be a stretch of the afternoon, not a moment
  let warmFrom = null, redFrom = null;
  for (let hh = 12; hh <= 18; hh += 0.02) {
    Sky.setHour(hh);
    if (warmFrom === null && Sky.warmth() > 0.05) warmFrom = hh;
    if (redFrom === null && Sky.dusk() > 0.05) redFrom = hh;
  }
  (warmFrom !== null && warmFrom < 16.5 && warmFrom > 13)
    ? ok(`the light starts warming at ${warmFrom.toFixed(1)}h - ${(18 - warmFrom).toFixed(1)}h of golden hour`)
    : fail(`golden hour is the wrong length: starts ${warmFrom}`);
  // the sky reddens later than the light warms: two separate curves
  (redFrom > warmFrom)
    ? ok(`the sky only reddens at ${redFrom.toFixed(1)}h, after the light has warmed`)
    : fail(`sky red leads the light warmth: ${redFrom} vs ${warmFrom}`);
  Sky.setHour(12);
  (Sky.warmth() < 0.02) ? ok('noon light is not warm at all')
                        : fail(`noon is tinted: ${Sky.warmth().toFixed(2)}`);
  // warmth rises monotonically through the afternoon - no flicker back
  let dips = 0, prev = -1;
  for (let hh = 12; hh <= 18; hh += 0.1) {
    Sky.setHour(hh);
    if (Sky.warmth() < prev - 1e-9) dips++;
    prev = Sky.warmth();
  }
  (dips === 0) ? ok('the light warms steadily all afternoon, never back')
               : fail(`warmth is not monotonic: ${dips} reversals`);
  // and it is gone once the sun is properly under, so moonlight stays blue
  Sky.setHour(20);
  (Sky.warmth() < 0.02)
    ? ok('the warmth is gone by full dark, so moonlight stays blue')
    : fail(`night light still warm: ${Sky.warmth().toFixed(2)}`);

  // stars still wait for the sun to be under
  Sky.setHour(18);
  const setStars = Sky.starAmt();
  (setStars < 0.02)
    ? ok('no stars are out while the sun is on the horizon')
    : fail(`stars too early at sunset: ${setStars.toFixed(2)}`);
  Sky.setHour(0);
  (Sky.starAmt() > 0.99) ? ok('the whole field is out at midnight')
                         : fail(`stars never fill in: ${Sky.starAmt()}`);
  // and they trail night() the whole way down, never lead it
  let leads = 0, firstStarH = null;
  for (let i = 0; i <= 200; i++) {
    Sky.t = 0.70 + (i / 200) * 0.3;   // dusk through to midnight
    if (Sky.starAmt() > Sky.night() + 1e-9) leads++;
    if (firstStarH === null && Sky.starAmt() > 0.02) firstStarH = Sky.sunHeight();
  }
  (leads === 0) ? ok('stars never come out ahead of nightfall')
                : fail(`stars lead night at ${leads} points`);
  (firstStarH !== null && firstStarH < -0.03)
    ? ok(`first star waits until the sun is under (sin el ${firstStarH.toFixed(3)})`)
    : fail(`first star too early: ${firstStarH}`);

  // The key light must always be ABOVE the horizon, or it lights nothing and
  // the scene collapses onto the bottom of the glyph ramp. This is the bug
  // that painted shaded ground pure black at night.
  let lowKey = 0, worstKey = 1;
  for (let i = 0; i <= 200; i++) {
    Sky.t = i / 200;
    const kz = Sky.keyDir()[2];
    if (kz < -0.02) lowKey++;
    worstKey = Math.min(worstKey, kz);
  }
  (lowKey === 0)
    ? ok(`the key light stays above the horizon all cycle (lowest ${worstKey.toFixed(2)})`)
    : fail(`key light drops below the horizon at ${lowKey} points`);
  // by day it is the sun; by night it is the moon
  Sky.setHour(12);
  (Math.abs(Sky.keyDir()[2] - Sky.sunDir()[2]) < 1e-9)
    ? ok('the sun is the key light by day') : fail('day key is not the sun');
  Sky.setHour(0);
  (Math.abs(Sky.keyDir()[2] - Sky.moonDir()[2]) < 1e-9)
    ? ok('the moon takes over as key light at night')
    : fail('night key is not the moon');

  // the sky turns once a day, in the same sense the sun travels
  Sky.t = 0;
  const a0 = Sky.skyAngle();
  Sky.t = 1;
  (Math.abs(Sky.skyAngle() - a0 - Math.PI * 2) < 1e-9)
    ? ok('the celestial sphere turns exactly once a day')
    : fail('sky rotation is not one turn per day');

  // night never crushes the scene: the key light keeps the glyph ramp alive
  let dimmest = Infinity;
  for (let i = 0; i <= 96; i++) {
    Sky.t = i / 96;
    const s = Sky.state();
    dimmest = Math.min(dimmest, s.sunI + s.ambI);
  }
  (dimmest > 0.8)
    ? ok(`darkest moment still lights the ramp (key+fill ${dimmest.toFixed(2)})`)
    : fail(`night goes too dark for the glyph ramp: ${dimmest.toFixed(2)}`);

  // time advances and wraps
  Sky.t = 0.99; Sky.paused = false;
  Sky.update(c.CFG.DAY_LEN * 0.02);
  (Sky.t >= 0 && Sky.t < 1) ? ok('time wraps at the end of the day')
                            : fail(`time did not wrap: ${Sky.t}`);
  Sky.paused = true;
  const frozen = Sky.t;
  Sky.update(100);
  (Sky.t === frozen) ? ok('freeze holds the clock') : fail('freeze did not hold');
  Sky.paused = false;

  // the console drives all of it
  const { Game: G } = c;
  G.openConsole();
  G.cmdBuf = 'time 3';
  G.consoleInput({ code: 'Enter', key: 'Enter' });
  (Math.abs(Sky.hour() - 3) < 0.01) ? ok('console "time 3" jumps to 03:00')
                                    : fail(`time command wrong: ${Sky.hour()}`);
  G.cmdBuf = 'freeze';
  G.consoleInput({ code: 'Enter', key: 'Enter' });
  (Sky.paused === true) ? ok('console "freeze" stops the clock')
                        : fail('freeze command failed');
  Sky.paused = false;
  G.close();
}

// ---- 13. loose stones and boulders ----
if (c.stoneAt) {
  const { stoneAt, rockAt, PROPS, World, Removed, Game: G } = c;

  // determinism and density
  const a1 = stoneAt(31, -17), a2 = stoneAt(31, -17);
  (JSON.stringify(a1) === JSON.stringify(a2))
    ? ok('stone placement deterministic') : fail('stoneAt nondeterministic');

  let st = 0, rk = 0, both = 0, cells = 0;
  for (let ix = -220; ix < 220; ix++) {
    for (let iy = -220; iy < 220; iy++) {
      cells++;
      const s = stoneAt(ix, iy), r = rockAt(ix, iy);
      if (s) st++;
      if (r) rk++;
      if (r && c.treeAt(ix, iy)) both++;
    }
  }
  const sd = st / cells, rd = rk / cells;
  (sd > 0.02 && sd < 0.12)
    ? ok(`stones scattered at ${(sd * 100).toFixed(1)}% of cells`)
    : fail(`stone density out of range: ${(sd * 100).toFixed(2)}%`);
  (rd > 0.002 && rd < 0.03)
    ? ok(`boulders rarer, ${(rd * 100).toFixed(2)}% of cells`)
    : fail(`boulder density out of range: ${(rd * 100).toFixed(3)}%`);
  (both === 0) ? ok('no boulder shares a cell with a tree')
               : fail(`${both} boulders inside trees`);

  // sizes stay in their declared band
  let badR = 0;
  for (let ix = 0; ix < 200; ix++) for (let iy = 0; iy < 200; iy++) {
    const s = stoneAt(ix, iy), r = rockAt(ix, iy);
    if (s && (s.r < PROPS.STONE_R || s.r > PROPS.STONE_R * 2)) badR++;
    if (r && (r.r < PROPS.ROCK_R || r.r > PROPS.ROCK_R * 2)) badR++;
  }
  (badR === 0) ? ok('prop radii stay in range') : fail(`${badR} props out of range`);

  // The prop search window must cover the ray walk's stride. The walk
  // advances four cells at a time to amortise the neighbourhood search, so
  // a window narrower than that leaves cells on the ray never tested - and
  // a stone in one of them is invisible until you move and the gap shifts,
  // which is a prop flickering in and out. Replicated here in 2D.
  {
    const reach = 2;                    // must match U.treeReach in the shader
    let missed = 0, crossed = 0;
    for (let a = 0; a < 200; a++) {
      const ang = a * 0.0157 + 0.013;   // never exactly axis-aligned
      const rd = [Math.cos(ang), Math.sin(ang)], ro = [0.37, 0.21];
      const onRay = new Set();
      for (let t = 0; t < 40; t += 0.02) {
        onRay.add(Math.floor(ro[0] + rd[0] * t) + ',' + Math.floor(ro[1] + rd[1] * t));
      }
      const tested = new Set();
      let mx = Math.floor(ro[0]), my = Math.floor(ro[1]);
      const dD = [Math.abs(1 / rd[0]), Math.abs(1 / rd[1])];
      const sg = [rd[0] < 0 ? -1 : 1, rd[1] < 0 ? -1 : 1];
      const side = [rd[0] < 0 ? (ro[0] - mx) * dD[0] : (mx + 1 - ro[0]) * dD[0],
                    rd[1] < 0 ? (ro[1] - my) * dD[1] : (my + 1 - ro[1]) * dD[1]];
      for (let i = 0; i < 40; i++) {
        for (let oy = -reach; oy <= reach; oy++) {
          for (let ox = -reach; ox <= reach; ox++) tested.add((mx + ox) + ',' + (my + oy));
        }
        let ended = false;
        for (let k = 0; k < 4; k++) {
          if (Math.min(side[0], side[1]) >= 40) { ended = true; break; }
          if (side[0] < side[1]) { side[0] += dD[0]; mx += sg[0]; }
          else { side[1] += dD[1]; my += sg[1]; }
        }
        if (ended) break;
      }
      for (const cell of onRay) { crossed++; if (!tested.has(cell)) missed++; }
    }
    const gap = 100 * missed / crossed;
    (gap < 0.5)
      ? ok(`the prop window covers the ray walk (${gap.toFixed(1)}% of cells missed)`)
      : fail(`prop window too narrow for the stride: ${gap.toFixed(1)}% of cells never tested`);
  }

  // a boulder blocks the way; clearing it opens the way
  let B = null;
  outer6:
  for (let ix = 0; ix < 400; ix++) {
    for (let iy = 0; iy < 400; iy++) {
      const r = rockAt(ix, iy);
      if (r) { B = { r, ix, iy }; break outer6; }
    }
  }
  if (!B) fail('no boulder found to test collision');
  else {
    Removed.set.clear();
    (World.rockNear(B.r.cx, B.r.cy) !== null)
      ? ok('boulder blocks the way') : fail('boulder does not block');
    (World.rockNear(B.r.cx + B.r.r + 1.5, B.r.cy) === null)
      ? ok('the way is clear beside it') : fail('boulder blocks too wide');
    Removed.add(B.ix, B.iy);
    (World.rockNear(B.r.cx, B.r.cy) === null)
      ? ok('a broken boulder stops blocking') : fail('cleared boulder still blocks');
    Removed.set.clear();
  }

  // examine finds a stone, and picking it up pays out and clears the cell
  let S = null;
  outer7:
  for (let ix = 0; ix < 200; ix++) {
    for (let iy = 0; iy < 200; iy++) {
      const s = stoneAt(ix, iy);
      if (s && !c.treeAt(ix, iy) && !rockAt(ix, iy)) { S = { s, ix, iy }; break outer7; }
    }
  }
  if (!S) fail('no stone found to examine');
  else {
    // stand a step away at eye height and look down at it, as a player does
    // - a level ray this close to the ground just starts inside the hillside
    const ex = S.s.cx - 1.0, ey = S.s.cy;
    const ez = c.terrainH(ex, ey) + c.CFG.EYE;
    const sz = c.terrainH(S.s.cx, S.s.cy) + S.s.r * 0.55;
    let dx = S.s.cx - ex, dy = S.s.cy - ey, dz = sz - ez;
    const L = Math.hypot(dx, dy, dz);
    const t = World.examineRay(ex, ey, ez, dx / L, dy / L, dz / L);
    (t && t.kind === 'stone' && t.ix === S.ix && t.iy === S.iy)
      ? ok(`examine finds the loose stone at ${S.ix},${S.iy}`)
      : fail('examine missed the stone: ' + JSON.stringify(t && t.kind));
    if (t && t.kind === 'stone') {
      G.inv.clear();
      const acts = G.actionsFor(t);
      const pick = acts.find(x => x.label.includes('pick up'));
      pick ? ok('a stone offers to be picked up') : fail('no pick-up action');
      if (pick) {
        pick.fn();
        (G.count('stone') === 1 && Removed.has(S.ix, S.iy))
          ? ok('picking it up pays a stone and clears the cell')
          : fail(`pick up wrong: stone=${G.count('stone')} cleared=${Removed.has(S.ix, S.iy)}`);
      }
      Removed.set.clear();
    }
  }

  // a boulder needs the pickaxe
  if (B) {
    G.inv.clear();
    const bt = { kind: 'boulder', ix: B.ix, iy: B.iy, rock: B.r,
                 point: [B.r.cx, B.r.cy, 0] };
    G.actionsFor(bt)[0].fn();
    (G.count('stone') === 0 && !Removed.has(B.ix, B.iy))
      ? ok('a boulder resists bare hands') : fail('boulder broken without a pickaxe');
    G.give('pick', 1);
    G.actionsFor(bt)[0].fn();
    (G.count('stone') === 3 && Removed.has(B.ix, B.iy))
      ? ok('a pickaxe splits the boulder for 3 stone')
      : fail(`boulder break wrong: stone=${G.count('stone')}`);
    Removed.set.clear();
  }
}

// ---- 14. the record: read off the chronicle, laid out by depth ----
if (c.Lore) {
  const { Lore, Game: G } = c;
  Lore.S = null;
  const S = Lore.init();

  {
    const one = JSON.stringify(Lore.inscription(3, 5, -2));
    Lore.S = null; Lore.init();
    const two = JSON.stringify(Lore.inscription(3, 5, -2));
    (one === two) ? ok('the same wall carries the same words twice')
                  : fail('inscriptions are not deterministic');
  }

  // Halls the chronicle actually reaches. Not every cell holds one and not
  // every hall stands near a settlement, so this walks until it has a sample.
  const found = [];
  for (let cx = -14; cx <= 14 && found.length < 60; cx++)
    for (let cy = -14; cy <= 14 && found.length < 60; cy++)
      for (const k of [-1, -2, -3]) {
        const ins = Lore.inscription(cx, cy, k);
        if (ins) found.push({ cx, cy, k, ins });
      }
  (found.length > 12)
    ? ok(`${found.length} halls carry a record in the settled region`)
    : fail(`only ${found.length} halls have anything cut in them`);

  // THE RULE: a hall belongs to the people whose settlement is nearest it
  {
    let wrong = 0, checked = 0;
    for (const f of found) {
      const a = c.hallAt(f.cx, f.cy, f.k);
      if (!a) continue;
      let best = null, bd = Infinity;
      for (const st of S.sites) {
        const d = (st.x - a.ax) ** 2 + (st.y - a.ay) ** 2;
        if (d < bd) { bd = d; best = st; }
      }
      checked++;
      if (best.people !== f.ins.people) wrong++;
    }
    (checked > 0 && wrong === 0)
      ? ok(`every hall belongs to its nearest settlement's people (${checked} checked)`)
      : fail(`${wrong} of ${checked} halls name the wrong people`);
  }

  {
    let bad = 0, longest = 0;
    for (const f of found) for (const l of f.ins.lines) {
      if (typeof l !== 'string' || l.includes('undefined') || l.includes('null')) bad++;
      if (l.length > longest) longest = l.length;
    }
    (bad === 0) ? ok(`every line is filled in (longest ${longest} chars)`)
                : fail(`${bad} broken inscription lines`);
    (longest <= 52) ? ok('every line fits the panel') : fail(`a line runs to ${longest}`);
  }

  {
    let bad = 0, outside = 0;
    for (const f of found) {
      const p = S.peoples[f.ins.people];
      if (!p) { bad++; continue; }
      const to = p.fell >= 0 ? p.fell : S.now;
      for (const l of f.ins.lines) {
        const m = /In the (\d+)(?:st|nd|rd|th) year/.exec(l);
        if (m && (+m[1] < p.rise || +m[1] > to)) outside++;
      }
    }
    (bad === 0) ? ok('every hall names a people who existed') : fail(`${bad} name nobody`);
    (outside === 0) ? ok('and cuts only years that people lived through')
                    : fail(`${outside} lines date outside their people's life`);
  }

  // depth is time: within one people, deeper is later
  {
    let checked = 0, wrong = 0;
    for (const f of found) {
      if (f.k !== -1) continue;
      const deep = Lore.inscription(f.cx, f.cy, -3);
      if (!deep || deep.people !== f.ins.people) continue;
      const yr = ins => { let hi = -1;
        for (const l of ins.lines) { const m = /In the (\d+)/.exec(l);
          if (m && +m[1] > hi) hi = +m[1]; } return hi; };
      const a = yr(f.ins), b = yr(deep);
      if (a < 0 || b < 0) continue;
      checked++;
      if (b < a) wrong++;
    }
    (checked === 0 || wrong === 0)
      ? ok(`going down goes forward in one people's life (${checked} pairs)`)
      : fail(`${wrong} of ${checked} deep halls predate the shallow ones`);
  }

  {
    const who = new Set(found.map(f => f.ins.people));
    (who.size > 1) ? ok(`the caves are ${who.size} peoples' work, not one`)
                   : fail('every hall belongs to the same people');
  }

  {
    const far = Lore.inscription(400, 400, -1);
    (far === null) ? ok('a hall beyond the record has blank pillars')
                   : fail('the record reaches somewhere it should not');
  }

  const pick = k => found.find(f => f.k === k);
  const one = pick(-1), two = pick(-2), three = pick(-3);
  if (one && two && three) {
    G.read = []; G.done = false; G.used.clear(); G.quests = {};
    // Nothing is asked of you until something in the world asks it, so the
    // top line starts empty rather than handing out a goal.
    (G.objective() === '') ? ok('nothing is asked of you to begin with')
                           : fail('opening objective is not empty: ' + G.objective());
    G.readInscription(one.ins); G.close();
    (!G.done && G.bandsRead().size === 1)
      ? ok('one depth read is not the whole story') : fail('completed too early');
    G.readInscription(two.ins); G.close();
    G.readInscription(three.ins);
    (G.done === true) ? ok('reading all three depths completes the record')
                      : fail('never completed');
    (G.objective().includes('whole')) ? ok('the objective reports it is finished')
                                      : fail('objective wrong at the end');
    {
      // one depth read is a reason for the line to exist
      const keep = G.done; G.done = false;
      (G.objective().includes('depths read'))
        ? ok('and it tracks the depths once there is something to track')
        : fail('objective wrong mid-record: ' + G.objective());
      G.done = keep;
    }
    G.close();
    const before = G.read.length;
    G.readInscription(three.ins); G.close();
    (G.read.length === before) ? ok('re-reading a hall does not count twice')
                               : fail('duplicate record entries');
  } else fail('could not find a hall at each of the three depths');

  c.Overlay.clear();
  G.open('journal');
  G.drawUI();
  {
    let text = '';
    for (let i = 0; i < c.Overlay.data.length; i++)
      if (c.Overlay.data[i] > 32) text += String.fromCharCode(c.Overlay.data[i]);
    text.includes('RECORD') ? ok('the journal renders into the glyph grid')
                            : fail('journal missing from overlay');
  }
  G.close();

  G.inv.clear(); G.give('gem', 2);
  const snap = G.snapshot();
  snap.at = [12.5, -7.25, 1.1, -0.2, 3.4];
  snap.t = 0.42;
  const readCount = G.read.length;
  G.inv.clear(); G.read = []; G.done = false;
  G.restore(JSON.parse(JSON.stringify(snap)));
  (G.count('gem') === 2 && G.read.length === readCount && G.done === true &&
   G.spawnAt[0] === 12.5 && Math.abs(c.Sky.t - 0.42) < 1e-9)
    ? ok('the save round-trips items, record, position and time')
    : fail('save round-trip lost something');

  G.restore({});
  (G.spawnAt === null && G.read.length === 0 && G.done === false)
    ? ok('an empty save starts a new world cleanly')
    : fail('empty save did not reset');
}

// ---- 15. render quality: a ladder that walks down and does not bounce ----
if (c.Quality) {
  const Q = c.Quality;
  Q.auto = true; Q.capped = null; Q.easy = 0; Q.hold = 0;
  Q.name = 'high'; Q.apply();
  (c.CFG.SUN_SAMPLES === 16 && c.CFG.AO_SAMPLES === 32)
    ? ok('quality high is the shipped ray budget')
    : fail(`high applied wrong: ${c.CFG.SUN_SAMPLES}/${c.CFG.AO_SAMPLES}`);

  (!Q.set('ludicrous')) ? ok('an unknown quality name is refused')
                        : fail('accepted a nonsense quality name');
  Q.set('low');
  (!Q.auto && c.CFG.SUN_SAMPLES === 4 && c.CFG.SHADE_FAR > c.CFG.SHADE_NEAR)
    ? ok('quality low fixes the budget and keeps the shading cut hard')
    : fail(`low applied wrong: ${c.CFG.SUN_SAMPLES}, ${c.CFG.SHADE_NEAR}/${c.CFG.SHADE_FAR}`);

  // 50 ms frames, held: the ladder walks all the way down and stops there
  Q.set('auto'); Q.name = 'high'; Q.apply(); Q.hold = 0; Q.easy = 0;
  for (let i = 0; i < 400; i++) Q.tick(0.05);
  (Q.name === 'low') ? ok('sustained slow frames walk the budget down to low')
                     : fail(`auto stalled at ${Q.name}`);

  // 5 ms frames, briefly: it must NOT bounce straight back into the level
  // that just failed, or the session is spent climbing the same rung
  for (let i = 0; i < 400; i++) Q.tick(0.005);
  (Q.name === 'low')
    ? ok('a short good patch does not undo the step down')
    : fail(`auto bounced back to ${Q.name} immediately`);

  // but a long one does: the forest ends, and the plain deserves its rays
  for (let i = 0; i < 20000; i++) Q.tick(0.005);
  (Q.name === 'high')
    ? ok('a sustained good patch earns the rays back')
    : fail(`auto never recovered past ${Q.name}`);
  Q.set('auto'); Q.name = 'high'; Q.apply();
}

// ---- 16. the spent-actions set is bounded ----
{
  const G = c.Game;
  G.used.clear();
  for (let i = 0; i < G.USED_MAX + 200; i++) G.spend('gather:' + i + ',0,0');
  (G.used.size === G.USED_MAX)
    ? ok(`spent actions cap at ${G.USED_MAX} instead of growing forever`)
    : fail(`spent set grew to ${G.used.size}`);
  (!G.used.has('gather:0,0,0') &&
   G.used.has('gather:' + (G.USED_MAX + 199) + ',0,0'))
    ? ok('the oldest spent action is the one that falls off')
    : fail('the cap evicted the wrong end');
  G.restore({ used: Array.from({ length: G.USED_MAX + 50 }, (_, i) => 'k' + i) });
  (G.used.size === G.USED_MAX)
    ? ok('an oversized save is trimmed on the way back in')
    : fail(`restore left ${G.used.size} spent actions`);
  G.used.clear();
}

// ---- 17. cleared cells: debounced, and the pack cache tracks the set ----
if (c.Removed) {
  const R = c.Removed;
  R.set.clear(); R.cells = null; R.needSave = false; R.saveTimer = 0;
  R.add(5, 5);
  R.tick(0.5);
  (R.needSave === true)
    ? ok('a cleared cell is not written on the very next frame')
    : fail('cleared cells still write synchronously');
  R.tick(2.0);
  (R.needSave === false) ? ok('and is written once the debounce expires')
                         : fail('the cleared-cell debounce never fired');

  // the numeric cache is a mirror, not a second authority: the tests and
  // the console both reach into `set` directly, and pack has to notice
  R.add(9, 9);
  R.pack(0, 0);
  R.set.clear();
  R.add(3, 4);
  const n = R.pack(0, 0);
  (n === 1 && R.data[0] === 3 && R.data[1] === 4)
    ? ok('the pack cache rebuilds when the set changes underneath it')
    : fail(`stale pack cache: n=${n} first=${R.data[0]},${R.data[1]}`);
  R.add(3, 4);
  (R.pack(0, 0) === 1) ? ok('clearing the same cell twice still counts once')
                       : fail('a duplicate cleared cell was counted');
  R.set.clear(); R.cells = null;
}

// ---- 18. every world saves under its own key ----
if (c.saveKey) {
  const base = 'ascii-save-v1';
  (c.saveKey(base) === base)
    ? ok('the default seed keeps the original, unsuffixed save key')
    : fail('the default seed renamed its own save: ' + c.saveKey(base));
  const was = c.CFG.SEED;
  c.CFG.SEED = was + 1;
  (c.saveKey(base) === base + ':' + (was + 1))
    ? ok('another seed keeps its digs and its record apart')
    : fail('seed namespacing broken: ' + c.saveKey(base));
  c.CFG.SEED = was;
}

// ---- 19. moving: jumping, falling, wading and swimming ----
// player.js has never been exercised by a test before. It has no DOM in it
// until init() runs, so the physics can be driven straight from here.
if (c.Player) {
  const P = c.Player, G = c.Game, W = c.World;
  P.mouse = {};            // normally made by init(), which needs a canvas
  G.mode = 'play';

  // dry, gentle ground to stand on, and deep water to fall into
  let dry = null, deep = null, shallow = null;
  for (let r = 20; r < 4000 && !(dry && deep && shallow); r += 7) {
    for (let a = 0; a < 6.28 && !(dry && deep && shallow); a += 0.5) {
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const h = c.terrainH(x, y);
      const slope = Math.abs(c.terrainH(x + 1, y) - h) + Math.abs(c.terrainH(x, y + 1) - h);
      if (!dry && h > c.CFG.SEA_LEVEL + 3 && slope < 0.4) dry = [x, y, h];
      // The heightfield never goes below zero, so the sea is at most
      // SEA_LEVEL deep - there is no abyss to look for, only water over
      // your head, which is anything deeper than you can wade.
      if (!deep && h < c.CFG.SEA_LEVEL - c.CFG.WADE - 0.4) deep = [x, y, h];
      if (!shallow && h < c.CFG.SEA_LEVEL - 0.35 && h > c.CFG.SEA_LEVEL - c.CFG.WADE + 0.2) {
        shallow = [x, y, h];
      }
    }
  }
  (dry && deep && shallow)
    ? ok('found dry ground, shallows and deep water to test in')
    : fail(`missing test ground: dry=${!!dry} shallow=${!!shallow} deep=${!!deep}`);

  const stand = p => { P.x = p[0]; P.y = p[1]; P.z = p[2];
                       P.vz = 0; P.onGround = true; P.swimming = false; P.keys = {}; };
  const step = (n, dt) => { for (let i = 0; i < n; i++) P.update(dt); };

  if (dry) {
    // standing still stays still
    stand(dry);
    step(20, 1 / 60);
    (Math.abs(P.z - dry[2]) < 0.05 && P.onGround)
      ? ok('standing on the ground stays on the ground')
      : fail(`drifted while standing: z ${dry[2].toFixed(2)} -> ${P.z.toFixed(2)}`);

    // a jump leaves the ground, peaks, and comes back to it
    stand(dry);
    P.keys = { Space: true };
    P.update(1 / 60);
    P.keys = {};
    (!P.onGround && P.vz > 0) ? ok('space leaves the ground')
                              : fail(`jump did not launch: vz=${P.vz.toFixed(2)}`);
    let peak = P.z;
    for (let i = 0; i < 240; i++) { P.update(1 / 60); if (P.z > peak) peak = P.z; }
    const rise = peak - dry[2];
    (rise > 0.6 && rise < 2.2)
      ? ok(`a jump clears ${rise.toFixed(2)} units`)
      : fail(`jump height wrong: ${rise.toFixed(2)}`);
    (P.onGround && Math.abs(P.z - dry[2]) < 0.06)
      ? ok('and lands back on the ground it left')
      : fail(`did not land: onGround=${P.onGround} z=${P.z.toFixed(2)} floor=${dry[2].toFixed(2)}`);

    // no second jump in mid-air
    stand(dry);
    P.keys = { Space: true };
    step(6, 1 / 60);
    const vzAir = P.vz;
    step(1, 1 / 60);
    (P.vz < vzAir) ? ok('holding space does not jump again in the air')
                   : fail('double jump in mid-air');
    P.keys = {};
  }

  if (deep) {
    // deep water is enterable, and it floats you at the surface
    stand([deep[0], deep[1], c.CFG.SEA_LEVEL]);
    step(90, 1 / 60);
    const ride = c.CFG.SEA_LEVEL + c.CFG.SWIM_EYE - c.CFG.EYE;
    (P.swimming) ? ok('deep water is swum, not walked')
                 : fail('did not start swimming in deep water');
    (Math.abs(P.z - ride) < 0.05)
      ? ok(`floats with the eye ${c.CFG.SWIM_EYE} above the surface`)
      : fail(`floating at ${P.z.toFixed(2)}, wanted ${ride.toFixed(2)}`);
    (P.z + c.CFG.EYE > c.CFG.SEA_LEVEL)
      ? ok('and the eye never goes under, so the water is drawn from above')
      : fail('the camera sank below the water plane');

    // you cannot jump off water
    const z0 = P.z;
    P.keys = { Space: true };
    step(10, 1 / 60);
    P.keys = {};
    (Math.abs(P.z - z0) < 0.05 && P.vz === 0)
      ? ok('there is nothing to jump off in open water')
      : fail(`jumped while swimming: ${z0.toFixed(2)} -> ${P.z.toFixed(2)}`);

    // and the shore is not a wall any more
    stand([deep[0], deep[1], c.CFG.SEA_LEVEL]);
    P.update(1 / 60);
    (!P.blocked(deep[0] + 0.2, deep[1]))
      ? ok('water can be swum through rather than refused')
      : fail('water is still a wall');
  }

  if (shallow) {
    // shallow water is waded: feet on the bed, and slower
    stand([shallow[0], shallow[1], shallow[2]]);
    step(30, 1 / 60);
    (!P.swimming && P.onGround)
      ? ok('shallow water is waded, standing on the bed')
      : fail(`wading wrong: swimming=${P.swimming} onGround=${P.onGround}`);
    (Math.abs(P.z - shallow[2]) < 0.15)
      ? ok('and the bed is what you stand on')
      : fail(`wading z ${P.z.toFixed(2)} vs bed ${shallow[2].toFixed(2)}`);
  }

  // a fall ends on the ground rather than continuing forever
  if (dry) {
    stand(dry);
    P.z = dry[2] + 14;
    P.onGround = false;
    step(400, 1 / 60);
    (P.onGround && Math.abs(P.z - dry[2]) < 0.06)
      ? ok('a long fall lands, once')
      : fail(`fall never landed: z=${P.z.toFixed(2)} onGround=${P.onGround}`);
  }
  G.close();
}

// ---- 20. the devmode minimap ----
if (c.Player) {
  const G = c.Game, O = c.Overlay, P = c.Player;
  const read = () => {
    let t = '';
    for (let i = 0; i < O.data.length; i++) {
      t += (O.data[i] > 32 && O.data[i] < 127) ? String.fromCharCode(O.data[i]) : ' ';
    }
    return t;
  };
  O.resize(120, 40);
  G.close();
  P.x = 200; P.y = -150; P.z = c.terrainH(200, -150);

  // off by default: a dev tool must not be on anybody's screen uninvited
  G.devMode = false;
  O.clear(); G.drawUI();
  (!read().includes('map '))
    ? ok('no minimap without devmode') : fail('the map shows up uninvited');

  G.devMode = true;
  G.mapKey = '';
  O.clear(); G.drawUI();
  const shown = read();
  (shown.includes('map ' + G.MAP.u + 'u'))
    ? ok('devmode puts the map on screen') : fail('no map in devmode');

  const rows = G.buildMap();
  (rows.length === G.MAP.h && rows.every(r => r.length === G.MAP.w))
    ? ok(`the map is ${G.MAP.w}x${G.MAP.h} and every row is full`)
    : fail(`ragged map: ${rows.length} rows, widths ${[...new Set(rows.map(r => r.length))]}`);

  // you are in the middle of your own map
  const mid = rows[(G.MAP.h - 1) >> 1][(G.MAP.w - 1) >> 1];
  (mid === '@') ? ok('the player sits at the centre of it')
                : fail(`centre of the map is "${mid}", not the player`);

  // every mark is a character the text atlas can actually draw
  {
    let bad = 0;
    for (const r of rows) for (const ch of r) {
      const n = ch.charCodeAt(0);
      if (n <= 32 || n >= 127) bad++;
    }
    (bad === 0) ? ok('every mark on it is a printable character')
                : fail(`${bad} marks the atlas cannot draw`);
  }

  // north is up, because that is what the inscriptions' bearings mean
  {
    const M = G.MAP, uy = M.u * c.CFG.CELL_H / c.CFG.CELL_W;
    const cy = (M.h - 1) / 2;
    const northY = P.y + (0 - cy) * uy;
    (northY < P.y) ? ok('north is up, agreeing with the record\'s bearings')
                   : fail('the map is upside down against the chronicle');
  }

  // it redraws when you walk, and not when you stand still
  {
    const k0 = G.mapAt();
    G.buildMap();
    const same = G.mapAt() === k0 && G.mapKey === k0;
    P.x += G.MAP.u * 3;
    const moved = G.mapAt() !== G.mapKey;
    (same && moved) ? ok('the map rebuilds when you move and not when you do not')
                    : fail(`map refresh wrong: still=${same} moved=${moved}`);
    P.x -= G.MAP.u * 3;
  }

  // it stays inside the overlay, whatever the terminal size
  {
    let over = 0;
    for (const cols of [60, 80, 120, 200]) {
      O.resize(cols, 40);
      G.mapKey = '';
      O.clear();
      G.drawUI();
      if (O.data.length !== cols * 40) over++;
    }
    (over === 0) ? ok('the map fits every width without running off the grid')
                 : fail('the map wrote outside the overlay');
    // and a terminal too small for it simply goes without
    O.resize(20, 10);
    O.clear();
    G.drawUI();
    (!read().includes('map '))
      ? ok('a screen too small for it does without, rather than clipping')
      : fail('the map drew into a screen with no room');
  }

  // the zoom command is devmode-only and cycles
  O.resize(120, 40);
  {
    G.devMode = false;
    G.openConsole(); G.cmdBuf = 'map';
    G.consoleInput({ code: 'Enter', key: 'Enter' });
    (G.cmdHistory[G.cmdHistory.length - 1].includes('devmode'))
      ? ok('map refuses outside devmode') : fail('map worked without devmode');
    G.devMode = true;
    const u0 = G.MAP.u;
    G.cmdBuf = 'map';
    G.consoleInput({ code: 'Enter', key: 'Enter' });
    (G.MAP.u !== u0 && G.MAP_ZOOM.includes(G.MAP.u))
      ? ok(`map cycles the scale (${u0} -> ${G.MAP.u} units a cell)`)
      : fail(`zoom did not cycle: ${u0} -> ${G.MAP.u}`);
    G.cmdBuf = 'map 24';
    G.consoleInput({ code: 'Enter', key: 'Enter' });
    (G.MAP.u === 24) ? ok('and takes a scale outright') : fail(`map 24 gave ${G.MAP.u}`);
    G.MAP.u = 12;
    G.close();
  }
  G.devMode = false;
}

// ---- 21. colour in the overlay ----
{
  const O = c.Overlay;
  O.resize(40, 10);
  O.clear();
  O.write(2, 2, 'hi');
  const plain = O.data[2 * 40 + 2];
  O.clear();
  O.write(2, 2, 'hi', O.C.water);
  const tinted = O.data[2 * 40 + 2];
  ((plain & 0xff) === (tinted & 0xff))
    ? ok('a colour does not disturb the character under it')
    : fail('tinting changed the glyph');
  ((plain >> 8) === 0 && (tinted >> 8) === O.C.water)
    ? ok('the colour rides in the high bits, so no second buffer is needed')
    : fail(`tint bits wrong: ${plain >> 8} / ${tinted >> 8}`);
  // the clear air either side of a word has no ink in it to colour
  ((O.data[2 * 40 + 1] & 0xff) === O.BLANK && (O.data[2 * 40 + 1] >> 8) === 0)
    ? ok('the blank either side of a word is left untinted')
    : fail('the clear air got a colour');
  O.clear();
  O.put(5, 5, '~', O.C.water);
  ((O.data[5 * 40 + 5] & 0xff) === '~'.charCodeAt(0) &&
   (O.data[5 * 40 + 5] >> 8) === O.C.water)
    ? ok('a single cell can be placed with its own colour')
    : fail('Overlay.put wrong');
}

// ---- 22. the map is coloured by what it shows ----
if (c.Player) {
  const G = c.Game, O = c.Overlay, P = c.Player;
  O.resize(120, 40);
  G.devMode = true; G.mapKey = '';
  P.x = 200; P.y = -150;
  G.buildMap();
  const seen = {};
  for (let j = 0; j < G.MAP.h; j++) for (let i = 0; i < G.MAP.w; i++) {
    seen[G.mapRows[j][i]] = G.mapTint[j][i];
  }
  (seen['@'] === O.C.self) ? ok('you are drawn in your own colour')
                           : fail(`player tint ${seen['@']}`);
  const landOk = G.MAP_RAMP.split('').every(ch => seen[ch] === undefined || seen[ch] === O.C.land);
  landOk ? ok('every land shade is drawn as land') : fail('a land shade has the wrong colour');
  (seen['~'] === undefined || seen['~'] === O.C.water)
    ? ok('water is drawn as water') : fail(`water tint ${seen['~']}`);
  (seen['>'] === undefined || seen['>'] === O.C.cave)
    ? ok('a cave mouth has its own colour') : fail(`cave tint ${seen['>']}`);
  {
    let bad = 0;
    for (const k of Object.keys(G.MAP_KIND)) {
      const u = G.MAP_KIND[k], l = u.toLowerCase();
      if (seen[u] !== undefined && seen[u] !== O.C.site) bad++;
      if (seen[l] !== undefined && seen[l] !== O.C.site) bad++;
    }
    (bad === 0) ? ok('settlements are drawn in the settlement colour')
                : fail(`${bad} settlement marks miscoloured`);
  }
  // the map writes its colours through to the overlay, not just its own grid
  O.clear(); G.drawUI();
  let tinted = 0;
  for (let i = 0; i < O.data.length; i++) if (O.data[i] >> 8) tinted++;
  (tinted > 100) ? ok(`${tinted} coloured cells reach the overlay`)
                 : fail(`only ${tinted} cells carried colour through`);
  G.devMode = false;
}

// ---- 23. the compass ----
if (c.Player) {
  const G = c.Game, O = c.Overlay, P = c.Player;
  O.resize(120, 40);
  // read the row the compass actually claims - the top one is the frame
  // statistics and whatever is being asked of you, and the compass sits
  // under it rather than sliding across it
  const read = () => {
    let t = '';
    const base = G.COMPASS_ROW * 120;
    for (let i = base; i < base + 120; i++) {
      const ch = O.data[i] & 0xff;
      t += (ch > 32 && ch < 127) ? String.fromCharCode(ch) : ' ';
    }
    return t;
  };
  // east is +x, and the chronicle's north is -y; the map already agrees
  const face = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };
  let wrong = 0;
  for (const name of Object.keys(face)) {
    P.angle = face[name];
    O.clear(); G.drawCompass();
    const row = read();
    if (!row.includes(name)) { wrong++; continue; }
    // and it should be near the middle, because you are looking straight at it
    const at = row.indexOf(name) + name.length / 2;
    if (Math.abs(at - 60) > 6) wrong++;
  }
  (wrong === 0)
    ? ok('every cardinal reads correctly and sits where you are looking')
    : fail(`${wrong} cardinals wrong or off-centre`);

  // facing east, west must not be on screen: the field is 81 degrees, not 360
  P.angle = 0;
  O.clear(); G.drawCompass();
  (!read().includes('west'))
    ? ok('only what is actually in front of you is on the strip')
    : fail('the compass shows a bearing behind the camera');

  // and it never runs off the ends
  let over = 0;
  for (let a = 0; a < 6.28; a += 0.05) {
    P.angle = a;
    O.clear();
    G.drawCompass();
    if (O.data.length !== 120 * 40) over++;
  }
  (over === 0) ? ok('the strip stays inside the grid at every heading')
               : fail('the compass wrote outside the overlay');

  // devmode gates it, and the HUD steps down to make room
  G.devMode = false;
  O.clear(); G.drawUI();
  (!read().includes('north') && !read().includes('east'))
    ? ok('no compass without devmode') : fail('compass shows outside devmode');
}

// ---- 24. the escape menu ----
{
  const G = c.Game;
  G.close();
  G.key('Escape');
  (G.mode === 'menu') ? ok('escape opens the menu from play')
                      : fail(`escape gave mode ${G.mode}`);
  c.Overlay.resize(120, 40);
  c.Overlay.clear(); G.drawUI();
  {
    let t = '';
    for (let i = 0; i < c.Overlay.data.length; i++) {
      const ch = c.Overlay.data[i] & 0xff;
      if (ch > 32 && ch < 127) t += String.fromCharCode(ch);
    }
    (t.includes('save') && t.includes('over') && t.includes('stop'))
      ? ok('the menu renders its choices') : fail('menu missing from the overlay');
  }
  G.key('KeyQ');
  (G.mode === 'play') ? ok('and Q puts you back in the world') : fail('Q did not close');

  // save writes and returns you to the world
  G.key('Escape'); G.cursor = 0;
  G.give('stone', 1);
  G.confirm();
  (G.mode === 'play' && G.toastMsg.includes('saved'))
    ? ok('save writes and hands the world back') : fail('save did not report');

  // restart asks twice, because it throws a world away
  G.key('Escape');
  G.cursor = 2;
  G.confirm();
  (G.mode === 'menu' && G.menuAsk === true)
    ? ok('restart asks before it destroys anything')
    : fail(`restart did not ask: mode=${G.mode} ask=${G.menuAsk}`);
  c.Overlay.clear(); G.drawUI();
  G.key('KeyQ');
  (G.mode === 'play' && G.menuAsk === false)
    ? ok('and backing out forgets it was asked')
    : fail('the half-asked restart survived closing the menu');
}

// ---- 25. the prologue: the myth, and then the record ----
if (c.Lore) {
  const { Lore, Game: G } = c;
  const S = Lore.init();
  const chron = Lore.chronology();

  (chron.length > 4) ? ok(`the record fits on one screen (${chron.length} lines)`)
                     : fail('chronology is empty');
  (Math.max(...chron.map(l => l.length)) <= 60)
    ? ok('and every line of it fits the panel')
    : fail(`a chronology line runs to ${Math.max(...chron.map(l => l.length))}`);

  // it names the peoples who actually stood here, and nobody else
  {
    const standing = S.peoples.filter(p => p.founded);
    const text = chron.join('\n');
    const named = standing.filter(p => text.includes(p.name)).length;
    (named === standing.length)
      ? ok(`all ${named} peoples who founded anything are named`)
      : fail(`${standing.length - named} peoples missing from the record`);
    const ghosts = S.peoples.filter(p => !p.founded && text.includes(p.name)).length;
    (ghosts === 0) ? ok('and nobody who never founded anything is')
                   : fail(`${ghosts} peoples named who were never here`);
  }

  // every year and cause on it is the sim's, not a description of one
  {
    let bad = 0;
    for (const p of S.peoples) {
      if (!p.founded) continue;
      const row = chron.find(l => l.includes(p.name));
      if (!row) { bad++; continue; }
      if (!row.includes(String(p.rise))) bad++;
      if (p.fell >= 0 && !row.includes(String(p.fell))) bad++;
      if (p.fell >= 0 && !row.includes(p.cause || 'decline')) bad++;
      if (p.fell < 0 && !row.includes('still')) bad++;
    }
    (bad === 0) ? ok('every date and every ending on it is the record\'s own')
                : fail(`${bad} rows disagree with the chronicle`);
  }

  // the same seed writes the same record
  (JSON.stringify(chron) === JSON.stringify(Lore.chronology()))
    ? ok('and it is the same record twice') : fail('chronology is not deterministic');

  // a new game shows the myth, then the record, then the world
  {
    G.spawnAt = null;
    G.mythPart = 0; G.mode = 'myth'; G.mythT = 0;
    const p0 = G.prologue();
    (p0.length && p0 === S.myth.lines)
      ? ok('a new game opens on the myth') : fail('prologue does not start on the myth');
    G.key('KeyW');
    (G.mode === 'myth' && G.mythPart === 1)
      ? ok('a keypress moves it on to the record rather than skipping both')
      : fail(`first key gave mode=${G.mode} part=${G.mythPart}`);
    (G.mythT === 0 && G.tlYear() === 0)
      ? ok('and the second part starts the record at year zero')
      : fail(`second part opened at year ${G.tlYear()}`);
    G.key('KeyW');
    (G.mode === 'play') ? ok('a second keypress hands over to the world')
                        : fail(`second key gave ${G.mode}`);

    // and it plays through on its own if nobody touches anything
    G.mythPart = 0; G.mode = 'myth'; G.mythT = 0;
    let ticks = 0;
    for (; ticks < 2000 && G.mode === 'myth'; ticks++) G.tick(0.1);
    (G.mode === 'play') ? ok(`left alone, it plays through in ${(ticks / 10) | 0}s`)
                        : fail('the prologue never ended by itself');
  }

  // ---- the timelapse: the clock, and what it counts ----
  {
    const beats = Lore.timeline();
    (beats.length > 8 && beats.length <= Lore.BEATS)
      ? ok(`the record runs to ${beats.length} beats`)
      : fail(`timeline has ${beats.length} beats`);
    let unsorted = 0, outside = 0, wide = 0;
    for (let i = 0; i < beats.length; i++) {
      if (i && beats[i].t < beats[i - 1].t) unsorted++;
      if (beats[i].t < 0 || beats[i].t > S.now) outside++;
      if (beats[i].text.length > 66) wide++;
    }
    unsorted === 0 ? ok('and it runs forwards') : fail(`${unsorted} beats out of order`);
    outside === 0 ? ok('every beat inside the span')
                  : fail(`${outside} beats outside 0..${S.now}`);
    wide === 0 ? ok('and every caption fits a line')
               : fail(`${wide} captions too long`);

    // Every people who stood here arrives on it and, if they ended, ends
    // on it: the spine is not something the sampling may drop.
    let missing = 0;
    for (const p of S.peoples) {
      if (!p.founded) continue;
      if (!beats.some(b => b.text.startsWith(p.name + ' come'))) missing++;
      if (p.fell >= 0 && !beats.some(b => b.text.startsWith(p.name + ' are finished'))) missing++;
    }
    missing === 0 ? ok('every people arrives and ends on it')
                  : fail(`${missing} arrivals or endings missing`);

    // and the clock covers the whole span rather than stopping short
    G.mythPart = 1; G.mode = 'myth'; G.mythT = 0;
    (G.tlYear() === 0) ? ok('the clock starts at nothing')
                       : fail(`clock starts at ${G.tlYear()}`);
    G.mythT = S.now / G.TL_SPEED;
    (G.tlYear() === S.now) ? ok(`and reaches ${S.now} before the hold`)
                           : fail(`clock reached ${G.tlYear()}`);
    G.mythT = G.tlLen() * 2;
    (G.tlYear() === S.now) ? ok('and never runs past it')
                           : fail(`clock overran to ${G.tlYear()}`);
    (G.tlLen() > S.now / G.TL_SPEED)
      ? ok(`the finished map stands for ${G.TL_HOLD}s`)
      : fail('no hold at the end');
    (JSON.stringify(beats) === JSON.stringify(Lore.timeline()))
      ? ok('and it is the same record twice')
      : fail('timeline is not deterministic');
  }
  G.mode = 'play'; G.mythPart = 0; G.mythT = 0;
}

// ---- 26. devmode teleports ----
if (c.Player && c.Lore && c.Steading) {
  const G = c.Game, P = c.Player, S = c.Lore.init();
  P.mouse = P.mouse || {};
  const run = cmd => { G.openConsole(); G.cmdBuf = cmd;
                       G.consoleInput({ code: 'Enter', key: 'Enter' }); };
  const last = () => G.cmdHistory[G.cmdHistory.length - 1];

  G.devMode = false;
  run('teleport building');
  last().includes('devmode') ? ok('teleport refuses outside devmode')
                             : fail('teleport worked without devmode');
  G.devMode = true;
  run('teleport');
  last().includes('building') ? ok('teleport on its own says what it takes')
                              : fail('no usage line: ' + last());

  // ---- building ----
  P.x = 0; P.y = 0; P.z = c.terrainH(0, 0);
  run('teleport building');
  (G.mode === 'play') ? ok('teleporting closes the console so you can see')
                      : fail('console stayed open, mode ' + G.mode);

  // it landed near a real building of the nearest settlement
  let site = null, sd = Infinity;
  for (const st of S.sites) {
    const d = (st.x - P.x) ** 2 + (st.y - P.y) ** 2;
    if (d < sd) { sd = d; site = st; }
  }
  const plan = c.Steading.plan(S, site, S.now);
  let near = Infinity;
  for (const b of plan) {
    near = Math.min(near, Math.hypot(b.pos[0] - P.x, b.pos[1] - P.y));
  }
  (near < 26) ? ok(`lands beside a building (${near.toFixed(1)}u from one)`)
              : fail(`landed ${near.toFixed(0)}u from the nearest building`);

  // ...and NOT inside one, which is the mistake this exists to avoid
  {
    const MH = 64, MP = 4096;
    const head = new Float32Array(MH * 8), prim = new Float32Array(MP * 20);
    const r = c.Steading.pack(S, P.x, P.y, S.now, head, prim, MH, MP);
    const eye = [P.x, P.y, P.z + CFG_EYE()];
    function CFG_EYE() { return c.CFG.EYE; }
    let inside = 0;
    for (let i = 0; i < r.heads; i++) {
      const h = i * 8;
      const d = Math.hypot(head[h] - eye[0], head[h + 1] - eye[1], head[h + 2] - eye[2]);
      if (d < head[h + 3]) inside++;
    }
    (inside === 0) ? ok('and outside every one of them, not in a wall')
                   : fail(`teleported inside ${inside} buildings`);
  }

  // it stands you on the ground, on your feet, out of the water
  (P.onGround && !P.swimming && P.vz === 0)
    ? ok('and on your feet rather than mid-fall')
    : fail(`landed airborne: ground=${P.onGround} swim=${P.swimming} vz=${P.vz}`);
  (Math.abs(P.z - c.World.walkZ(P.x, P.y, P.z)) < 0.2)
    ? ok('at the height the ground actually is')
    : fail(`z ${P.z.toFixed(2)} vs floor ${c.World.walkZ(P.x, P.y, P.z)}`);
  (c.terrainH(P.x, P.y) >= c.CFG.SEA_LEVEL)
    ? ok('and never into the sea') : fail('teleported into the water');

  // and looking at the thing it took you to
  {
    let bd = Infinity, at = null;
    for (const b of plan) {
      const d = Math.hypot(b.pos[0] - P.x, b.pos[1] - P.y);
      if (d < bd) { bd = d; at = b; }
    }
    const want = Math.atan2(at.pos[1] - P.y, at.pos[0] - P.x);
    let off = Math.abs(((P.angle - want + Math.PI) % (Math.PI * 2) + Math.PI * 2)
                       % (Math.PI * 2) - Math.PI);
    (off < 0.2) ? ok('facing what it brought you to') : fail(`facing ${off.toFixed(2)} rad off`);
  }

  // ---- npc ----
  // Written a phase before there were any people and left pointing at the
  // creature system, so it reported an empty world to somebody standing in
  // a village. It walks to the nearest of NPC.all() now.
  if (c.NPC && c.NPC.all().length) {
    const folk = c.NPC.all();
    P.x = 0; P.y = 0; P.z = c.terrainH(0, 0);
    run('teleport npc');
    let bd = Infinity, who = null;
    for (const n of folk) {
      const d = Math.hypot(n.x - P.x, n.y - P.y);
      if (d < bd) { bd = d; who = n; }
    }
    (bd < 20) ? ok(`teleport npc lands ${bd.toFixed(1)}u from ${who.name}`)
              : fail(`npc teleport landed ${bd.toFixed(0)}u from anybody`);
    // near enough that E reaches them, far enough not to be inside them
    (bd > 0.9) ? ok('and beside them rather than on top of them')
               : fail(`landed ${bd.toFixed(2)}u away - inside the person`);
    // and pointed at them, like the building teleport
    const want = Math.atan2(who.y - P.y, who.x - P.x);
    const off = Math.abs(((P.angle - want + Math.PI) % (Math.PI * 2) + Math.PI * 2)
                         % (Math.PI * 2) - Math.PI);
    (off < 0.2) ? ok('facing the person it brought you to')
                : fail(`facing ${off.toFixed(2)} rad off the person`);
    // it names who it took you to, so the toast is worth reading
    (G.toastMsg.includes(who.name)) ? ok('and says who they are')
                                    : fail('toast does not name them: ' + G.toastMsg);
  }
  G.devMode = false;
  G.close();
}

// ---- 27. talking to somebody, and doing what they ask ----
if (c.NPC && c.Quest) {
  const G = c.Game, P = c.Player, NPC = c.NPC, Quest = c.Quest;
  const S = c.Lore.init();
  const seeker = NPC.all().find(n => Quest.forNpc(n) && Quest.forNpc(n).kind === 'seek');
  const elder = NPC.elder();
  (seeker && elder)
    ? ok('the world has somebody who wants a place and somebody who remembers')
    : fail('missing the seeker or the elder');

  const text = () => {
    let t = '';
    for (let i = 0; i < c.Overlay.data.length; i++) {
      const ch = c.Overlay.data[i] & 0xff;
      if (ch > 32 && ch < 127) t += String.fromCharCode(ch);
    }
    return t;
  };
  c.Overlay.resize(120, 44);

  // examine has to find a person before the ground they are standing on,
  // whoever they are - checked on the seeker, since there is only one kind
  // of ask left and the elder's panel is a different shape.
  if (seeker) {
    // Walk round them until nothing is in the way. A trunk between you and
    // a person IS what you are looking at, so the test has to stand
    // somewhere with a clear line rather than assume the first angle is.
    let t = null;
    for (let a = 0; a < Math.PI * 2 - 0.01 && !(t && t.kind === 'npc'); a += Math.PI / 8) {
      const dx = Math.cos(a), dy = Math.sin(a);
      P.x = seeker.x - dx * 1.2; P.y = seeker.y - dy * 1.2; P.z = seeker.z;
      P.angle = a; P.pitch = 0;
      t = c.World.examineRay(P.x, P.y, P.z + c.CFG.EYE, dx, dy, 0);
    }
    (t && t.kind === 'npc' && t.npc === seeker.id)
      ? ok('examine finds a person before the ground they stand on')
      : fail('examine never found the person: ' + JSON.stringify(t && t.kind));
    G.talkTo(seeker);
    (G.mode === 'talk') ? ok('and speaking to them opens the conversation')
                        : fail('talk did not open');
    c.Overlay.clear(); G.drawUI();
    (text().includes(seeker.name.toUpperCase().slice(0, 4)))
      ? ok('who they are is on the screen') : fail('the talk panel is empty');
    G.close();
  }

  // ---- lifting a named thing, and what you do with it ----
  if (c.Relic) {
    const Relic = c.Relic;
    G.lifted = []; G.inv.clear(); G.quests = {}; G.close();
    const site = Relic.all()[0];
    const item = Relic.itemId(site.art);

    // standing on it with nothing to dig with
    P.x = site.x; P.y = site.y; P.z = c.terrainH(site.x, site.y);
    (G.liftFromGround(site.x, site.y) === true && G.count(item) === 0)
      ? ok('the ground says there is something here, and refuses bare hands')
      : fail('lifted a relic without a shovel');

    // and with one
    G.give('shovel', 1);
    G.liftFromGround(site.x, site.y);
    (G.count(item) === 1) ? ok(`${site.name} comes up with a shovel`)
                          : fail('the relic did not come up');
    (G.lifted.indexOf(site.art) >= 0) ? ok('and the world records it as gone')
                                      : fail('lifted list not updated');
    (Relic.near(site.x, site.y, Relic.REACH) === null ||
     Relic.near(site.x, site.y, Relic.REACH).art !== site.art)
      ? ok('and digging the same hole does not give it again')
      : fail('the same relic can be lifted twice');

    // it is called what the record calls it, not "relic:0"
    (G.itemName(item) === site.name) ? ok('the inventory calls it by its name')
                                     : fail('inventory shows ' + G.itemName(item));
    const d = Relic.describe(item);
    (d[0] === site.name && d[1].length > 8)
      ? ok('and it can be examined for its own history')
      : fail('relic description is empty');

    // and a save carries it
    const snap = JSON.parse(JSON.stringify(G.snapshot()));
    G.lifted = []; G.inv.clear();
    G.restore(snap);
    (G.count(item) === 1 && G.lifted.indexOf(site.art) >= 0)
      ? ok('what you dug up survives a reload')
      : fail('the relic was lost on reload');
  }

  // ---- bring it, or keep it ----
  if (c.Relic) {
    const Relic = c.Relic;
    const lifter = NPC.all().find(x => Quest.chain(x).some(q => q.kind === 'lift'));
    if (!lifter) { fail('nobody in the world asks for a named thing'); }
    else {
      const step = Quest.chain(lifter).find(q => q.kind === 'lift');
      const item = Relic.itemId(step.art);
      // walk the chain up to that step
      G.quests = {}; G.lifted = []; G.inv.clear();
      for (const q of Quest.chain(lifter)) {
        if (q.id === step.id) break;
        G.quests[q.id] = 'done';
      }
      (Quest.current(lifter).id === step.id)
        ? ok('a chain reaches the step that wants a named thing')
        : fail('could not reach the lift step');
      G.talkTo(lifter); G.confirm();
      (G.quests[step.id] === 'open' && !Quest.done(step))
        ? ok('and it cannot be handed in empty-handed')
        : fail('the lift step completed without the thing');

      // dig it up
      G.give('shovel', 1);
      G.liftFromGround(step.x, step.y);
      (Quest.done(step)) ? ok('holding it satisfies the step')
                         : fail('holding the relic did not satisfy it');

      // hand it over: it changes hands
      G.talkTo(lifter); G.confirm();
      (G.quests[step.id] === 'done' && G.count(item) === 0 && G.count('gem') === 2)
        ? ok('handing it over gives it up and is paid for')
        : fail(`hand-over left item=${G.count(item)} gem=${G.count('gem')}`);
      (Quest.at(lifter) > Quest.chain(lifter).indexOf(step))
        ? ok('and the chain moves on') : fail('the chain stalled after handing over');

      // or keep it: it stays, nothing is paid, and they stop asking
      G.quests = {}; G.lifted = []; G.inv.clear(); G.give('shovel', 1);
      for (const q of Quest.chain(lifter)) {
        if (q.id === step.id) break;
        G.quests[q.id] = 'done';
      }
      G.talkTo(lifter); G.confirm();
      G.liftFromGround(step.x, step.y);
      G.talkTo(lifter);
      G.talkKeep();
      (G.quests[step.id] === 'kept' && G.count(item) === 1 && G.count('gem') === 0)
        ? ok('keeping it keeps it, and nothing is paid')
        : fail(`keep left state=${G.quests[step.id]} item=${G.count(item)}`);
      (Quest.current(lifter) === null)
        ? ok('and that person stops asking you for things')
        : fail('the chain carried on after being refused');
      G.quests = {}; G.lifted = []; G.inv.clear(); G.close();
    }
  }

  // ---- the elder: what got here by being told ----
  if (elder && c.Tales) {
    const Tales = c.Tales;
    G.told = []; G.quests = {}; G.close();
    G.talkTo(elder);
    (G.mode === 'talk' && G.talkTale && G.talkTale.id === 'halls')
      ? ok('the elder opens on what is under the ground')
      : fail('elder opened on ' + (G.talkTale && G.talkTale.id));
    c.Overlay.clear(); G.drawUI();
    const first = text();
    (first.includes('UNDERTHEGROUND') || first.includes('WHATISUNDER'))
      ? ok('and the tale itself is on the screen, not a summary of it')
      : fail('the tale is not in the panel');
    (Quest.chain(elder).length > 0)
      ? ok('and he has his own chain, about his own memory')
      : fail('the elder has nothing to ask');

    // listening records it and moves to the next
    G.confirm();
    (G.told.length === 1 && G.told[0] === 'halls')
      ? ok('hearing one keeps it') : fail('told: ' + JSON.stringify(G.told));
    (G.talkTale && G.talkTale.id !== 'halls')
      ? ok('and the next one is ready') : fail('no second tale');

    // hearing the same one twice does not double it
    const t2 = G.talkTale;
    G.hear(t2); G.hear(t2);
    (G.told.filter(x => x === t2.id).length === 1)
      ? ok('and nothing is remembered twice') : fail('a tale was recorded twice');

    // Three stories and he wants something done. This is the gate: no more
    // telling until the step he asked for is finished.
    while (G.talkTale) G.confirm();
    (G.told.length === Quest.ELDER_GATE)
      ? ok(`he stops after ${Quest.ELDER_GATE} and asks for something`)
      : fail(`told ${G.told.length} before stopping`);
    (G.talkQ && Quest.state(G.talkQ.id) === 'none')
      ? ok('and what he stops for is the next link of his own chain')
      : fail('nothing was asked at the gate');
    G.talkTo(elder);
    (G.talkTale === null)
      ? ok('and coming back gets the same question, not another story')
      : fail('the gate let a story through');

    // satisfy every step by fiat and the rest of his memory opens up
    let guard = 0;
    while (guard++ < 40) {
      const q = Quest.current(elder);
      if (q) G.quests[q.id] = 'done';
      G.talkTo(elder);
      if (!G.talkTale) break;
      while (G.talkTale) G.confirm();
    }
    const held = Tales.forNpc(elder).length;
    (G.told.length === held)
      ? ok(`all ${held} come out once his chain is satisfied`)
      : fail(`heard ${G.told.length} of ${held}`);
    G.close();

    // the record keeps them, and a save carries them
    c.Overlay.clear(); G.open('journal'); G.drawUI();
    (text().includes('WHATYOUHAVEBEENTOLD'))
      ? ok('the record has a page for what you were told')
      : fail('the journal does not list the tales');
    G.close();
    const snap = JSON.parse(JSON.stringify(G.snapshot()));
    const keep = G.told.slice();
    G.told = [];
    G.restore(snap);
    (JSON.stringify(G.told) === JSON.stringify(keep))
      ? ok('and what you were told survives a save')
      : fail('told list lost on reload');
    G.told = [];
  }

  if (seeker) {
    const q = Quest.forNpc(seeker);
    G.quests = {}; G.close();
    G.talkTo(seeker); G.confirm();
    P.x = seeker.x; P.y = seeker.y;
    (!Quest.done(q)) ? ok('a place is not found from where you were told about it')
                     : fail('the seek quest completed without going anywhere');
    P.x = q.x + 4; P.y = q.y - 3;
    (Quest.done(q)) ? ok('and is found by standing in it')
                    : fail('standing in the place did not count');
    G.talkTo(seeker); G.confirm();
    (G.quests[q.id] === 'done') ? ok('reporting back closes it') : fail('seek did not close');
  }

  // quests survive a save
  {
    G.quests = { b0: 'open', s1: 'done' };
    const snap = JSON.parse(JSON.stringify(G.snapshot()));
    G.quests = {};
    G.restore(snap);
    (G.quests.b0 === 'open' && G.quests.s1 === 'done')
      ? ok('what is owed survives the save') : fail('quests lost on save');
    G.restore({});
    (Object.keys(G.quests).length === 0) ? ok('and a new world owes nothing')
                                         : fail('quests carried into a fresh world');
  }
  G.close();
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\ngame tests passed');
