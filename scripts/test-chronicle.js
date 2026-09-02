// Tests for the chronicle: six thousand years of history, simulated. All of
// it is pure CPU and a pure function of the seed, so all of it is checkable
// here - determinism, chronology, no dangling references, and the promise
// that a building sinking through the centuries never reaches the band kept
// for whatever was here before people.
//
// Usage: node scripts/test-chronicle.js   (exit 0 = clean)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const src = ['config', 'util', 'chronicle']
  .map(f => fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))
  .join('\n') + '\n({ CFG, CAVES, HIST, MATS, Chronicle, terrainH, clamp });';
const c = vm.runInNewContext(src, { console, Math, JSON }, { filename: 'under-test' });
const { CFG, CAVES, HIST, Chronicle } = c;

let failures = 0;
const fail = m => { failures++; console.error('FAIL  ' + m); };
const ok = m => console.log('  ok  ' + m);
const SEEDS = [8151623, 1, 42, 99991, 777777, 12345, 555, 31337];

const runs = {};
const t0 = Date.now();
for (const sd of SEEDS) { CFG.SEED = sd; runs[sd] = Chronicle.run(); }
const ms = (Date.now() - t0) / SEEDS.length;

// ---- 1. determinism ----
// The whole design rests on this: history is derived, never stored, so two
// runs of a seed must agree down to the last abandoned farm.
const strip = S => JSON.stringify({
  peoples: S.peoples, sites: S.sites,
  links: S.links.map(l => ({ a: l.a, b: l.b, built: l.built, path: l.path, bridges: l.bridges })),
  events: S.events, figures: S.figures, wars: S.wars, battles: S.battles,
  artifacts: S.artifacts, deposits: S.deposits, heroes: S.heroes, myth: S.myth,
});
CFG.SEED = 8151623;
const again = Chronicle.run();
(strip(again) === strip(runs[8151623]))
  ? ok('same seed, same history, down to the last farm')
  : fail('chronicle is not deterministic for a fixed seed');

const shapes = new Set(SEEDS.map(sd => strip(runs[sd])));
(shapes.size === SEEDS.length)
  ? ok('different seeds tell different stories')
  : fail('two seeds produced the same chronicle');

// ---- 2. the cast exists and is referred to correctly ----
let dangling = 0, badPeople = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const s of S.sites) {
    if (s.id < 0 || s.id >= S.sites.length) dangling++;
    if (!S.peoples[s.people]) badPeople++;
  }
  for (const l of S.links) {
    if (!S.sites[l.a] || !S.sites[l.b]) dangling++;
    if (l.a === l.b) dangling++;
  }
  for (const e of S.events) {
    if (e.actor !== null && !S.peoples[e.actor]) dangling++;
    if (e.place !== null && e.place !== undefined && !S.sites[e.place]) dangling++;
  }
}
(dangling === 0 && badPeople === 0)
  ? ok('no dangling references: every name in the record exists')
  : fail(`dangling refs: ${dangling}, sites with no people: ${badPeople}`);

// ---- 3. chronology ----
let order = 0, sameYear = 0, beforeRise = 0, unsorted = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const s of S.sites) {
    if (s.abandoned >= 0 && s.abandoned < s.founded) order++;
    if (s.abandoned >= 0 && s.abandoned === s.founded) sameYear++;
    if (s.founded < S.peoples[s.people].rise) beforeRise++;
  }
  for (let i = 1; i < S.events.length; i++) if (S.events[i].t < S.events[i - 1].t) unsorted++;
}
(order === 0) ? ok('nothing is abandoned before it is built')
              : fail(`${order} sites ended before they began`);
(sameYear === 0) ? ok('nothing is founded and lost in the same year')
                 : fail(`${sameYear} sites began and ended in one year`);
(beforeRise === 0) ? ok('no site predates the people who built it')
                   : fail(`${beforeRise} sites predate their people`);
(unsorted === 0) ? ok('the event log runs forward in time')
                 : fail(`${unsorted} events are out of order`);

// ---- 4. everything sits inside the region it was told to use ----
let oob = 0;
const half = HIST.N * HIST.CELL / 2;
for (const sd of SEEDS) for (const s of runs[sd].sites) {
  if (s.i < 0 || s.j < 0 || s.i >= HIST.N || s.j >= HIST.N) oob++;
  if (Math.abs(s.x) > half || Math.abs(s.y) > half) oob++;
}
(oob === 0) ? ok('every site is inside the settled region')
            : fail(`${oob} sites fell outside the region`);

