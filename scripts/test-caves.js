// Tests for the cave system: determinism, floor-slope walkability bound,
// passage percolation, headroom, entrance reachability, and edit round-trips.
// The WGSL twin cannot run here; parity rests on line-for-line ports plus the
// interpolated-constant convention checked by scripts/verify.js.
//
// Usage: node scripts/test-caves.js   (exit 0 = clean; skips until the cave
// fields exist in js/util.js)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const grab = n => `${n}: (typeof ${n} === 'undefined' ? null : ${n})`;
const src = ['config', 'util', 'world']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, World, terrainH, ' +
  [ 'CAVES', 'caveMask', 'caveFloor', 'caveCeil', 'caveVoidAt', 'solidD',
  ].map(grab).join(', ') + ' });';
const c = vm.runInNewContext(src, { console, Math }, { filename: 'under-test' });

if (!c.caveVoidAt) {
  console.log('cave fields not yet implemented — nothing to test');
  process.exit(0);
}

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);

// ---- tests land with phase C2+ ----

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\ncave tests passed');
