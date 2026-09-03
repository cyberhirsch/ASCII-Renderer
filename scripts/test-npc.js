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

const src = ['config', 'util', 'world', 'items', 'chronicle', 'assets', 'lore',
             'npc', 'quest', 'tales']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') +
  '\n({ CFG, CAVES, HIST, Chronicle, Lore, NPC, Quest, Tales, World, ITEMS, ' +
  'terrainH, shaftAt });';
const c = vm.runInNewContext(src, { console, Math, JSON }, { filename: 'under-test' });
const { CFG, NPC, Quest, Tales, Lore, ITEMS } = c;

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

// ---- 5. the chains ----
// Everybody has one, nobody hands over more than one link of it at a time,
// and the fetch-me-five-wood step is gone for good.
{
  let wide = 0, empty = 0, badKind = 0, tooFar = 0, dupIds = 0;
  const kinds = {}, lens = {};
  const ids = new Set();
  for (const n of all) {
    const ch = Quest.chain(n);
    if (!ch.length) empty++;
    lens[ch.length] = (lens[ch.length] || 0) + 1;
    for (const q of ch) {
      kinds[q.kind] = (kinds[q.kind] || 0) + 1;
      if (['seek', 'read', 'ask'].indexOf(q.kind) < 0) badKind++;
      if (ids.has(q.id)) dupIds++;
      ids.add(q.id);
      for (const l of q.ask.concat([q.task])) if (l.length > NPC.WIDTH) wide++;
      if (q.kind === 'seek') {
        const d = Math.hypot(q.x - n.x, q.y - n.y);
        if (d > Quest.SEEK_MAX || d < Quest.SEEK_MIN) tooFar++;
      }
    }
  }
  (empty === 0) ? ok(`everybody has a chain (lengths ${JSON.stringify(lens)})`)
                : fail(`${empty} people have nothing to ask`);
  (badKind === 0) ? ok(`and every step is one the game can check (${JSON.stringify(kinds)})`)
                  : fail(`${badKind} steps are of an unknown kind`);
  (typeof Quest.bring === 'undefined' && typeof Quest.WANT === 'undefined')
    ? ok('and no fetch-quest machinery is left to fall back on')
    : fail('Quest still carries bring/WANT');
  (wide === 0) ? ok('and every word of every step fits the panel')
               : fail(`${wide} quest lines are too wide`);
  (dupIds === 0) ? ok('and no two steps anywhere share an id')
                 : fail(`${dupIds} duplicate step ids`);
  (tooFar === 0) ? ok('and every journey asked for is a journey, not a march')
                 : fail(`${tooFar} seek steps are out of range`);
  // more than one kind, or it is not a chain, it is a repeat
  (Object.keys(kinds).length >= 3)
    ? ok('the chains mix going, reading and asking')
    : fail(`only ${Object.keys(kinds).length} kinds across every chain`);
}

// ---- 5a. one link at a time ----
{
  const n = all.find(x => Quest.chain(x).length >= 3);
  if (!n) { fail('nobody has a chain long enough to test'); }
  else {
    const ch = Quest.chain(n);
    // Quest reads a step's state through Quest.state, which goes to Game
    // when there is a game. There is not one in this suite, so the reader
    // is swapped for a plain map and the chain can be walked by hand.
    const marks = {};
    const realState = Quest.state;
    Quest.state = id => marks[id] || 'none';
    (Quest.at(n) === 0 && Quest.current(n).id === ch[0].id)
      ? ok('a chain starts on its first link') : fail('chain does not start at 0');
    marks[ch[0].id] = 'open';
    (Quest.current(n).id === ch[0].id)
      ? ok('and taking one on does not advance it')
      : fail('an open step advanced the chain');
    marks[ch[0].id] = 'done';
    (Quest.current(n).id === ch[1].id)
      ? ok('finishing one hands over the next')
      : fail('the chain did not advance');
    for (const q of ch) marks[q.id] = 'done';
    (Quest.current(n) === null && Quest.at(n) === ch.length)
      ? ok('and the chain runs out rather than looping')
      : fail('the chain did not end');
    Quest.state = realState;
  }
}

// ---- 5b. the chains interlock ----
{
  const e = NPC.elder();
  let asks = 0, atElder = 0;
  for (const n of all) {
    for (const q of Quest.chain(n)) {
      if (q.kind !== 'ask') continue;
      asks++;
      if (e && q.who === e.id) atElder++;
      if (!Tales.byId(e, q.tale)) fail(`an ask step points at a tale ${q.tale} nobody holds`);
    }
  }
  (asks > 0) ? ok(`${asks} steps send you to somebody else for the answer`)
             : fail('no chain refers to another person');
  (asks === atElder) ? ok('and every one of them names the person who has it')
                     : fail(`${asks - atElder} ask steps point at nobody`);
}

