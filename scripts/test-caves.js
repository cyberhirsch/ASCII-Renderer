// Tests for the cave system: determinism, floor-slope walkability bound,
// passage percolation, headroom, surface parity of walkZ, and cave-floor
// landing. The WGSL twin cannot run here; parity rests on line-for-line
// ports plus the interpolated-constant convention checked by
// scripts/verify.js.
//
// Usage: node scripts/test-caves.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const grab = n => `${n}: (typeof ${n} === 'undefined' ? null : ${n})`;
const src = ['config', 'util', 'world']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, World, terrainH, ' +
  ['CAVES', 'caveFloor', 'caveV', 'solidD', 'vn2', 'smoothstep']
    .map(grab).join(', ') + ' });';
const c = vm.runInNewContext(src, { console, Math }, { filename: 'under-test' });

if (!c.caveV || !c.caveFloor) {
  console.log('cave fields not yet implemented — nothing to test');
  process.exit(0);
}

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);
const { CAVES, CFG } = c;

// deterministic pseudo-random points from the mirrored hash
const vnSrc = fs.readFileSync(path.join(root, 'js/util.js'), 'utf8');
const u = vm.runInNewContext(vnSrc + '\n({ hash01 });', { Math, CFG });
const rnd = (i, s) => u.hash01(i, i * 7 + 3, s) * 4000 - 2000;

// ---- 1. determinism ----
const d1 = c.caveV(123.4, -567.8, -8.2, 7.7);
const d2 = c.caveV(123.4, -567.8, -8.2, 7.7);
const f1 = c.caveFloor(-2, 55.5, -44.25);
const f2 = c.caveFloor(-2, 55.5, -44.25);
(d1 === d2 && f1 === f2) ? ok('caveV/caveFloor deterministic')
                         : fail('cave fields nondeterministic');

// ---- 2. floor slope bound: walkability is by construction ----
let worstSlope = 0;
for (const k of [-1, -2, -3]) {
  for (let i = 0; i < 4000; i++) {
    const x = rnd(i, 11), y = rnd(i, 22);
    const f0 = c.caveFloor(k, x, y);
    const s = Math.max(
      Math.abs(c.caveFloor(k, x + 0.25, y) - f0),
      Math.abs(c.caveFloor(k, x, y + 0.25) - f0)) / 0.25;
    if (s > worstSlope) worstSlope = s;
  }
}
worstSlope < 0.5 ? ok(`floor slope bound: worst ${worstSlope.toFixed(3)} (< 0.5 = ~26 deg)`)
                 : fail(`cave floor too steep: ${worstSlope.toFixed(3)}`);

// the mask gate at a point, replicated from caveV for test bookkeeping
const gateAt = (x, y, gz) => {
  const s = CFG.SEED >>> 0;
  const m = c.vn2(x * CAVES.MASK_F, y * CAVES.MASK_F, (s ^ 0x33AA) >>> 0);
  return c.smoothstep(CAVES.MASK_LO, CAVES.MASK_HI, m) *
         c.smoothstep(CFG.SEA_LEVEL + 0.5, CFG.SEA_LEVEL + 1.5, gz);
};

// ---- 3. region coverage + find a region-interior centre ----
let inCave = 0, total = 0, best = -1, bx = 0, by = 0;
for (let x = -2000; x < 2000; x += 25) {
  for (let y = -2000; y < 2000; y += 25) {
    total++;
    const gz = c.terrainH(x, y);
    const v = c.caveV(x, y, c.caveFloor(-1, x, y) + 1.2, gz);
    if (v > 0) inCave++;
    if (v <= 0) continue;
    // score by how deep inside a mask region this point sits
    let score = 0;
    for (let dx = -50; dx <= 50; dx += 25) {
      for (let dy = -50; dy <= 50; dy += 25) {
        score += gateAt(x + dx, y + dy, c.terrainH(x + dx, y + dy));
      }
    }
    if (score > best) { best = score; bx = x; by = y; }
  }
}
const frac = inCave / total;
(frac > 0.005 && frac < 0.40)
  ? ok(`cave coverage ${(frac * 100).toFixed(1)}% of sampled points`)
  : fail(`cave coverage out of range: ${(frac * 100).toFixed(1)}%`);
