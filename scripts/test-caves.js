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
  ['CAVES', 'caveFloor', 'caveV', 'naturalV', 'shaftAt', 'helixV', 'solidD',
   'vn2', 'smoothstep'].map(grab).join(', ') + ' });';
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

// shaft proximity check, shared by the headroom and floor-landing tests:
// stair slabs and stair floors legitimately reshape the space near a well
const nearShaft = (x, y) => {
  const cx = Math.floor(x / CAVES.SHAFT_E), cy = Math.floor(y / CAVES.SHAFT_E);
  for (let j = 0; j < 3; j++) {
    const a = c.shaftAt && c.shaftAt(cx, cy, j);
    if (a && Math.hypot(x - a.ax, y - a.ay) < CAVES.SHAFT_R + 2.5) return true;
  }
  return false;
};

// ---- 5. headroom at strong points ----
let cramped = 0, checked = 0;
for (let i = 0; i < N * N; i += 7) {
  if (!open[i]) continue;
  const x = bx - R + ((i / N) | 0) * STEP, y = by - R + (i % N) * STEP;
  if (nearShaft(x, y)) continue;
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

// ---- 7. walkZ lands on cave floors (away from shafts, whose stair carve
// legitimately undercuts the local band floor) ----
let landBad = 0, landChecked = 0;
for (let i = 0; i < N * N; i += 11) {
  if (!open[i]) continue;
  const x = bx - R + ((i / N) | 0) * STEP, y = by - R + (i % N) * STEP;
  if (nearShaft(x, y)) continue;
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

// ---- 8. shafts exist: surface entrances and band links ----
if (c.shaftAt) {
  let surf = 0, deep = 0;
  for (let cx = -40; cx <= 40; cx++) {
    for (let cy = -40; cy <= 40; cy++) {
      if (c.shaftAt(cx, cy, 0)) surf++;
      if (c.shaftAt(cx, cy, 1) || c.shaftAt(cx, cy, 2)) deep++;
    }
  }
  surf >= 5 ? ok(`${surf} surface entrances in +/-40 cells`)
            : fail(`too few surface entrances: ${surf}`);
  deep >= 3 ? ok(`${deep} band-link shafts in +/-40 cells`)
            : fail(`too few band-link shafts: ${deep}`);

  // ---- 9. spawn sits beside an entrance ----
  const [sx, sy] = c.World.findSpawn();
  let A = null, bestD2 = Infinity;
  const scx = Math.floor(sx / CAVES.SHAFT_E), scy = Math.floor(sy / CAVES.SHAFT_E);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const a = c.shaftAt(scx + dx, scy + dy, 0);
      if (!a) continue;
      const d2 = (a.ax - sx) ** 2 + (a.ay - sy) ** 2;
      if (d2 < bestD2) { bestD2 = d2; A = a; }
    }
  }
  (A && bestD2 < (CAVES.SHAFT_R + 4) ** 2)
    ? ok(`spawn ${sx.toFixed(0)},${sy.toFixed(0)} beside entrance at ${A.ax.toFixed(0)},${A.ay.toFixed(0)}`)
    : fail('spawn is not beside a cave entrance');

  // ---- 10. walk-bot: a legal walking path exists from spawn down the
  // entrance to band -1. BFS over (x, y, z) states using only legal moves
  // (step <= 1.0, headroom clear) - what a player can do, not clairvoyance.
  if (A) {
    const stand = (x, y, z) => {
      const fz = c.World.walkZ(x, y, z);
      if (fz === null) return null;
      if (Math.abs(fz - z) > 1.0) return null;
      for (let dz = 0.5; dz <= 1.7; dz += 0.4) {
        if (c.solidD(x, y, fz + dz) >= 0) return null;
      }
      return fz;
    };
    const z0 = c.World.walkZ(sx, sy, c.terrainH(sx, sy));
    const queue = [[sx, sy, z0]];
    const seen = new Set();
    const key = (x, y, z) =>
      `${Math.round(x / 0.3)},${Math.round(y / 0.3)},${Math.round(z / 1.2)}`;
    seen.add(key(sx, sy, z0));
    let reached = false, deepest = z0, expanded = 0;
    while (queue.length && !reached && expanded < 6000) {
      const [x, y, z] = queue.shift();
      expanded++;
      for (let d = 0; d < 8; d++) {
        const ang = d * Math.PI / 4;
        const nx = x + Math.cos(ang) * 0.35;
        const ny = y + Math.sin(ang) * 0.35;
        if (Math.hypot(nx - A.ax, ny - A.ay) > CAVES.SHAFT_R + 3.0) continue;
        const fz = stand(nx, ny, z);
        if (fz === null) continue;
        const k = key(nx, ny, fz);
        if (seen.has(k)) continue;
        seen.add(k);
        if (fz < deepest) deepest = fz;
        if (fz <= A.zBot + 2.2) { reached = true; break; }
        queue.push([nx, ny, fz]);
      }
    }
    reached
      ? ok(`walk-bot found a legal descent to z=${deepest.toFixed(1)} (band floor ${A.zBot.toFixed(1)})`)
      : fail(`walk-bot: no legal path below z=${deepest.toFixed(1)} (band floor ${A.zBot.toFixed(1)}, ${expanded} states)`);
  }
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\ncave tests passed');