// ---- 5. nobody builds on top of anybody ----
// Two sites that are alive at the same moment must be MIN_SEP apart on at
// least one axis - the rule the founding checks enforce.
let crowded = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (let a = 0; a < S.sites.length; a++) for (let b = a + 1; b < S.sites.length; b++) {
    const x = S.sites[a], y = S.sites[b];
    const lo = Math.max(x.founded, y.founded);
    const hi = Math.min(x.abandoned < 0 ? HIST.SPAN : x.abandoned,
                        y.abandoned < 0 ? HIST.SPAN : y.abandoned);
    if (hi <= lo) continue;                                  // never coexisted
    if (Math.abs(x.i - y.i) < HIST.MIN_SEP && Math.abs(x.j - y.j) < HIST.MIN_SEP) crowded++;
  }
}
(crowded === 0) ? ok('no two living sites share the same ground')
                : fail(`${crowded} pairs of coexisting sites are on top of each other`);

// ---- 6. roads actually connect the things they claim to ----
let broken = 0, gaps = 0, dryBridge = 0, nBridge = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const l of S.links) {
    const a = S.sites[l.a], b = S.sites[l.b];
    if (l.path[0] !== a.j * HIST.N + a.i) broken++;
    if (l.path[l.path.length - 1] !== b.j * HIST.N + b.i) broken++;
    for (let n = 1; n < l.path.length; n++) {
      const p = l.path[n - 1], q = l.path[n];
      const di = Math.abs(q % HIST.N - p % HIST.N);
      const dj = Math.abs(Math.floor(q / HIST.N) - Math.floor(p / HIST.N));
      if (di > 1 || dj > 1) gaps++;
    }
    for (const br of l.bridges) { nBridge++; for (const k of br) if (!S.grid.water[k]) dryBridge++; }
  }
}
(broken === 0) ? ok('every road starts and ends at the site it names')
               : fail(`${broken} road endpoints do not match their sites`);
(gaps === 0) ? ok('roads are continuous - no jumps between cells')
             : fail(`${gaps} discontinuities in road paths`);
(dryBridge === 0) ? ok(`bridges are only ever over water (${nBridge} built)`)
                  : fail(`${dryBridge} bridge cells are on dry land`);

// ---- 7. burial ----
// The load-bearing promise: the whole record stays within spade depth. If
// this fails, history has grown down into the caves, which belong to
// whatever was here before people.
const FLOOR = HIST.SINK_MAX;
let deepest = 0, roofedSink = 0, notMono = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const s of S.sites) {
    if (s.abandoned < 0) continue;
    deepest = Math.max(deepest, Chronicle.sink(S, s, S.now));
    // still roofed means still on the surface
    const justRoofless = s.abandoned + Chronicle.roofYears(s);
    if (Chronicle.sink(S, s, justRoofless - 1) !== 0) roofedSink++;
    let prev = -1;
    for (let y = s.abandoned; y <= HIST.SPAN; y += 25) {
      const v = Chronicle.sink(S, s, y);
      if (v < prev - 1e-9) notMono++;
      prev = v;
    }
  }
}
(deepest <= FLOOR)
  ? ok(`deepest ruin ${deepest.toFixed(2)} m, inside the ${FLOOR} m the record is allowed`)
  : fail(`a ruin reached ${deepest.toFixed(2)} m, below the ${FLOOR} m floor`);
(deepest > FLOOR * 0.5)
  ? ok(`and the column is used: the oldest ruins reach ${deepest.toFixed(2)} m`)
  : fail(`nothing gets deeper than ${deepest.toFixed(2)} m - depth stopped telling the date`);
(roofedSink === 0) ? ok('nothing sinks while it still has a roof')
                   : fail(`${roofedSink} sites started sinking before losing the roof`);
(notMono === 0) ? ok('burial only ever goes downward')
                : fail(`${notMono} samples where a ruin rose back up`);

// ---- 8. ruin stage runs one way too ----
let stageBack = 0, liveStage = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const s of S.sites) {
    if (s.abandoned < 0) { if (Chronicle.stage(S, s, S.now) !== 0) liveStage++; continue; }
    let prev = -1;
    for (let y = s.abandoned; y <= HIST.SPAN; y += 25) {
      const st = Chronicle.stage(S, s, y);
      if (st < prev) stageBack++;
      prev = st;
    }
  }
}
(stageBack === 0) ? ok('a ruin never repairs itself')
                  : fail(`${stageBack} samples where decay ran backwards`);
(liveStage === 0) ? ok('a living site is never a ruin')
                  : fail(`${liveStage} living sites report as ruined`);