// ---- 5b. the elder, and what they remember ----
{
  const e = NPC.elder();
  e ? ok(`the world has an elder: ${e.name}, ${e.age}`)
    : fail('no elder in a world with people in it');
  if (e) {
    (NPC.all().every(n => n.id === e.id || n.age <= e.age))
      ? ok('and nobody living is older') : fail('somebody is older than the elder');
    (NPC.all().filter(n => n.elder).length === 1)
      ? ok('and there is exactly one of them') : fail('more than one elder');
    (Quest.chain(e).length > 0)
      ? ok('the elder asks things too, and they are about his own memory')
      : fail('the elder has no chain');
    const doubts = Quest.chain(e).filter(q => String(q.key).startsWith('doubt'));
    (doubts.length > 0)
      ? ok(`${doubts.length} of them send you to check a story he is unsure of`)
      : fail('the elder never doubts himself');

    const tales = Tales.forNpc(e);
    (tales.length >= 6) ? ok(`and holds ${tales.length} tales`)
                        : fail(`the elder only holds ${tales.length} tales`);
    (tales[0] && tales[0].id === 'halls')
      ? ok('the first of them is what is under the ground')
      : fail('the elder does not start with the halls');
    // every line of every tale has to fit the panel it is spoken in
    let wide = 0, empty = 0, dup = 0;
    const seen = new Set();
    for (const t of tales) {
      if (!t.body.length) empty++;
      if (seen.has(t.id)) dup++;
      seen.add(t.id);
      for (const l of [t.head].concat(t.body)) if (l.length > NPC.WIDTH) wide++;
    }
    wide === 0 ? ok('and every line of every one of them fits')
               : fail(`${wide} spoken lines are too wide`);
    empty === 0 ? ok('and none of them is an empty tale')
                : fail(`${empty} tales say nothing`);
    dup === 0 ? ok('and none is told twice') : fail(`${dup} tales repeat`);
    // more than one kind of thing is remembered
    const kinds = new Set(tales.map(t => t.kind));
    (kinds.size >= 3) ? ok(`and they are not all of a kind (${[...kinds].join(', ')})`)
                      : fail(`only ${kinds.size} kinds of tale`);
    // told once, they run out rather than repeating for ever
    const heard = [];
    let guard = 0;
    while (guard++ < 100) {
      const t = Tales.next(e, heard);
      if (!t) break;
      heard.push(t.id);
    }
    (heard.length === tales.length)
      ? ok(`hearing them all takes ${heard.length} askings and then stops`)
      : fail(`ran out after ${heard.length} of ${tales.length}`);
    // and the same tales in the same order on a second run
    (JSON.stringify(Tales.forNpc(e).map(t => t.id)) === JSON.stringify(tales.map(t => t.id)))
      ? ok('and it is the same memory twice') : fail('the elder remembers differently');
    // Nobody else tells tales. Compared by id, not by identity: section 2
    // rebuilds the list to check determinism, so `all` and `NPC.all()` hold
    // equal-but-different objects and the old elder would slip through.
    (NPC.all().filter(n => n.id !== e.id).every(n => Tales.forNpc(n).length === 0))
      ? ok('and nobody else claims to remember any of it')
      : fail('somebody who is not the elder is telling tales');
  }
}

// ---- 5c. every tale points somewhere real ----
{
  const e = NPC.elder();
  if (e) {
    let ghosts = 0, placed = 0;
    for (const t of Tales.forNpc(e)) {
      if (t.x === null || t.y === null) continue;
      placed++;
      // inside the region the chronicle actually simulated, with a cell of
      // slack: a grave is recorded to its survey cell, not to the metre
      const half = c.HIST.N * c.HIST.CELL / 2 + c.HIST.CELL;
      if (Math.abs(t.x) > half || Math.abs(t.y) > half) ghosts++;
    }
    (ghosts === 0) ? ok(`${placed} of the tales name a place, all inside the region`)
                   : fail(`${ghosts} tales point outside the world`);
    (placed >= 4) ? ok('and enough of them do to be worth walking for')
                  : fail(`only ${placed} tales name a place`);
  }
}

// ---- 5d. a new game starts beside the one who remembers ----
{
  const e = NPC.elder();
  if (e && c.World) {
    const [sx, sy] = c.World.findSpawn();
    const d = Math.hypot(sx - e.x, sy - e.y);
    (d <= 9.5) ? ok(`you start ${d.toFixed(1)}u from ${e.name} - inside talking range`)
               : fail(`you start ${Math.round(d)}u from the elder`);
    (d > 1.0) ? ok('and beside them, not inside them')
              : fail(`spawn is ${d.toFixed(2)}u away - on top of the person`);
    (c.terrainH(sx, sy) >= CFG.SEA_LEVEL)
      ? ok('and on dry ground') : fail('spawn is in the water');
  }
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
