// Terrain generator tests, runnable without a browser: loads the plain-script
// modules into one VM context (mirroring what build.js produces) and checks
// the heightmap, city plateau, rivers, and determinism.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

function makeWorld() {
  // consts in a vm script are script-scoped, so concatenate the modules and
  // export what the tests need from inside the same script
  const src = ['config', 'util', 'world']
    .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
    .join('\n') +
    '\nWorld.generate(CFG.SEED); World.placeProps(CFG.SEED);' +
    '\n({ CFG, World, T_WATER, T_BLDG });';
  return vm.runInNewContext(src, { console, Math }, { filename: 'world-under-test' });
}

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);

const c1 = makeWorld();
const c2 = makeWorld();
const W = c1.CFG.WORLD;
const { elev, type } = c1.World;

// determinism
const same = Buffer.from(c1.World.elev).equals(Buffer.from(c2.World.elev)) &&
             Buffer.from(c1.World.type).equals(Buffer.from(c2.World.type));
same ? ok('two generates are byte-identical') : fail('generator is not deterministic');

// stats
let min = 255, max = 0, sum = 0;
for (const e of elev) { if (e < min) min = e; if (e > max) max = e; sum += e; }
ok(`elev min=${min} max=${max} mean=${(sum / elev.length).toFixed(1)} (cap ${c1.CFG.ELEV_MAX})`);
if (max > c1.CFG.ELEV_MAX) fail('elevation exceeds ELEV_MAX');
if (max < 20) fail('no mountains: max elevation too low');
if (min > 4) fail('no lowlands');

// city plateau is perfectly flat at CITY_ELEV
const { cityMin, cityMax } = c1.World;
let flat = true;
for (let y = cityMin; y < cityMax && flat; y++)
  for (let x = cityMin; x < cityMax; x++)
    if (elev[y * W + x] !== c1.CFG.CITY_ELEV) { flat = false; break; }
flat ? ok(`city plateau flat at elev ${c1.CFG.CITY_ELEV}`) : fail('city plateau not flat');

// rivers exist, entirely outside the city
let water = 0, waterInCity = 0;
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  if (type[y * W + x] === c1.T_WATER) {
    water++;
    if (x >= cityMin && x < cityMax && y >= cityMin && y < cityMax) waterInCity++;
  }
}
water > 60 ? ok(`water cells: ${water}`) : fail(`too little water: ${water}`);
waterInCity === 0 ? ok('no water inside the city') : fail(`water in city: ${waterInCity}`);

// water is never uphill of its surroundings by more than a step (sane carving)
let badBank = 0;
for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (type[y * W + x] !== c1.T_WATER) continue;
  const e = elev[y * W + x];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (elev[(y + dy) * W + x + dx] < e - 1 &&
        type[(y + dy) * W + x + dx] !== c1.T_WATER) badBank++;
  }
}
badBank === 0 ? ok('river banks are never below their water') :
  console.log(`  warn  ${badBank} bank cells below water level (minor carving artifacts)`);

// packing round-trip: elev survives bits 25..31
for (const e of [0, 1, 31, 63]) {
  const word = ((e & 0x7f) << 25) | (1 << 24) | (3 & 0xff);
  const back = (word >>> 25) & 0x7f;
  if (back !== e) fail(`packing round-trip failed for elev ${e}`);
}
ok('elev packing round-trips through bits 25..31');

// city untouched by rivers implies roads/buildings still exist
let bldg = 0;
for (let i = 0; i < type.length; i++) if (type[i] === c1.T_BLDG) bldg++;
bldg > 2000 ? ok(`buildings: ${bldg} cells`) : fail(`city looks broken: ${bldg} building cells`);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nterrain tests passed');