// ---- 9. how a place ended decides what is left in it ----
// The deposition pass will read `sudden`, so it has to agree with the cause.
let mismatched = 0;
const SUDDEN = ['sacked', 'flood', 'plague', 'the deep'];
for (const sd of SEEDS) for (const s of runs[sd].sites) {
  if (s.abandoned < 0) continue;
  if (s.sudden !== SUDDEN.includes(s.cause)) mismatched++;
}
(mismatched === 0) ? ok('sudden endings are flagged as sudden, slow ones are not')
                   : fail(`${mismatched} sites disagree with their own cause of death`);

// ---- 10. the world is worth walking into ----
let empty = 0, noFall = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  if (S.sites.filter(s => s.abandoned < 0).length === 0) empty++;
  if (S.peoples.every(p => p.fell < 0)) noFall++;
}
(noFall === 0) ? ok('every seed produces at least one fallen people to dig up')
               : fail(`${noFall} seeds ended with nothing ruined`);
console.log(`  --  ${empty}/${SEEDS.length} seeds have no living settlement at year ${HIST.SPAN}`);
let noPeople = 0;
for (const sd of SEEDS) if (runs[sd].peoples.every(p => p.fell >= 0)) noPeople++;
console.log(`  --  ${noPeople}/${SEEDS.length} seeds end with every people fallen ` +
            `(a present of holdouts among ruins)`);

// ---- 12. individuals ----
// Nobody should be in the record without having done something, and nobody
// should outlive their own birth.
let overcast = 0, badLife = 0, noHome = 0, idle = 0, badPeople2 = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  if (S.figures.length > HIST.MAX_FIGURES) overcast++;
  for (const f of S.figures) {
    if (f.died >= 0 && f.died < f.born) badLife++;
    if (!S.sites[f.home]) noHome++;
    if (!S.peoples[f.people]) badPeople2++;
    if (!f.deeds.length && f.role === 'lord') idle++;   // a lord always takes a seat
  }
}
(overcast === 0) ? ok(`the cast stays within ${HIST.MAX_FIGURES}`)
                 : fail(`${overcast} seeds exceeded the figure cap`);
(badLife === 0) ? ok('nobody dies before they are born')
                : fail(`${badLife} figures died before birth`);
(noHome === 0 && badPeople2 === 0) ? ok('every figure belongs to a real people and place')
                                   : fail(`${noHome} homeless, ${badPeople2} peopleless figures`);
(idle === 0) ? ok('every named lord has at least one deed to their name')
             : fail(`${idle} lords did nothing`);

// a people that is standing has somebody at the head of it
let headless = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const p of S.peoples) {
    if (!p.founded) continue;
    const end = p.fell < 0 ? HIST.SPAN : p.fell;
    for (let y = p.rise + 50; y < end; y += 250) {
      const l = p.leader === undefined ? null : S.figures[p.leader];
      if (!l) { headless++; break; }
    }
  }
}
(headless === 0) ? ok('a standing people always has somebody at its head')
                 : fail(`${headless} peoples went headless`);

// the cap must not merely be respected, it must not be reached - a starved
// cast is a people with nobody at the head of it
let pinned = 0;
for (const sd of SEEDS) if (runs[sd].figures.length >= HIST.MAX_FIGURES) pinned++;
(pinned === 0) ? ok('no seed runs out of names (largest cast ' +
                    Math.max(...SEEDS.map(sd => runs[sd].figures.length)) +
                    ` of ${HIST.MAX_FIGURES})`)
               : fail(`${pinned} seeds hit the figure cap and starved the cast`);

// ---- 12b. going out ----
// The rule that makes exploring matter: a people settles only where somebody
// has actually been. Capitals are the exception - that is where they arrived.
let unknownGround = 0, idleWalker = 0, closeColony = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const s of S.sites) {
    const p2 = S.peoples[s.people];
    if (s.id === p2.capital) continue;
    if (!S.known[s.people][s.j * HIST.N + s.i]) unknownGround++;
  }
  for (const f of S.figures) {
    if (f.role === 'explorer' && !f.deeds.length) idleWalker++;
  }
}
(unknownGround === 0) ? ok('nothing is settled on ground nobody had walked')
                      : fail(`${unknownGround} sites were built on unseen ground`);
(idleWalker === 0) ? ok('every explorer went somewhere')
                   : fail(`${idleWalker} explorers never walked`);