best > 10 ? ok(`region-interior centre at ${bx},${by} (score ${best.toFixed(1)}/25)`)
          : fail(`no region interior found (best score ${best.toFixed(1)})`);

// ---- 4. connectivity: flood-fill the passage grid around the centre.
// The world-level claim is that the passage network percolates inside a mask
// region, so the measure is: of the open cells deep inside the region
// (gate > 0.9), what fraction belongs to the largest connected component?
const R = 80, STEP = 0.5, N = Math.round(2 * R / STEP);
const open = new Uint8Array(N * N);
const interior = new Uint8Array(N * N);
let openCount = 0, intCount = 0;
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const x = bx - R + i * STEP, y = by - R + j * STEP;
    const gz = c.terrainH(x, y);
    const v = c.caveV(x, y, c.caveFloor(-1, x, y) + 1.2, gz);
    if (v > 0) {
      open[i * N + j] = 1; openCount++;
      if (gateAt(x, y, gz) > 0.9) { interior[i * N + j] = 1; intCount++; }
    }
  }
}
let bestIntFrac = 0;
{
  const seen = new Uint8Array(N * N);
  const stack = [];
  for (let s = 0; s < N * N; s++) {
    if (!open[s] || seen[s]) continue;
    let intSize = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const q = stack.pop();
      if (interior[q]) intSize++;
      const qi = (q / N) | 0, qj = q % N;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = qi + di, nj = qj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nq = ni * N + nj;
        if (open[nq] && !seen[nq]) { seen[nq] = 1; stack.push(nq); }
      }
    }
    if (intCount && intSize / intCount > bestIntFrac) bestIntFrac = intSize / intCount;
  }
}
(intCount > 500 && bestIntFrac > 0.6)
  ? ok(`connectivity: largest component holds ${(bestIntFrac * 100).toFixed(0)}% of ${intCount} interior cells`)
  : fail(`passages disconnected: largest holds ${(bestIntFrac * 100).toFixed(0)}% of ${intCount} interior cells`);

// ---- 5. headroom at strong points ----
let cramped = 0, checked = 0;
for (let i = 0; i < N * N; i += 7) {
  if (!open[i]) continue;
  const x = bx - R + ((i / N) | 0) * STEP, y = by - R + (i % N) * STEP;
  const gz = c.terrainH(x, y);
  const fz = c.caveFloor(-1, x, y);
  if (c.caveV(x, y, fz + 1.2, gz) < 0.5) continue;   // only strong interior
  checked++;
  if (c.caveV(x, y, fz + 1.75, gz) <= 0) cramped++;
}
(checked > 30 && cramped === 0)
  ? ok(`headroom: ${checked} interior points all clear at 1.75`)
  : fail(`headroom: ${cramped}/${checked} interior points cramped`);

// ---- 6. walkZ surface parity: overworld walking is unchanged ----
let worstDev = 0;
for (let i = 0; i < 500; i++) {
  const x = rnd(i, 33), y = rnd(i, 44);
  const gz = c.terrainH(x, y);
  const wz = c.World.walkZ(x, y, gz);
  if (wz === null) { worstDev = 1e9; break; }
  worstDev = Math.max(worstDev, Math.abs(wz - gz));
}
worstDev < 0.12 ? ok(`walkZ surface parity: worst dev ${worstDev.toFixed(3)}`)
                : fail(`walkZ deviates from terrain on the surface: ${worstDev}`);

// ---- 7. walkZ lands on cave floors ----
let landBad = 0, landChecked = 0;
for (let i = 0; i < N * N; i += 11) {
  if (!open[i]) continue;
  const x = bx - R + ((i / N) | 0) * STEP, y = by - R + (i % N) * STEP;
  const gz = c.terrainH(x, y);
  const fz = c.caveFloor(-1, x, y);
  if (c.caveV(x, y, fz + 1.2, gz) < 0.5) continue;
  landChecked++;
  const wz = c.World.walkZ(x, y, fz + 1.2);
  if (wz === null || Math.abs(wz - fz) > 0.25) landBad++;
}
(landChecked > 30 && landBad === 0)
  ? ok(`walkZ cave landing: ${landChecked} points land on the band floor`)
  : fail(`walkZ misses the cave floor at ${landBad}/${landChecked} points`);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\ncave tests passed');
