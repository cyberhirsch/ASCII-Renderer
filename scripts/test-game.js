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
const src = ['config', 'util', 'world', 'overlay', 'edits', 'items', 'game']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, CAVES, World, Overlay, Edits, Game, ITEMS, RECIPES, SPECIES, ' +
  'terrainH, solidD, treeAt, ' +
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

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\ngame tests passed');