// the whole point of settlers: the record must not happen in one valley
let tight = 0, cover = [];
for (const sd of SEEDS) {
  const S = runs[sd];
  const xs = S.sites.map(s => s.i), ys = S.sites.map(s => s.j);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  cover.push(Math.round(100 * w * h / (HIST.N * HIST.N)));
  if (w < HIST.N * 0.35 || h < HIST.N * 0.35) tight++;
}
(tight === 0)
  ? ok(`settlement spreads across the region (covers ${Math.min(...cover)}-${Math.max(...cover)}% of it)`)
  : fail(`${tight} seeds kept the whole record in one corner`);

// ---- 13. wars and battles ----
let selfWar = 0, warOrder = 0, battleOut = 0, wetField = 0, badCmd = 0, unresolved = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const w of S.wars) {
    if (w.a === w.b) selfWar++;
    if (w.ended >= 0 && w.ended < w.began) warOrder++;
    // a war whose declarer died must still have been closed out
    if (w.ended < 0 && S.peoples[w.a].fell >= 0 && S.peoples[w.b].fell >= 0) unresolved++;
  }
  for (const b of S.battles) {
    const w = S.wars[b.war];
    if (b.t < w.began || (w.ended >= 0 && b.t > w.ended)) battleOut++;
    if (b.winner !== b.a && b.winner !== b.b) battleOut++;
    if (S.grid.water[b.j * HIST.N + b.i]) wetField++;
    if (b.cmdWin !== null && S.figures[b.cmdWin].people !== b.winner) badCmd++;
    if (b.cmdLose !== null && S.figures[b.cmdLose].people === b.winner) badCmd++;
  }
}
(selfWar === 0 && warOrder === 0) ? ok('no people fought itself, no war ended before it began')
                                  : fail(`${selfWar} self-wars, ${warOrder} inverted wars`);
(unresolved === 0) ? ok('no war outlives both the peoples fighting it')
                   : fail(`${unresolved} wars never ended though both sides are gone`);
(battleOut === 0) ? ok('every battle sits inside its war and has a real winner')
                  : fail(`${battleOut} battles fall outside their war`);
(wetField === 0) ? ok('nobody fights a battle in the lake')
                 : fail(`${wetField} battles were fought on water`);
(badCmd === 0) ? ok('commanders fight for their own side')
               : fail(`${badCmd} commanders were on the wrong side`);

// ---- 14. things, and where they end up ----
// The conservation rule the deposition pass depends on: an object is in
// exactly one place - resting in the ground, or in the hands of somebody
// who is still alive to be holding it.
let nowhere = 0, twice = 0, madeLate = 0, badClass = 0, restOut = 0;
const CLASSES = ['weapon', 'armour', 'wear', 'tool', 'vessel'];
for (const sd of SEEDS) {
  const S = runs[sd];
  const holder = new Map();
  for (const f of S.figures) for (const a of f.holds) {
    if (holder.has(a)) twice++;
    holder.set(a, f);
  }
  for (const a of S.artifacts) {
    if (!CLASSES.includes(a.cls)) badClass++;
    if (a.rest && a.rest.t < a.made) madeLate++;
    for (const o of a.owners) if (o.from < a.made) madeLate++;
    const held = holder.get(a.id);
    if (a.rest && held) twice++;
    if (!a.rest && !(held && held.died < 0)) nowhere++;
    if (a.rest && (a.rest.i < 0 || a.rest.i >= HIST.N ||
                   a.rest.j < 0 || a.rest.j >= HIST.N)) restOut++;
  }
}
(badClass === 0) ? ok('every made thing is a weapon, armour, something worn, a tool or a vessel')
                 : fail(`${badClass} artifacts have no class`);
// all five kinds of thing must actually get made, or a class is dead weight
let missing = 0, tally = {};
for (const sd of SEEDS) {
  const seen = new Set(runs[sd].artifacts.map(a => a.cls));
  for (const c of CLASSES) if (!seen.has(c)) missing++;
  for (const a of runs[sd].artifacts) tally[a.cls] = (tally[a.cls] || 0) + 1;
}
(missing === 0) ? ok(`every class gets made: ${JSON.stringify(tally)}`)
                : fail(`${missing} class/seed combinations produced nothing`);
(nowhere === 0) ? ok('nothing made has vanished - each thing rests somewhere or is held')
                : fail(`${nowhere} artifacts exist nowhere at all`);
(twice === 0) ? ok('nothing is in two places at once')
              : fail(`${twice} artifacts are both held and buried`);
(madeLate === 0) ? ok('nothing is owned or buried before it was made')
                 : fail(`${madeLate} artifacts predate themselves`);
(restOut === 0) ? ok('everything that rests, rests inside the region')
                : fail(`${restOut} artifacts rest outside the map`);

