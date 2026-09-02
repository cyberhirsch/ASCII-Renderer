// Tests for the people who are still here, and what they want.
//
// The promises worth checking are the ones that make a person believable:
// that they belong to a people who has not ended, that everything they say
// happened, that what they ask for can actually be done, and that asking
// twice gets the same answer.
//
// Usage: node scripts/test-npc.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const src = ['config', 'util', 'items', 'chronicle', 'assets', 'lore', 'npc', 'quest']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, HIST, Chronicle, Lore, NPC, Quest, ITEMS, terrainH });';
const c = vm.runInNewContext(src, { console, Math, JSON }, { filename: 'under-test' });
const { CFG, NPC, Quest, Lore, ITEMS } = c;

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);
const note = m => console.log('  --  ' + m);

const SEEDS = [8151623, 42, 99991, 12345, 777777];

// ---- 1. who is alive, and why ----
{
  let empty = 0, dead = 0, ruined = 0, total = 0;
  for (const sd of SEEDS) {
    CFG.SEED = sd;
    Lore.S = null; NPC._all = null;
    const S = Lore.init();
    const all = NPC.all();
    total += all.length;
    if (!all.length) empty++;
    for (const n of all) {
      const p = S.peoples[n.people];
      const site = S.sites[n.site];
      if (!p || p.fell >= 0) dead++;          // nobody speaks for a fallen people
      if (!site || site.abandoned >= 0) ruined++;
    }
  }
  (empty === 0) ? ok(`every world has somebody in it (${total} across ${SEEDS.length})`)
                : fail(`${empty} worlds are empty of people`);
  (dead === 0) ? ok('nobody speaks for a people that has already ended')
               : fail(`${dead} people belong to a fallen people`);
  (ruined === 0) ? ok('and nobody is standing in a ruin')
                 : fail(`${ruined} people live in abandoned sites`);
}

CFG.SEED = 8151623;
Lore.S = null; NPC._all = null;
const S = Lore.init();
const all = NPC.all();

// ---- 2. the same world puts the same people in the same doorways ----
{
  const a = JSON.stringify(all);
  NPC._all = null;
  const b = JSON.stringify(NPC.all());
  (a === b) ? ok('the same seed stands the same people in the same places')
            : fail('who is where is not deterministic');
}

// ---- 3. they stand on the ground, near their own settlement ----
{
  let off = 0, far = 0;
  for (const n of all) {
    if (Math.abs(n.z - c.terrainH(n.x, n.y)) > 1e-9) off++;
    const site = S.sites[n.site];
    if (Math.hypot(n.x - site.x, n.y - site.y) > NPC.RING * 1.6) far++;
  }
  (off === 0) ? ok('everybody is standing on the ground they are on')
              : fail(`${off} people float`);
  (far === 0) ? ok('and inside their own settlement, not out in a field')
              : fail(`${far} people stand outside their own place`);
}

// ---- 4. everything they say happened ----
{
  let bad = 0, wide = 0, years = 0;
  for (const n of all) {
    const p = S.peoples[n.people];
    for (const l of NPC.greet(n)) {
      if (typeof l !== 'string' || l.includes('undefined') || l.includes('null')) bad++;
      if (l.length > NPC.WIDTH) wide++;
      const m = /^\s*(\d+)\s\s/.exec(l);
      if (m) {
        const to = p.fell >= 0 ? p.fell : S.now;
        if (+m[1] < p.rise || +m[1] > to) years++;
      }
    }
  }
  (bad === 0) ? ok('nothing anybody says is unfinished') : fail(`${bad} broken lines`);
  (wide === 0) ? ok(`and all of it fits the panel (${NPC.WIDTH} wide)`)
               : fail(`${wide} lines run past the panel`);
  (years === 0) ? ok('and every year quoted is one their people lived through')
                : fail(`${years} lines quote a year outside their people's life`);
}