// ---- 15. what is in the ground ----
let depDeep = 0, robBack = 0, robSelf = 0, badRef = 0, deepestDep = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const d of S.deposits) {
    const z = Chronicle.depositDepth(S, d, S.now);
    deepestDep = Math.max(deepestDep, z);
    if (z > FLOOR) depDeep++;
    if (d.robbed >= 0 && d.robbed < d.t) robBack++;
    if (d.robbed >= 0 && d.robbedBy === d.people) robSelf++;
    if (!S.peoples[d.people]) badRef++;
    if (d.figure !== null && !S.figures[d.figure]) badRef++;
    if (d.artifact !== null && !S.artifacts[d.artifact]) badRef++;
  }
}
(depDeep === 0)
  ? ok(`deepest deposit ${deepestDep.toFixed(2)} m, still within spade depth`)
  : fail(`${depDeep} deposits sank past the ${FLOOR} m floor`);
(robBack === 0) ? ok('nothing is robbed before it is buried')
                : fail(`${robBack} deposits were robbed before they existed`);
(robSelf === 0) ? ok('nobody robs their own dead')
                : fail(`${robSelf} peoples robbed their own graves`);
(badRef === 0) ? ok('every deposit names a real people, figure and thing')
               : fail(`${badRef} deposits point at nothing`);

// ---- 16. heroes are recognised, not declared ----
let badRenown = 0, noEpithet = 0, weakHero = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const f of S.figures) if (f.renown !== Chronicle.renownOf(f)) badRenown++;
  for (const id of S.heroes) {
    const f = S.figures[id];
    if (!f.epithet) noEpithet++;
    if (f.renown < HIST.HERO_MIN) weakHero++;
  }
}
(badRenown === 0) ? ok('renown is a count of deeds, not a stored opinion')
                  : fail(`${badRenown} figures disagree with their own record`);
(noEpithet === 0 && weakHero === 0) ? ok('every hero is named for something they did')
                                    : fail(`${noEpithet} unnamed, ${weakHero} undeserving heroes`);

// ---- 16b. what is remembered, and why ----
let badFame = 0, noTitle = 0, ghostLegend = 0, fewHeroes = 0, fewLegends = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  const heroSet = new Set(S.heroes);
  for (const a of S.artifacts) if (a.fame !== Chronicle.fameOf(S, a, heroSet)) badFame++;
  for (const id of S.legends) {
    const a = S.artifacts[id];
    if (!a) { ghostLegend++; continue; }
    if (!a.title) noTitle++;
  }
  // the legends must be the famous ones, not an arbitrary slice
  const cut = S.legends.length ? S.artifacts[S.legends[S.legends.length - 1]].fame : 0;
  for (const a of S.artifacts)
    if (!S.legends.includes(a.id) && a.fame > cut) ghostLegend++;
  if (S.heroes.length < 8) fewHeroes++;
  if (S.legends.length < 8) fewLegends++;
}
(badFame === 0) ? ok("a thing's fame is a count of what happened to it")
                : fail(`${badFame} artifacts disagree with their own history`);
(noTitle === 0) ? ok('every remembered thing is remembered for something')
                : fail(`${noTitle} legends have no story attached`);
(ghostLegend === 0) ? ok('the legends are the most storied things, in order')
                    : fail(`${ghostLegend} legends are out of order or not real`);
(fewHeroes === 0 && fewLegends === 0)
  ? ok(`every world remembers people and things ` +
       `(${Math.min(...SEEDS.map(sd => runs[sd].heroes.length))}-` +
       `${Math.max(...SEEDS.map(sd => runs[sd].heroes.length))} named, ` +
       `${Math.min(...SEEDS.map(sd => runs[sd].legends.length))}-` +
       `${Math.max(...SEEDS.map(sd => runs[sd].legends.length))} things)`)
  : fail(`${fewHeroes} seeds remember too few people, ${fewLegends} too few things`);

// hoards are the classic treasure context: hidden in a bad year by somebody
// who did not live to come back for it
let hoardArt = 0;
for (const sd of SEEDS) hoardArt += runs[sd].artifacts.filter(a => a.rest && a.rest.how === 'hoard').length;
console.log(`  --  ${hoardArt} named things lie in hoards across ${SEEDS.length} seeds`);

// ---- 16c. the record has to read as a record ----
// These are all regressions that passed every structural test while making
// the output monotonous or physically silly. Shape is checkable too.
let flatTitle = 0, roleHeavy = 0, clash = 0, dupField = 0, fieldTot = 0, cheapest = 1e9;
const allTitles = {}, allRoles = {};
for (const sd of SEEDS) {
  const S = runs[sd];
  // no single title may swallow the list
  const byTitle = {};
  for (const id of S.legends) {
    const ti = S.artifacts[id].title;
    byTitle[ti] = (byTitle[ti] || 0) + 1;
  }
  const worst = Math.max(0, ...Object.values(byTitle));
  // Two different failures. A world can honestly have one dominant story -
  // a single lord who looted his predecessor's graves - so the share is
  // bounded loosely. But a world with only a handful of distinct stories is
  // flat however the shares fall, and that is the tighter of the two.
  if (S.legends.length &&
      (worst > S.legends.length * 0.7 || Object.keys(byTitle).length < 5)) flatTitle++;
  for (const k in byTitle) allTitles[k] = (allTitles[k] || 0) + byTitle[k];
  // nor may one role swallow the people who are remembered
  const byRole = {};
  for (const id of S.heroes) {
    const r = S.figures[id].role;
    byRole[r] = (byRole[r] || 0) + 1;
  }
  // A peaceful world genuinely remembers its walkers rather than its
  // soldiers, so per world the bound is only that it is not one trade
  // absolutely. The aggregate below is where a systematic bias would show.
  if (S.heroes.length && Object.keys(byRole).length < 2) roleHeavy++;
  for (const k in byRole) allRoles[k] = (allRoles[k] || 0) + byRole[k];
  // nobody is named after their own people
  const pn = new Set(S.peoples.map(p => p.name));
  for (const f of S.figures) if (pn.has(f.name)) clash++;
  for (const s of S.sites) if (pn.has(s.name)) clash++;
  // battles are named for where they happened, so they mostly differ
  const seenField = new Set();
  for (const b of S.battles) {
    fieldTot++;
    if (seenField.has(b.name)) dupField++;
    seenField.add(b.name);
  }
  // road bundling discounts a cell once; it must never compound away
  for (let k = 0; k < S.grid.cost.length; k++)
    if (S.grid.cost[k] < cheapest) cheapest = S.grid.cost[k];
}
(flatTitle === 0) ? ok('no single story swallows any one world\'s legends')
                  : fail(`${flatTitle} seeds where one title covers most of the legends`);
(roleHeavy === 0) ? ok('the people remembered in a world are not all of one trade')
                  : fail(`${roleHeavy} seeds where one role is almost all the heroes`);

// Across every world: neither the labels nor the trades may be systematically
// lopsided. This is the check that would have caught "202 of 288 legends say
// the same thing" and "79% of everyone remembered is a smith".
const titleN = Object.values(allTitles).reduce((a, b) => a + b, 0);
const titleTop = Math.max(...Object.values(allTitles));
const roleN = Object.values(allRoles).reduce((a, b) => a + b, 0);
const roleTop = Math.max(...Object.values(allRoles));
(Object.keys(allTitles).length >= 20 && titleTop < titleN * 0.25)
  ? ok(`${Object.keys(allTitles).length} distinct stories across all worlds, ` +
       `commonest is ${Math.round(100 * titleTop / titleN)}% of them`)
  : fail(`only ${Object.keys(allTitles).length} distinct titles, commonest ` +
         `${Math.round(100 * titleTop / titleN)}% - the list has gone flat`);
(roleTop < roleN * 0.6)
  ? ok(`no trade dominates who is remembered (${JSON.stringify(allRoles)})`)
  : fail(`one role is ${Math.round(100 * roleTop / roleN)}% of everyone remembered: ` +
         JSON.stringify(allRoles));
(clash === 0) ? ok('no person or place carries the name of a people')
              : fail(`${clash} names collide with a people's own name`);
(dupField < fieldTot * 0.2)
  ? ok(`battles are named for their ground (${dupField}/${fieldTot} repeat a name)`)
  : fail(`${dupField}/${fieldTot} battles reuse a name`);
(cheapest >= HIST.ROAD_DISCOUNT * 0.9)
  ? ok(`road bundling discounts a cell once (cheapest cell ${cheapest.toFixed(2)})`)
  : fail(`road cost compounded to ${cheapest.toExponential(1)} - a corridor no terrain can compete with`);