// ---- 5. what they want ----
{
  let none = 0, badItem = 0, wide = 0;
  const kinds = {};
  for (const n of all) {
    const q = Quest.forNpc(n);
    if (!q) { none++; continue; }
    kinds[q.kind] = (kinds[q.kind] || 0) + 1;
    if (q.kind === 'bring') {
      if (!ITEMS[q.item] || !ITEMS[q.give]) badItem++;
      if (q.need < 1 || q.paid < 1) badItem++;
    }
    for (const l of q.ask.concat([q.task])) if (l.length > NPC.WIDTH) wide++;
  }
  (none === 0) ? ok(`everybody wants something (${JSON.stringify(kinds)})`)
               : fail(`${none} people want nothing`);
  (badItem === 0) ? ok('and every trade names real items in real amounts')
                  : fail(`${badItem} trades are malformed`);
  (wide === 0) ? ok('and every word of it fits the panel')
               : fail(`${wide} quest lines are too wide`);
  (Object.keys(kinds).length > 1) ? ok('more than one kind of thing is asked')
                                  : fail('every quest is the same kind');
}

// ---- 6. asking twice gets the same answer ----
{
  let drift = 0;
  for (const n of all) {
    if (JSON.stringify(Quest.forNpc(n)) !== JSON.stringify(Quest.forNpc(n))) drift++;
  }
  (drift === 0) ? ok('a person wants the same thing when you come back')
                : fail(`${drift} quests change between askings`);
}

// ---- 7. a journey you can actually make ----
// A bearing with no map behind it is only fair if the walk is a walk. At
// 4.2 units a second the far end of the range is about two minutes out.
{
  let tooFar = 0, tooNear = 0, n = 0;
  let worst = 0;
  for (const who of all) {
    const q = Quest.forNpc(who);
    if (!q || q.kind !== 'seek') continue;
    n++;
    const d = Math.hypot(q.x - who.x, q.y - who.y);
    if (d > Quest.SEEK_MAX) tooFar++;
    if (d < Quest.SEEK_MIN) tooNear++;
    if (d > worst) worst = d;
  }
  (tooFar === 0 && tooNear === 0)
    ? ok(`every place sent to is a walk, not a march (${n} of them, furthest ${Math.round(worst)}u)`)
    : fail(`${tooFar} too far, ${tooNear} too near`);
  note(`furthest is about ${Math.round(worst / 4.2)} seconds of walking each way`);
}

// ---- 8. the place they send you to is really there ----
{
  let ghosts = 0, n = 0;
  for (const who of all) {
    const q = Quest.forNpc(who);
    if (!q || q.kind !== 'seek') continue;
    n++;
    const atSite = S.sites.some(s => Math.abs(s.x - q.x) < 0.01 && Math.abs(s.y - q.y) < 0.01);
    const atField = S.battles.some(b => Math.abs(b.x - q.x) < 0.01 && Math.abs(b.y - q.y) < 0.01);
    if (!atSite && !atField) ghosts++;
  }
  (ghosts === 0) ? ok(`every place named is one the record put there (${n} checked)`)
                 : fail(`${ghosts} quests point at nothing`);
}

// ---- 9. you can be spoken to ----
{
  // by id, not by identity: the list is rebuilt above and these are fresh
  // objects describing the same people
  const n = NPC.all()[0];
  const found = NPC.near(n.x, n.y, 1);
  (found && found.id === n.id) ? ok('somebody underfoot is found')
                               : fail('near() missed a person at their own feet');
  (NPC.near(n.x + 500, n.y + 500, NPC.REACH) === null)
    ? ok('and nobody is found across the map')
    : fail('near() reached across the world');
  const fig = NPC.parts(n);
  (fig.length > 4) ? ok(`a person is ${fig.length} primitives`)
                   : fail('the figure has no body');
  let onGround = true;
  for (const p of fig) {
    const z = (p.k === 'cyl' || p.k === 'cone') ? p.z0 : p.c[2];
    if (z < n.z - 0.6) onGround = false;
  }
  onGround ? ok('and stands on the ground rather than in it')
           : fail('the figure is sunk into the terrain');
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nnpc tests passed');