// ---- 16d. what survives being left ----
// Gold comes up as it went down and iron does not, so the same six thousand
// years leaves quite different amounts of each people behind.
let condRange = 0, goldRot = 0, ironKept = 0, condUp = 0, overBuried = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  for (const a of S.artifacts) {
    const c = Chronicle.condition(S, a, S.now);
    if (!(c >= 0 && c <= 1)) condRange++;
    if (a.mat === 'gold' && c < 0.999) goldRot++;
    const buried = Chronicle.buriedYears(S, a, S.now);
    if (buried > S.now - a.made + 1) overBuried++;
    if (a.mat === 'iron' && buried > 3000 && c > 0.1) ironKept++;
    // decay only ever runs one way
    let prev = 2;
    for (let y = a.made; y <= HIST.SPAN; y += 200) {
      const v = Chronicle.condition(S, a, y);
      if (v > prev + 1e-9) condUp++;
      prev = v;
    }
  }
}
(condRange === 0) ? ok('condition stays between as-made and gone')
                  : fail(`${condRange} artifacts have an impossible condition`);
(overBuried === 0) ? ok('nothing has been in the ground longer than it has existed')
                   : fail(`${overBuried} artifacts were buried before they were made`);
(goldRot === 0) ? ok('gold comes up exactly as it went down')
                : fail(`${goldRot} gold artifacts corroded`);
(ironKept === 0) ? ok('iron left in the ground for millennia does not survive whole')
                 : fail(`${ironKept} iron artifacts survived 3000 years intact`);
(condUp === 0) ? ok('nothing in the ground repairs itself')
               : fail(`${condUp} samples where condition improved`);
{
  const words = {};
  for (const sd of SEEDS) for (const a of runs[sd].artifacts)
    words[Chronicle.conditionWord(Chronicle.condition(runs[sd], a, runs[sd].now))] =
      (words[Chronicle.conditionWord(Chronicle.condition(runs[sd], a, runs[sd].now))] || 0) + 1;
  console.log(`  --  what is left at year ${HIST.SPAN}: ${JSON.stringify(words)}`);
}

// ---- 16e. the height of the world, and losing it ----
// One people is the peak: it works steel, and when it goes the craft goes
// with it. Everything downstream of that follows without being written down
// - most of all that steel found in a later grave was taken out of an
// earlier one, because there is no other way for it to have got there.
let steelMakers = new Set(), lateSteel = 0, tradedSteel = 0, noLoss = 0;
let steelCond = 0, steelN = 0, ironCond = 0, ironN = 0, peakSmall = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  const peak = S.peoples.find(p => p.metal === 'steel');
  for (const a of S.artifacts) {
    const c = Chronicle.condition(S, a, S.now);
    if (a.mat === 'steel') {
      steelMakers.add(S.peoples[a.people].kind);
      steelCond += c; steelN++;
      if (peak && peak.fell >= 0 && a.made > peak.fell) lateSteel++;
      // a later people can only have got it out of the ground
      const outsider = a.owners.find(o => o.who !== null && S.figures[o.who].people !== a.people);
      if (outsider && !a.owners.some(o => o.how === 'taken out of the ground by')) tradedSteel++;
    }
    if (a.mat === 'iron') { ironCond += c; ironN++; }
  }
  if (!S.events.some(e => e.action === 'lost the craft' && e.cause === 'steel')) noLoss++;
  // the peak really has to be the peak
  const sizes = S.peoples.map(p => p.sites.length);
  if (peak && peak.sites.length < Math.max(...sizes)) peakSmall++;
}
(steelMakers.size === 1) ? ok(`steel is worked by one people only (${[...steelMakers][0]})`)
                         : fail(`steel made by ${steelMakers.size} different peoples`);
(lateSteel === 0) ? ok('nobody makes steel after the people who could are gone')
                  : fail(`${lateSteel} steel things were made after the craft was lost`);
(tradedSteel === 0)
  ? ok('steel in a later people\'s hands always came out of a grave')
  : fail(`${tradedSteel} steel artifacts reached another people without being dug up`);
(noLoss === 0) ? ok('every world records the loss of the craft')
               : fail(`${noLoss} seeds never noted steel being lost`);
(steelN && ironN && steelCond / steelN > ironCond / ironN * 1.4)
  ? ok(`steel outlasts iron in the ground ` +
       `(${(steelCond / steelN).toFixed(2)} against ${(ironCond / ironN).toFixed(2)})`)
  : fail(`steel does not outlast iron: ${(steelCond / steelN).toFixed(2)} vs ${(ironCond / ironN).toFixed(2)}`);
(peakSmall <= SEEDS.length * 0.35)
  ? ok(`the peak people is the largest in ${SEEDS.length - peakSmall}/${SEEDS.length} worlds`)
  : fail(`the peak people is not actually the height of the world (${peakSmall} seeds)`);

// ---- 16f. the shape of the succession ----
// Peak, then a long way down, then the people the game is played in - which
// is the one thing about this record that must be true in every world.
let noPlayer = 0, deadPlayer = 0, badIndex = 0, quietAggressor = 0, phantomLoss = 0;
let quietWars = 0, otherWars = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  const mine = S.peoples.filter(p => p.player);
  if (mine.length !== 1) noPlayer++;
  else {
    if (mine[0].fell >= 0) deadPlayer++;
    if (S.player !== mine[0].id) badIndex++;
  }
  const quiet = S.peoples.find(p => p.warlike < 0.5);
  for (const w of S.wars) {
    if (quiet && w.a === quiet.id) quietWars++; else otherWars++;
  }
  // a craft is only "lost" if nobody ever works it again
  for (const e of S.events) {
    if (e.action !== 'lost the craft') continue;
    if (S.peoples.some(q => q.metal === e.cause && (q.fell < 0 || q.fell > e.t) &&
                            q.id !== e.actor)) phantomLoss++;
  }
}
(noPlayer === 0) ? ok('every world has exactly one people to play in')
                 : fail(`${noPlayer} seeds have no single player people`);
(deadPlayer === 0) ? ok('the people you are in is still standing at the present')
                   : fail(`${deadPlayer} seeds ended with the player's people fallen`);
(badIndex === 0) ? ok('the record points at which people is yours')
                 : fail(`${badIndex} seeds have S.player pointing at the wrong people`);
(quietWars * 4 < otherWars)
  ? ok(`the quiet folk start few wars (${quietWars} against ${otherWars} by everyone else)`)
  : fail(`the quiet folk declared ${quietWars} of ${quietWars + otherWars} wars`);
(phantomLoss === 0) ? ok('a craft is only recorded lost if nobody works it again')
                    : fail(`${phantomLoss} crafts were mourned and then practised again`);

// ---- 17. the world produced a history worth digging ----
let noWar = 0, noArt = 0, noRob = 0;
for (const sd of SEEDS) {
  const S = runs[sd];
  if (!S.battles.length) noWar++;
  if (!S.artifacts.length) noArt++;
  if (!S.deposits.some(d => d.robbed >= 0)) noRob++;
}
(noArt === 0) ? ok('every seed made things') : fail(`${noArt} seeds made nothing`);
// A world whose peoples never happened to meet is legitimate history, not a
// bug, so this is reported rather than asserted.
console.log(`  --  ${noWar}/${SEEDS.length} seeds where the peoples never fought`);
console.log(`  --  ${noRob}/${SEEDS.length} seeds where nobody ever robbed a grave`);

// ---- 16g. the map viewer draws in the game's own type ----
// The glyph sheet is rasterized from one font stack in js/webgpu/atlas.js.
// The chronicle screen is meant to be the same screen, so a change to one
// that is not made to the other should fail here rather than quietly drift -
// the same reasoning as the shared-constant checks in scripts/verify.js.
{
  const atlas = fs.readFileSync(path.join(root, 'js', 'webgpu', 'atlas.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'history.html'), 'utf8');
  const norm = s => s.replace(/["'\s]/g, '').toLowerCase();
  const aFont = /ctx\.font\s*=\s*`bold [^`]*?px\s*([^`]+)`/.exec(atlas);
  const vFont = /--mono:\s*([^;]+);/.exec(page);
  const aBold = /ctx\.font\s*=\s*`bold /.test(atlas);
  const vBold = /#ascii\s*\{[^}]*font:\s*bold /.test(page);
  (aFont && vFont && norm(aFont[1]) === norm(vFont[1]))
    ? ok(`the screen uses the game's own type (${aFont[1].trim()})`)
    : fail(`font stacks differ - atlas: ${aFont && aFont[1]}, viewer: ${vFont && vFont[1]}`);
  (aBold && vBold)
    ? ok('and the same weight the atlas rasterizes at')
    : fail(`weight differs - atlas bold: ${aBold}, viewer bold: ${vBold}`);
  // the screen must derive its cell aspect from the renderer's constants
  (/CFG\.CELL_H\s*\/\s*CFG\.CELL_W/.test(page))
    ? ok('and derives its cell aspect from CFG.CELL_H / CFG.CELL_W')
    : fail('the screen hardcodes a cell aspect instead of deriving it');
}

// ---- 11. load budget ----
// It runs before the first frame, so it competes with the boot screen.
(ms < 400) ? ok(`chronicle runs in ${ms.toFixed(0)} ms, inside the 400 ms load budget`)
           : fail(`chronicle took ${ms.toFixed(0)} ms, over the 400 ms budget`);

console.log(failures ? `\n${failures} failing` : '\nall clean');
process.exit(failures ? 1 : 0);
