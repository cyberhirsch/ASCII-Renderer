// The chronicle: six thousand years of people on this ground, run rather
// than written. Six peoples rise in turn, settle where the ground is
// worth settling, cut roads between what they build, quarrel, fail, and
// leave. Every ruin the game finds is the residue of something that
// happened here, on a date, for a reason.
//
// Pure CPU and a pure function of CFG.SEED - no DOM, no storage, no clock.
// Two runs of a seed agree down to the last abandoned farm, so the record
// costs nothing on disk and nothing on the wire.
//
// The sim stores only what it cannot derive: sites, links and events, each
// stamped with the year it happened. Territory, ruin stage and burial depth
// are functions of a year you ask for, which is why the map can scrub.

const HIST = {
  CELL: 128,      // sim cell, world units; roads inherit this granularity
  N: 64,          // cells per side. N * CELL is the width of the *settled*
                  // world - the terrain runs on forever, only history stops.
  SPAN: 6000,     // years simulated, ending at "now"
  PEOPLES: 6,     // one culture cycle is roughly a thousand years, so six
                  // millennia want six peoples, not one long-lived one

  // Tick resolution is coarse in deep time and fine near now, because the
  // player reads the recent past in detail and the deep past as strata.
  TICK_OLD: 20, TICK_MID: 10, TICK_NEW: 5,
  MID_FROM: 3600, NEW_FROM: 5700,

  // settlement
  CAP_POP: 900,      // carrying capacity of perfect ground
  SEED_POP: 40,      // a site is founded at this size
  GROW: 0.25,        // logistic growth per decade
  SPAWN_POP: 260,    // a site this big can throw a daughter settlement
  SPAWN_R: 7,        // and does it within this many cells
  MAX_SITES: 18,     // per people, so the cast stays readable
  MIN_SEP: 2,        // cells between any two sites
  // Ore does not replace good ground, it multiplies it: a seam under a
  // barren rock is worth less than the same seam under a field, because the
  // people working it still have to eat. Scoring these as alternatives made
  // every delving people build nothing but mines.
  LIVE_FLOOR: 0.15,  // you can settle thin ground, but not nothing
  ORE_PULL: 2.0,     // how far metal lifts a place, times how much they want it
  MINE_T: 0.25,      // ore * delve above this and the place is dug, not farmed
  SITE_MIN: 0.25,    // below this a place is worth neither food nor metal
  RETURN: 0.6,       // chance a people comes back to the old heartland rather
                     // than arriving somewhere of its own
  ROOM: 9,           // cells from the region edge before a place counts as
                     // having room to grow around it. Enough to discourage
                     // the outer band, not so much that everyone huddles in
                     // the middle - the aim is variety, not a bullseye.
  PICK_SHARP: 3,     // how hard the weighted draw leans toward good ground
  RESETTLE: 2.2,     // how much a later people is drawn to ground an earlier
                     // one already used. This is what makes a tell, and it
                     // is also the only reason the peoples ever meet.

  // going out. A people settles only where it has been, so somebody has to
  // go and look first - which is what stops the whole record happening in
  // one valley, and gives the far ruins somebody to have built them.
  KNOWN_HOME: 8,       // cells a people knows around its first site
  KNOWN_SITE: 4,       // and around everything it builds after
  EXPLORE: 0.34,       // chance a people sends an expedition, per tick, in prime
  EXPLORE_LEN: 24,     // cells an expedition covers before turning for home
  EXPLORE_SEE: 3,      // how wide a band it learns on the way
  EXPLORE_LOST: 0.18,  // chance it does not come back
  COLONY: 0.45,        // chance crowded people send settlers out instead of budding
  COLONY_MIN: 9,       // a colony sits at least this far from anything of ours
  CROWD_R: 6, CROWD_N: 4,   // this many of ours this close is too many

  // roads
  ROAD_R: 12,        // a new site links to a neighbour within this range
  SLOPE_COST: 26,    // travel cost per unit of grade
  WATER_COST: 6,     // crossing water: dear, but not so dear that a long
                     // detour always wins - a short neck is worth a bridge
  COLONY_ROAD: 30,   // a colony's road home may run much further than that
  ROAD_DISCOUNT: 0.45, // reuse of an existing road, so routes bundle
  BRIDGE_MIN: 1,     // water cells in a row before it is called a bridge

  // trouble. Rates are per tick and climb as a people ages, so nobody
  // simply grows forever; the fall is emergent, only the rise is scheduled.
  WAR_BASE: 0.05, WAR_AGE: 0.16,
  DISASTER: 0.035,
  CONTACT: 14,       // cells between peoples before they can quarrel
  COLLAPSE: 2,       // living sites below this and the people is finished
  END_WINDOW: 250,   // the years before a fall that actually say what did it
  BROKEN_SITES: 5,   // a people whose seat has been taken and who is down to
                     // this many places does not get up again. Without it a
                     // conquest could never finish anybody: decline ground
                     // every people down to nothing first, and war was only
                     // ever a footnote on the way.

  // A people has a prime and then does not. Past it the ground is tired,
  // no more daughters leave, and the small places are walked away from -
  // which is what makes the three of them a succession instead of three
  // neighbours who all happen to still be here.
  PRIME: 700,
  DECLINE: 700,      // years from the end of the prime to near-nothing
  LEAVE_POP: 22,     // a site smaller than this is simply left

  // people. Nobody is born into this record without a reason to be in it,
  // which is what keeps the cast small enough to remember.
  LIFE: 55, LIFE_VAR: 26, ADULT: 22,
  MAX_FIGURES: 700,   // a seat turns over roughly every forty years, and
                      // expeditions go out for as long as a people has the
                      // vigour, so six millennia of six peoples is a long
                      // roster. It must not bind: a starved cast means a
                      // people with nobody at the head of it. The memorable
                      // layer is S.heroes, not this.

  // war. A war is a state, not an event: it is declared, fought over some
  // years in battles that happen where the two peoples actually touch, and
  // then it ends - by peace, or because one side is gone.
  WAR_LEN: 90,        // years before peace becomes likely
  PEACE: 0.30,        // chance per tick an old war ends
  BATTLE: 0.55,       // chance of a battle per tick while at war
  CMD_EDGE: 0.35,     // how far a good commander tilts the odds
  CMD_FALLS: 0.45,    // chance the losing commander does not come back
  TAKES_SITE: 0.40,   // chance a won battle takes the place it was fought for

  // what a world remembers
  HEROES: 24,         // how many people stay named
  HERO_MIN: 6,        // and how much they must have done to
  LEGENDS: 24,        // how many things keep a story attached to them

  // making
  MAKE: 0.40,         // chance a people makes something, per tick, in its prime
  MAX_ARTIFACTS: 200,

  // what the ground keeps
  GRAVE_GOODS: 0.55,  // chance a notable death is buried with something
  HOARD: 0.50,        // chance a sacked or plagued place hid what it had
  VOTIVE: 0.10,       // offerings at the water's edge
  ROB: 0.35,          // chance a later people digs up an older deposit
  ROB_R: 3,           // cells within which they would find it
  ROB_WAIT: 120,      // years before the dead stop being anybody's dead
  HOLD_MAX: 3,        // nobody walks around with a museum. Without this a
                      // people arriving on an old heartland robs every grave
                      // near it in its founding year, and the one person alive
                      // to receive them ends up holding the lot.

  // decay. Timber goes first and stone stands; the roof is what matters,
  // because a building starts sinking as soon as it stops shedding water.
  ROOF_TIMBER: 45, ROOF_STONE: 130,
  WALL_TIMBER: 260, WALL_STONE: 900,
  SINK_MAX: 3.0,       // metres, on the softest ground: the deepest anything
                       // ever gets. History lives in the topsoil - the caves
                       // start at -12 and have nothing to do with it.
  SINK_TAU: 2200,      // years to settle most of the way down. Tuned to the
                       // span: too short and everything older than a couple
                       // of millennia sits at the same depth, and depth
                       // stops telling you the date.
  SINK_SOFT: 1.0,      // full rate on deep soil
  SINK_HARD: 0.2,      // and a fifth of it on bare rock, where a wall may
                       // still be standing when everything else is under
  GONE_DEPTH: 0.9,     // buried this far and there is nothing left to see
};

const Chronicle = {
  // ---- deterministic draws ----
  // Keyed by (salt, a, b), never a running sequence: a shared stream makes
  // the whole sim order-dependent, and then adding one entity type quietly
  // rewrites every world. This way the ticks can be reordered freely.
  rnd(salt, a, b) {
    return jsUhash(jsUhash((a | 0) >>> 0, (b | 0) >>> 0) ^ (CFG.SEED >>> 0),
                   (salt | 0) >>> 0) / 4294967296;
  },
  pick(tbl, salt, a, b) { return tbl[Math.floor(this.rnd(salt, a, b) * tbl.length) % tbl.length]; },

  // cell <-> world. Cell (0,0) is the far corner; the region is centred on
  // the origin, which is where the player starts.
  wx(i) { return (i - HIST.N / 2 + 0.5) * HIST.CELL; },
  wy(j) { return (j - HIST.N / 2 + 0.5) * HIST.CELL; },
  inBounds(i, j) { return i >= 0 && j >= 0 && i < HIST.N && j < HIST.N; },

  // ---- the ground, before anyone is on it ----
  // Suitability is a pure function of terrain: no simulation, no state. The
  // chronicle only ever reads it, and it is what makes two seeds settle
  // differently rather than the same shapes in different places.
  survey() {
    const N = HIST.N, n = N * N;
    const g = {
      h: new Float32Array(n), slope: new Float32Array(n),
      water: new Uint8Array(n), coast: new Float32Array(n),
      fert: new Float32Array(n), ore: new Float32Array(n),
      cost: new Float32Array(n), soil: new Float32Array(n),
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = this.wx(i), y = this.wy(j);
      const h = terrainH(x, y);
      // Sampled at the scale the terrain actually varies at (~40 u), not at
      // the cell width - a gradient taken across 128 u aliases the hills
      // away and reports the whole region as flat.
      const e = 6;
      const hx = terrainH(x + e, y) - terrainH(x - e, y);
      const hy = terrainH(x, y + e) - terrainH(x, y - e);
      const slope = Math.hypot(hx, hy) / (2 * e);
      g.h[k] = h;
      g.slope[k] = slope;
      g.water[k] = h < CFG.SEA_LEVEL ? 1 : 0;
      g.soil[k] = soilDepth(x, y);
      // ore follows the same region noise the rock does, so a mine sits
      // where the player would actually find metal underfoot
      g.ore[k] = Math.max(0, vn2(x * MATS.ORE_F, y * MATS.ORE_F,
                                 (CFG.SEED ^ 0x0e) >>> 0) - MATS.ORE_GATE);
      g.cost[k] = 1 + slope * HIST.SLOPE_COST + (g.water[k] ? HIST.WATER_COST : 0);
    }
    // distance to water, in cells, by a two-pass sweep - farms want a river
    const INF = 1e9, d = new Float32Array(n).fill(INF);
    for (let k = 0; k < n; k++) if (g.water[k]) d[k] = 0;
    for (let pass = 0; pass < 2; pass++) {
      const fwd = pass === 0;
      for (let s = 0; s < n; s++) {
        const k = fwd ? s : n - 1 - s;
        const i = k % N, j = (k - i) / N;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!this.inBounds(i + di, j + dj)) continue;
          const step = (di && dj) ? 1.414 : 1;
          const v = d[(j + dj) * N + i + di] + step;
          if (v < d[k]) d[k] = v;
        }
      }
    }
    for (let k = 0; k < n; k++) {
      g.coast[k] = d[k];
      if (g.water[k]) { g.fert[k] = 0; continue; }
      // flat, low, watered, with soil on it. Steep ground grows nothing and
      // the highest ground is bare rock, so settlement finds the valleys.
      const flat = 1 - clamp(g.slope[k] / 0.45, 0, 1);
      const low = 1 - clamp((g.h[k] - CFG.SEA_LEVEL) / (CFG.TERRAIN_MAX * 0.7), 0, 1);
      const wet = 1 - clamp((d[k] - 1) / 9, 0, 1);
      const dirt = clamp(g.soil[k] / MATS.SOIL_MAX, 0, 1);
      g.fert[k] = flat * flat * (0.35 + 0.65 * low) * (0.3 + 0.7 * wet) * (0.4 + 0.6 * dirt);
    }
    return g;
  },

  // ---- who they are ----
  // Each people gets its own mouth-feel, so a name tells you which of the
  // three you are reading about before the date does.
  // The peoples do not simply improve. The third of them is the height of
  // this world - it works steel, builds further and makes more than anybody
  // before or after - and when it goes, the working of steel goes with it.
  // Everyone after falls back to what can be had without them: bronze while
  // the old trade still runs, then iron, which anybody can dig.
  // craft / reach / holds are multipliers on making, exploring and how many
  // places a people can hold at once; 1 is ordinary.
  // The peoples do not simply improve. The third of them is the height of
  // this world - it works steel, builds further and makes more than anybody
  // before or after - and when it goes, the working of steel goes with it.
  // What follows is a long way down: delvers who go after iron because it is
  // what is left, then a quiet folk who mostly farm and will not start a
  // fight, and then you, holding a small place among all of it.
  // craft / reach / holds / warlike are multipliers on making, exploring,
  // how much a people can hold, and how readily it declares war; 1 is
  // ordinary. `player` marks the people the game is played in.
  PHON: [
    { head: ['ur', 'anu', 'esh', 'ama', 'ish', 'ena', 'uru', 'ada'],
      tail: ['ara', 'im', 'una', 'esh', 'ani', 'aya', 'ir'],
      mat: 'timber', metal: 'bone', delve: 0.2, kind: 'the First People' },
    { head: ['kra', 'tesh', 'bur', 'dag', 'vok', 'sil', 'mur', 'tak'],
      tail: ['ak', 'osh', 'ur', 'eth', 'ik', 'un', 'ar'],
      mat: 'timber', metal: 'copper', delve: 0.6, kind: 'the Ashfolk' },
    { head: ['bran', 'coel', 'dun', 'gwyn', 'mael', 'tre', 'arv', 'cul'],
      tail: ['ach', 'wyd', 'or', 'eth', 'ain', 'ynt', 'as'],
      mat: 'stone', metal: 'steel', delve: 1.3, kind: 'the Kingdom',
      craft: 1.9, reach: 1.45, holds: 1.35 },
    { head: ['kar', 'thal', 'ves', 'gor', 'rin', 'urd', 'skal', 'mor'],
      tail: ['az', 'orn', 'eth', 'ir', 'und', 'esk', 'ol'],
      mat: 'stone', metal: 'iron', delve: 2.8, kind: 'the Delvers',
      reach: 1.15 },
    { head: ['lin', 'mera', 'sol', 'ael', 'nim', 'hala', 'ryn', 'ela'],
      tail: ['wen', 'ith', 'nis', 'ryl', 'la', 'mor', 'sel', 'din'],
      mat: 'timber', metal: 'copper', delve: 0.3, kind: 'the Quiet Folk',
      craft: 0.55, warlike: 0.10, holds: 0.85 },
    { head: ['hald', 'grim', 'stov', 'bre', 'fenn', 'oder', 'wulf', 'krast'],
      tail: ['and', 'ung', 'ost', 'elm', 'ard', 'ick', 'orn'],
      mat: 'stone', metal: 'iron', delve: 1.0, kind: 'the Last Hold',
      craft: 0.7, holds: 0.6, player: true },
  ],

  cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); },

  // A person or a place must not come out carrying the name of a people. The
  // draw is fair either way, but "Vesesk, of the Vesesk" reads as a mistake.
  freshName(S, p, salt, a) {
    let nm = this.nameFor(p.id, salt, a);
    for (let t = 0; t < 5; t++) {
      let clash = false;
      for (const q of S.peoples) if (q.name === nm) { clash = true; break; }
      if (!clash) return nm;
      nm = this.nameFor(p.id, salt + 101 + t * 37, a);
    }
    return nm;
  },
  nameFor(p, salt, a) {
    const ph = this.PHON[p % this.PHON.length];
    return this.cap(this.pick(ph.head, salt, a, p * 977 + 3) +
                    this.pick(ph.tail, salt + 1, a, p * 977 + 11));
  },

  // ---- what they say came before the record ----
  // The myth is generated last and reads the ground rather than shaping it:
  // the highest place, the richest seam and the nearest water are already
  // facts about this seed, and the story is fitted to them. That is the
  // reverse of the intention in the PRD, where the myth biases the terrain -
  // doing it that way needs the heightfield itself to change, which is
  // shader work. What the player sees is the same either way: the myth names
  // places that are really there, and gives a bearing you can walk.
  ELDER: {
    head: ['ush', 'keth', 'arn', 'thal', 'oum', 'vash', 'eng', 'mor', 'ekru', 'zaan'],
    tail: ['mar', 'anu', 'oth', 'ira', 'esh', 'un', 'aal', 'ekh', 'ora', 'iel'],
  },
  elderName(a, b) {
    return this.cap(this.pick(this.ELDER.head, 200, a, b) +
                    this.pick(this.ELDER.tail, 201, a, b + 5));
  },

  // Eight points, by comparison rather than by atan2: the trigonometric
  // functions are not guaranteed identical between engines, and the whole
  // record has to come out the same everywhere.
  bearing(i, j) {
    const dx = i - HIST.N / 2, dy = j - HIST.N / 2;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1 && ay < 1) return 'under this very ground';
    const ns = dy < 0 ? 'north' : 'south', ew = dx < 0 ? 'west' : 'east';
    if (ax < ay * 0.45) return ns;
    if (ay < ax * 0.45) return ew;
    return ns + '-' + ew;
  },
  leagues(i, j) {
    return Math.round(Math.hypot(i - HIST.N / 2, j - HIST.N / 2));
  },

  myth(S) {
    const N = HIST.N;
    let high = 0, deep = 0, wet = -1, wetD = 1e9;
    for (let k = 0; k < N * N; k++) {
      const i = k % N, j = (k - i) / N;
      if (!S.grid.water[k] && S.grid.h[k] > S.grid.h[high]) high = k;
      if (!S.grid.water[k] && S.grid.ore[k] > S.grid.ore[deep]) deep = k;
      if (S.grid.water[k]) {
        const d = Math.hypot(i - N / 2, j - N / 2);
        if (d < wetD) { wetD = d; wet = k; }
      }
    }
    const cell = k => ({ i: k % N, j: (k - (k % N)) / N });
    const sky = this.elderName(1, 2), stone = this.elderName(3, 7), sea = this.elderName(11, 13);
    const hi = cell(high), dp = cell(deep), wa = wet >= 0 ? cell(wet) : hi;
    const took = this.pick(['swallowed it', 'took it down', 'closed a hand over it',
                            'carried it under'], 202, 0, 0);
    const why = this.pick(['out of hunger', 'out of envy', 'because it was bright',
                           'for no reason anybody kept'], 203, 0, 0);
    const cradle = S.peoples[0] && S.peoples[0].capital !== undefined
      ? S.sites[S.peoples[0].capital] : null;
    const m = {
      powers: [{ name: sky, of: 'the sky' }, { name: stone, of: 'the stone' },
               { name: sea, of: 'the water' }],
      places: [
        { name: 'the seat of ' + sky, i: hi.i, j: hi.j, what: 'the high ground' },
        { name: 'the wound of ' + stone, i: dp.i, j: dp.j, what: 'where the metal is' },
        { name: 'the tears of ' + sea, i: wa.i, j: wa.j, what: 'water' },
      ],
      lines: [],
    };
    m.lines = [
      'Before the record there was ' + sky + ', who was the sky,',
      'and ' + stone + ', who was the stone under it.',
      'They did not quarrel. There was nothing yet to quarrel over.',
      '',
      'Then ' + sky + ' made a light and set it walking,',
      'and ' + stone + ' ' + took + ', ' + why + '.',
      '',
      'Where ' + stone + ' lies with it still, the metal runs richest:',
      'the ground ' + this.bearing(dp.i, dp.j) + ' of here, ' +
        this.leagues(dp.i, dp.j) + ' leagues out.',
      'The high place ' + this.bearing(hi.i, hi.j) + ' is where ' + sky + ' sat',
      'and watched, and did not come down.',
      '',
      sea + ' came out of that wound and has not stopped since.',
      'You can see the water ' + this.bearing(wa.i, wa.j) + ' of here.',
    ];
    if (cradle) m.lines.push('', 'The first people woke on the ground at ' + cradle.name + '.',
                             'Everything after that is written down.');
    m.lines = m.lines.map(l => l.replace(/[^ -~]/g, ''));
    return m;
  },

  // ---- the run ----
  run() {
    const g = this.survey();
    const S = {
      grid: g, peoples: [], sites: [], links: [], events: [],
      figures: [], wars: [], battles: [], artifacts: [], deposits: [],
      heroes: [], legends: [],
      player: -1,       // the people the game is played in, filled in below
      known: [],        // per people, which cells anybody has actually seen
      roaded: new Uint8Array(HIST.N * HIST.N),   // cells a road already crosses
      now: HIST.SPAN, seed: CFG.SEED,
    };
    // Rises are staggered across the span with overlapping tails, so the
    // peoples meet at their edges instead of politely taking turns.
    // Spread so the last people is still young enough to be standing at
    // "now", and so the tails overlap: they meet at their edges rather than
    // politely taking turns.
    const step = (HIST.SPAN - HIST.PRIME) / Math.max(1, HIST.PEOPLES - 1);
    for (let p = 0; p < HIST.PEOPLES; p++) {
      S.known.push(new Uint8Array(HIST.N * HIST.N));
      S.peoples.push({
        id: p, name: this.nameFor(p, 1, 7), kind: this.PHON[p].kind,
        mat: this.PHON[p].mat, delve: this.PHON[p].delve,
        metal: this.PHON[p].metal,
        craft: this.PHON[p].craft || 1, reach: this.PHON[p].reach || 1,
        holds: this.PHON[p].holds || 1, warlike: this.PHON[p].warlike || 1,
        player: !!this.PHON[p].player,
        rise: Math.floor(p * step + this.rnd(2, p, 0) * step * 0.18),
        known: p,   // index into S.known
        fell: -1, cause: null, founded: false, sites: [], peak: 0, broken: -1,
      });
    }
    for (const p of S.peoples) if (p.player) S.player = p.id;
    for (let y = 0; y < HIST.SPAN; ) {
      const dt = y < HIST.MID_FROM ? HIST.TICK_OLD
               : y < HIST.NEW_FROM ? HIST.TICK_MID : HIST.TICK_NEW;
      this.tick(S, y, dt);
      y += dt;
    }
    S.myth = this.myth(S);
    this.crown(S);
    return S;
  },

  log(S, t, actor, action, target, place, cause, who) {
    S.events.push({ t, actor, action, target, place, cause,
                    who: who === undefined ? null : who });
  },

  living(S, p, y) {
    return p.sites.filter(id => {
      const s = S.sites[id];
      return s.founded <= y && (s.abandoned < 0 || s.abandoned > y);
    });
  },

  tick(S, y, dt) {
    this.age(S, y);
    for (const w of S.wars) if (w.ended < 0) this.fight(S, w, y, dt);
    for (const p of S.peoples) {
      if (y < p.rise || p.fell >= 0) continue;
      if (!p.founded) { this.found(S, p, y); continue; }
      this.leader(S, p, y);
      this.grow(S, p, y, dt);
      this.expand(S, p, y);
      if (this.vigour(p, y) > 0.6 && this.rnd(83, p.id, y) < HIST.MAKE * p.craft * (dt / 10))
        this.make(S, p, y);
      if (this.vigour(p, y) > 0.5 && this.rnd(97, p.id, y) < HIST.EXPLORE * (dt / 10))
        this.explore(S, p, y);
      this.trouble(S, p, y, dt);
      // A people is finished when it is gone, or when it is a shadow of
      // what it was - not merely because it is young and still small.
      const live = this.living(S, p, y).length;
      if (live > p.peak) p.peak = live;
      const seatGone = p.broken >= 0 && p.broken >= y - HIST.END_WINDOW;
      if (!p.player &&
          (live === 0 || (live < HIST.COLLAPSE && p.peak > HIST.COLLAPSE) ||
           (seatGone && live < HIST.BROKEN_SITES))) {
        p.fell = y;
        // What finished them is read off how their places actually went,
        // rather than latched the first time they lost a field.
        // Only the last years count. Every people abandons most of its
        // places quietly on the way down, so weighing a whole lifetime
        // buries the difference between fading out and being taken apart.
        let sacked = 0, quiet = 0;
        for (const id of p.sites) {
          const st = S.sites[id];
          if (st.abandoned < 0 || st.abandoned < y - HIST.END_WINDOW) continue;
          if (st.cause === 'sacked') sacked++; else quiet++;
        }
        if (!sacked && !quiet) for (const id of p.sites) {
          const st = S.sites[id];
          if (st.abandoned < 0) continue;
          if (st.cause === 'sacked') sacked++; else quiet++;
        }
        p.cause = (seatGone || (sacked > 0 && quiet === 0)) ? 'war'
                : sacked > 0 ? 'war and decline' : 'decline';
        this.log(S, y, p.id, 'ended', null, null, p.cause);
        // Nobody after them can work it. A steel thing in a later grave was
        // therefore taken out of one of theirs, which is a fact the ground
        // states without anybody having to write it down.
        if (p.metal !== 'bone' &&
            !S.peoples.some(q => q.id !== p.id && q.metal === p.metal &&
                                 (q.fell < 0 || q.fell > y)))
          this.log(S, y, p.id, 'lost the craft', null, null, p.metal);
      }
    }
  },

  // The capital goes on the best unclaimed ground anywhere in the region.
  // Deliberately global: a people's first choice is the thing everything
  // else about them is downstream of.
  // Where a people arrives. Deliberately not the single best cell in the
  // region: an argmax over a noisy field lands as readily in a corner as
  // anywhere, and a capital with a wall on two sides bends everything that
  // follows it. So score the whole region, then draw from the good ground
  // by weight - sharpened so the draw still strongly prefers good ground,
  // but no longer always picks the one extreme cell.
  found(S, p, y) {
    // some peoples come back to the old heartland; some arrive somewhere
    // of their own, which is what keeps six millennia off one hill
    const back = this.rnd(10, p.id, 3) < HIST.RETURN;
    const cand = [];
    let total = 0;
    for (let k = 0; k < HIST.N * HIST.N; k++) {
      if (S.grid.water[k]) continue;
      const i = k % HIST.N, j = (k - i) / HIST.N;
      if (this.tooClose(S, i, j, y, HIST.MIN_SEP + 2)) continue;
      // room to grow: the edge of the region is the edge of the world to a
      // people who would otherwise spend their whole history against it
      const edge = Math.min(i, j, HIST.N - 1 - i, HIST.N - 1 - j);
      let sc = S.grid.fert[k] * (0.62 + 0.38 * clamp(edge / HIST.ROOM, 0, 1));
      // Good ground stays good ground, for those who come looking for it:
      // that is how a mound accumulates, and why anybody is ever close
      // enough to anybody else to quarrel with them.
      if (back) sc *= 1 + HIST.RESETTLE * this.pastSettlement(S, i, j, y);
      if (sc <= 0) continue;
      sc = Math.pow(sc, HIST.PICK_SHARP);
      cand.push(k); total += sc;
      cand.push(sc);            // flat pairs: cell, weight
    }
    if (!cand.length) return;
    let r = this.rnd(11 + p.id, y, 7) * total, best = cand[0];
    for (let n = 0; n < cand.length; n += 2) {
      r -= cand[n + 1];
      if (r <= 0) { best = cand[n]; break; }
    }
    const i = best % HIST.N, j = (best - i) / HIST.N;
    const id = this.addSite(S, p, i, j, 'hold', y);
    p.founded = true;
    p.capital = id;
    this.learn(S, p, i, j, HIST.KNOWN_HOME);
    this.log(S, y, p.id, 'founded', id, id, null);
    this.rob(S, p, y, i, j);   // only once the people has a head to hand it to
  },

  // How much of somebody else's ruin field lies under this cell.
  pastSettlement(S, i, j, y) {
    let n = 0;
    for (const s of S.sites) {
      if (s.founded > y) continue;
      if (Math.abs(s.i - i) > 2 || Math.abs(s.j - j) > 2) continue;
      n++;
    }
    return clamp(n / 3, 0, 1);
  },

  tooClose(S, i, j, y, sep) {
    for (const s of S.sites) {
      if (s.abandoned >= 0 && s.abandoned <= y) continue;
      if (Math.abs(s.i - i) < sep && Math.abs(s.j - j) < sep) return true;
    }
    return false;
  },

  addSite(S, p, i, j, kind, y) {
    const k = j * HIST.N + i;
    const id = S.sites.length;
    S.sites.push({
      id, people: p.id, i, j, kind,
      x: this.wx(i), y: this.wy(j), z: S.grid.h[k],
      name: this.freshName(S, p, 20 + id, i * 31 + j),
      founded: y, abandoned: -1, cause: null,
      pop: HIST.SEED_POP, peak: HIST.SEED_POP,
      mat: kind === 'farm' ? 'timber' : p.mat,
    });
    p.sites.push(id);
    return id;
  },

  vigour(p, y) {
    const past = y - p.rise - HIST.PRIME;
    // The floor has to sit below what LEAVE_POP will tolerate, or a spent
    // people settles into a permanent shrunken twilight and never ends.
    return past <= 0 ? 1 : Math.max(0.01, 1 - past / HIST.DECLINE);
  },

  grow(S, p, y, dt) {
    const vig = this.vigour(p, y);
    for (const id of this.living(S, p, y)) {
      const s = S.sites[id];
      const k = s.j * HIST.N + s.i;
      let cap = HIST.CAP_POP * S.grid.fert[k];
      if (s.kind === 'mine') cap = HIST.CAP_POP * (0.25 + S.grid.ore[k] * 6);
      if (s.kind === 'hold') cap *= 1.5;
      cap = Math.max(cap, HIST.SEED_POP) * vig;
      s.pop += HIST.GROW * (dt / 10) * s.pop * (1 - s.pop / cap);
      s.pop = Math.max(0, s.pop);
      if (s.pop > s.peak) s.peak = s.pop;
      // the commonest way a place ends is that everybody left
      if (s.pop < HIST.LEAVE_POP && vig < 1) this.abandon(S, s, y, 'left', p.id);
    }
  },

  // A big enough site throws a daughter onto the best ground near it. What
  // that ground is good for decides what the daughter becomes, which is why
  // mines end up on the ore and farms end up on the flats.
  expand(S, p, y) {
    const live = this.living(S, p, y);
    if (live.length >= HIST.MAX_SITES * p.holds) return;
    if (this.vigour(p, y) < 0.75) return;   // nobody leaves a failing people
    const known = S.known[p.id];
    for (const id of live) {
      const s = S.sites[id];
      if (s.pop < HIST.SPAWN_POP) continue;
      if (this.rnd(31, id, y) > 0.55) continue;
      // hemmed in by our own? then somebody goes a long way off instead
      if (this.crowded(S, p, y, s) && this.rnd(96, id, y) < HIST.COLONY &&
          this.colonise(S, p, y) !== null) { s.pop *= 0.82; return; }
      let best = null, bestScore = 0;
      for (let dj = -HIST.SPAWN_R; dj <= HIST.SPAWN_R; dj++)
        for (let di = -HIST.SPAWN_R; di <= HIST.SPAWN_R; di++) {
          const i2 = s.i + di, j2 = s.j + dj;
          if (!this.inBounds(i2, j2)) continue;
          const k = j2 * HIST.N + i2;
          if (S.grid.water[k] || !known[k]) continue;
          if (this.tooClose(S, i2, j2, y, HIST.MIN_SEP)) continue;
          const ore = S.grid.ore[k] * p.delve;
          const sc = (HIST.LIVE_FLOOR + S.grid.fert[k]) * (1 + ore * HIST.ORE_PULL) *
                     (0.8 + 0.4 * this.rnd(41, i2 * 7 + id, j2 + y));
          if (sc > bestScore) { bestScore = sc; best = { i: i2, j: j2, k, ore }; }
        }
      if (!best || bestScore < HIST.SITE_MIN) continue;
      const kind = best.ore > HIST.MINE_T ? 'mine' : 'farm';
      const nid = this.addSite(S, p, best.i, best.j, kind, y);
      this.rob(S, p, y, best.i, best.j);
      this.learn(S, p, best.i, best.j, HIST.KNOWN_SITE);
      s.pop *= 0.78;   // the daughter is people who left
      this.log(S, y, p.id, 'settled', nid, nid, null);
      this.road(S, nid, y);
      return;          // one founding per people per tick keeps growth legible
    }
  },

  // ---- going out ----
  // Sixteen headings, written out rather than computed: Math.sin and cos are
  // not guaranteed identical between engines, and the record has to come out
  // the same everywhere from the seed alone.
  DIRS: [[1, 0], [0.92, 0.38], [0.71, 0.71], [0.38, 0.92],
         [0, 1], [-0.38, 0.92], [-0.71, 0.71], [-0.92, 0.38],
         [-1, 0], [-0.92, -0.38], [-0.71, -0.71], [-0.38, -0.92],
         [0, -1], [0.38, -0.92], [0.71, -0.71], [0.92, -0.38]],

  learn(S, p, i, j, r) {
    const k = S.known[p.id];
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (di * di + dj * dj > r * r) continue;
      const x = i + di, z = j + dj;
      if (this.inBounds(x, z)) k[z * HIST.N + x] = 1;
    }
  },

  // An expedition walks a heading out from the capital, learns a band either
  // side of its track, and reports the best ground it crossed. Some of them
  // do not come back, and those are the ones anybody remembers.
  explore(S, p, y) {
    const from = S.sites[p.capital];
    if (!from) return null;
    // Somebody who has come back before goes again, so a life of walking
    // accumulates onto one name instead of a new stranger every expedition.
    let f = null;
    for (const g of S.figures) {
      if (g.people !== p.id || g.role !== 'explorer' || !this.figureAlive(S, g, y)) continue;
      if (!f || g.deeds.length > f.deeds.length) f = g;
    }
    if (!f) f = this.newFigure(S, p, y, 'explorer', from.id);
    if (!f) return null;
    const d = this.DIRS[Math.floor(this.rnd(91, p.id, y) * this.DIRS.length) % this.DIRS.length];
    let best = null, bestScore = 0, reach = 0, lastI = from.i, lastJ = from.j;
    const far = Math.round(HIST.EXPLORE_LEN * p.reach);
    for (let n = 1; n <= far; n++) {
      const i = Math.round(from.i + d[0] * n + (this.rnd(92, p.id * 131 + n, y) - 0.5) * 3);
      const j = Math.round(from.j + d[1] * n + (this.rnd(93, p.id * 131 + n, y) - 0.5) * 3);
      if (!this.inBounds(i, j)) break;
      this.learn(S, p, i, j, HIST.EXPLORE_SEE);
      reach = n; lastI = i; lastJ = j;
      const k = j * HIST.N + i;
      if (S.grid.water[k]) continue;
      const sc = (HIST.LIVE_FLOOR + S.grid.fert[k]) *
                 (1 + S.grid.ore[k] * p.delve * HIST.ORE_PULL);
      if (sc > bestScore) { bestScore = sc; best = { i, j, k }; }
    }
    if (best) {
      const what = S.grid.ore[best.k] * p.delve > HIST.MINE_T
        ? 'metal in the ground' : 'good ground';
      this.deed(S, f, y, 'walked ' + reach + ' leagues out and found ' + what);
    } else {
      this.deed(S, f, y, 'walked ' + reach + ' leagues out and found nothing');
    }
    // the wild keeps some of them
    if (this.rnd(94, f.id, y) < HIST.EXPLORE_LOST) {
      f.died = y;
      f.cause = best && S.grid.ore[best.k] > 0.1 ? 'the deep' : 'the wild';
      // Whatever they were carrying is out there with them, a long way from
      // anywhere anybody built. Nobody buries an expedition.
      for (const aid of f.holds) {
        const a = S.artifacts[aid];
        a.owners.push({ who: f.id, from: y, how: 'lost in the wild with' });
        a.rest = { i: lastI, j: lastJ, t: y, how: 'lost', figure: f.id };
        this.deposit(S, lastI, lastJ, 'lost', y, p.id, f.id, aid, a.cls);
      }
      f.holds = [];
      this.log(S, y, p.id, 'never came back', null, from.id, f.cause, f.id);
    }
    return f;
  },

  // Is this place hemmed in by our own?
  crowded(S, p, y, s) {
    let n = 0;
    for (const id of this.living(S, p, y)) {
      const o = S.sites[id];
      if (Math.abs(o.i - s.i) <= HIST.CROWD_R && Math.abs(o.j - s.j) <= HIST.CROWD_R) n++;
    }
    return n >= HIST.CROWD_N;
  },

  // Settlers go a long way to somewhere already walked, and take the road
  // home with them. This is the whole reason the map is not one valley.
  colonise(S, p, y) {
    const known = S.known[p.id];
    const live = this.living(S, p, y);
    let best = null, bestScore = 0;
    for (let k = 0; k < HIST.N * HIST.N; k++) {
      if (!known[k] || S.grid.water[k]) continue;
      const i = k % HIST.N, j = (k - i) / HIST.N;
      let near = 1e9;
      for (const id of live) {
        const o = S.sites[id];
        const dd = Math.hypot(o.i - i, o.j - j);
        if (dd < near) near = dd;
      }
      if (near < HIST.COLONY_MIN) continue;
      if (this.tooClose(S, i, j, y, HIST.MIN_SEP)) continue;
      const edge = Math.min(i, j, HIST.N - 1 - i, HIST.N - 1 - j);
      const sc = (HIST.LIVE_FLOOR + S.grid.fert[k]) *
                 (1 + S.grid.ore[k] * p.delve * HIST.ORE_PULL) *
                 (0.55 + 0.45 * clamp(edge / HIST.ROOM, 0, 1)) *
                 (0.85 + 0.3 * this.rnd(95, i * 17 + j, y));
      if (sc > bestScore) { bestScore = sc; best = { i, j, k }; }
    }
    if (!best || bestScore < HIST.SITE_MIN) return null;
    const kind = S.grid.ore[best.k] * p.delve > HIST.MINE_T ? 'mine' : 'farm';
    const id = this.addSite(S, p, best.i, best.j, kind, y);
    this.rob(S, p, y, best.i, best.j);
    this.learn(S, p, best.i, best.j, HIST.KNOWN_SITE);
    const led = this.newFigure(S, p, y, 'settler', id);
    if (led) this.deed(S, led, y, 'led the settling of ' + S.sites[id].name, id);
    this.log(S, y, p.id, 'settled far out at', id, id, null, led ? led.id : null);
    this.road(S, id, y, HIST.COLONY_ROAD);
    return id;
  },

  // ---- roads ----
  // A road is the cheapest path over the travel-cost field, which means
  // bridges are not designed: they are what happens when the cheapest path
  // still has to get wet.
  road(S, id, y, reach) {
    const s = S.sites[id];
    const max = reach === undefined ? HIST.ROAD_R : reach;
    let bestId = -1, bestD = 1e9;
    for (const other of this.living(S, S.peoples[s.people], y)) {
      if (other === id) continue;
      const o = S.sites[other];
      const d = Math.hypot(o.i - s.i, o.j - s.j);
      if (d < bestD && d <= max) { bestD = d; bestId = other; }
    }
    if (bestId < 0) return null;
    const path = this.path(S, s, S.sites[bestId]);
    if (!path) return null;
    // a run of water cells on the route is a crossing that had to be built
    const bridges = [];
    let run = null;
    for (const k of path) {
      if (S.grid.water[k]) { (run || (run = [])).push(k); }
      else if (run) { if (run.length >= HIST.BRIDGE_MIN) bridges.push(run); run = null; }
    }
    if (run && run.length >= HIST.BRIDGE_MIN) bridges.push(run);
    const link = {
      id: S.links.length, a: id, b: bestId, people: s.people,
      built: y, path, bridges,
    };
    S.links.push(link);
    // Once per cell, not once per crossing. Compounding made the busiest
    // corridors twenty thousand times cheaper than open ground, so the late
    // network was shaped by repeated multiplication rather than by terrain.
    for (const k of path) {
      if (S.roaded[k]) continue;
      S.roaded[k] = 1;
      S.grid.cost[k] *= HIST.ROAD_DISCOUNT;
    }
    if (bridges.length) {
      this.log(S, y, s.people, 'bridged', link.id, id, null);
    }
    this.log(S, y, s.people, 'roaded', link.id, id, null);
    return link;
  },

  // Dijkstra over the cell grid. 4096 nodes and a road every few ticks, so
  // a binary heap is more than enough and an A* heuristic is not worth the
  // extra surface to get wrong.
  path(S, a, b) {
    const N = HIST.N, n = N * N;
    const dist = new Float32Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    const src = a.j * N + a.i, dst = b.j * N + b.i;
    dist[src] = 0;
    const heap = [[0, src]];
    const push = (d, k) => {
      heap.push([d, k]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          const t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, k] = pop();
      if (seen[k]) continue;
      seen[k] = 1;
      if (k === dst) break;
      const i = k % N, j = (k - i) / N;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i2 = i + di, j2 = j + dj;
        if (!this.inBounds(i2, j2)) continue;
        const k2 = j2 * N + i2;
        if (seen[k2]) continue;
        const step = (di && dj) ? 1.414 : 1;
        const nd = d + S.grid.cost[k2] * step;
        if (nd < dist[k2]) { dist[k2] = nd; prev[k2] = k; push(nd, k2); }
      }
    }
    if (!seen[dst]) return null;
    const out = [];
    for (let k = dst; k >= 0; k = prev[k]) out.push(k);
    return out.reverse();
  },

  // ---- trouble ----
  // Pressure climbs with a people's age, so growth is not free forever, but
  // which site actually falls is decided by where it sits and who is next
  // to it - never by a script.
  trouble(S, p, y, dt) {
    const age = clamp((y - p.rise) / (HIST.PRIME + HIST.DECLINE), 0, 1);
    const scale = dt / 10;
    if (this.rnd(51, p.id, y) < (HIST.DISASTER * scale)) {
      const live = this.living(S, p, y);
      // Disasters take sites, not peoples: the last one standing survives
      // until the people has had a run at it. Otherwise a bad roll in the
      // first century deletes a third of the record before it happens.
      const spared = live.length === 1 && p.peak < 3;
      if (live.length && !spared) {
        const s = S.sites[this.pick(live, 52, p.id, y)];
        const k = s.j * HIST.N + s.i;
        const cause = S.grid.coast[k] < 1.1 ? 'flood'
                    : s.kind === 'mine' ? 'the deep'
                    : this.rnd(53, s.id, y) < 0.5 ? 'plague' : 'famine';
        this.abandon(S, s, y, cause, p.id);
      }
    }
    // Wars are ticked once each in tick(); here a people only decides
    // whether to start another, which it will not do while already in one.
    let fighting = false;
    for (const w of S.wars)
      if (w.ended < 0 && (w.a === p.id || w.b === p.id)) fighting = true;
    if (!fighting &&
        this.rnd(54, p.id, y) <
          (HIST.WAR_BASE + HIST.WAR_AGE * age) * scale * p.warlike) {
      const foe = this.neighbour(S, p, y);
      if (foe && !this.atWar(S, p.id, foe.id)) {
        this.declare(S, p, foe, y);
        this.fortify(S, p, foe, y);
      }
    }
  },

  // War leaves something standing as well as something burnt: the side
  // that lost ground puts a fort on the high ground between itself and the
  // people who took it. It is the only site kind nobody chooses to build.
  fortify(S, p, foe, y) {
    if (this.living(S, p, y).length >= HIST.MAX_SITES) return null;
    const cap = S.sites[p.capital];
    let near = null, nd = 1e9;
    for (const id of this.living(S, foe, y)) {
      const f = S.sites[id];
      const d = Math.hypot(f.i - cap.i, f.j - cap.j);
      if (d < nd) { nd = d; near = f; }
    }
    if (!near) return null;
    const mi = Math.round(cap.i + (near.i - cap.i) * 0.45);
    const mj = Math.round(cap.j + (near.j - cap.j) * 0.45);
    let best = null, bestScore = -1;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = mi + di, j = mj + dj;
      if (!this.inBounds(i, j)) continue;
      const k = j * HIST.N + i;
      if (S.grid.water[k]) continue;
      if (this.tooClose(S, i, j, y, HIST.MIN_SEP)) continue;
      const sc = S.grid.slope[k] + S.grid.h[k] / CFG.TERRAIN_MAX;
      if (sc > bestScore) { bestScore = sc; best = { i, j }; }
    }
    if (!best) return null;
    const id = this.addSite(S, p, best.i, best.j, 'fort', y);
    this.rob(S, p, y, best.i, best.j);
    // an army that marches to the border learns the border
    this.learn(S, p, best.i, best.j, HIST.KNOWN_SITE);
    this.log(S, y, p.id, 'fortified', id, id, 'war');
    this.road(S, id, y);
    return id;
  },

  neighbour(S, p, y) {
    for (const q of S.peoples) {
      if (q.id === p.id || q.fell >= 0 || !q.founded) continue;
      for (const a of this.living(S, p, y)) for (const b of this.living(S, q, y)) {
        const sa = S.sites[a], sb = S.sites[b];
        if (Math.hypot(sa.i - sb.i, sa.j - sb.j) <= HIST.CONTACT) return q;
      }
    }
    return null;
  },

  // How a site ends decides what is left in it. Sacked and drowned sites
  // keep their contents because nobody packed; a slow decline takes the
  // good things away with the people. The deposition pass reads this.
  abandon(S, s, y, cause, by) {
    // nothing is founded and ended in the same breath; it reads as a bug
    if (s.abandoned >= 0 || s.founded >= y) return;
    s.abandoned = y;
    s.cause = cause;
    s.endedBy = by === undefined ? null : by;
    s.sudden = (cause === 'sacked' || cause === 'flood' ||
                cause === 'plague' || cause === 'the deep');
    // Nobody packs when a place ends suddenly, so what they had is still in
    // it. A slow decline takes the good things away with the people, which
    // is why a quiet ruin is a poorer dig than a burnt one.
    if (s.sudden) this.deposit(S, s.i, s.j, 'abandon', y, s.people, null, null);
    if (cause === 'sacked' && s.id === S.peoples[s.people].capital)
      S.peoples[s.people].broken = y;
    if ((cause === 'sacked' || cause === 'plague') && this.rnd(78, s.id, y) < HIST.HOARD) {
      // Somebody put what they had into the ground meaning to come back for
      // it. A hoard exists precisely because they did not - which is why
      // hoards cluster on the bad years and hold the good things.
      // whoever of theirs was carrying something, and best of all somebody
      // who actually lived here
      let hid = null;
      for (const f of S.figures) {
        if (f.people !== s.people) continue;
        if (!this.figureAlive(S, f, y) || !f.holds.length) continue;
        if (f.home === s.id) { hid = f; break; }
        if (!hid) hid = f;
      }
      if (hid) {
        const aid = hid.holds.shift();
        const a = S.artifacts[aid];
        a.owners.push({ who: hid.id, from: y, how: 'put into the ground for safety by' });
        a.rest = { i: s.i, j: s.j, t: y, how: 'hoard', figure: hid.id };
        this.deposit(S, s.i, s.j, 'hoard', y, s.people, hid.id, aid, a.cls);
      } else {
        this.deposit(S, s.i, s.j, 'hoard', y, s.people, null, null);
      }
    }
    // whoever was holding the place may not have left it
    const p = S.peoples[s.people];
    const lord = p.leader === undefined ? null : S.figures[p.leader];
    if (s.sudden && lord && lord.home === s.id && this.figureAlive(S, lord, y) &&
        this.rnd(79, s.id, y) < 0.4) {
      lord.died = y; lord.cause = cause;
      this.bury(S, lord, y, s.id);
    }
    this.log(S, y, by === undefined ? null : by, 'ended', s.id, s.id, cause);
  },

  // ---- individuals ----
  // Nobody enters this record without a reason to be in it: a figure is made
  // when a people needs a head, a battle needs a commander, or something is
  // made that needs a maker. That is what keeps the cast small enough to
  // remember - not an arbitrary cap, but the fact that a name has to be
  // earned by a deed.
  EPITHET: {
    war:  ['the Unbroken', 'the Iron-Handed', 'Shieldbreaker', 'the Red', 'the Wall'],
    make: ['the Maker', 'Goldhand', 'the Patient', 'who worked the deep vein'],
    lead: ['the Old', 'the Long-Reigning', 'the Quiet', 'who held the gate'],
    deep: ['who went down', 'the Lost', 'who did not come up again'],
    far:  ['the Far-Walker', 'who went out', 'the Wanderer', 'who found the way'],
  },

  newFigure(S, p, y, role, siteId) {
    if (S.figures.length >= HIST.MAX_FIGURES) return null;
    const id = S.figures.length;
    const f = {
      id, people: p.id, role,
      name: this.freshName(S, p, 300 + (id % 97), y + id * 7),
      born: y - HIST.ADULT - Math.floor(this.rnd(60, id, y) * 14),
      life: HIST.LIFE + Math.floor(this.rnd(61, id, y) * HIST.LIFE_VAR),
      died: -1, cause: null, epithet: null,
      home: siteId === undefined ? p.capital : siteId,
      wins: 0, losses: 0, made: 0, led: -1, deeds: [], holds: [], renown: 0,
    };
    S.figures.push(f);
    return f;
  },

  figureAlive(S, f, y) { return !!f && f.born <= y && (f.died < 0 || f.died > y); },

  deed(S, f, y, what, place) {
    f.deeds.push({ t: y, what, place: place === undefined ? null : place });
    this.log(S, y, f.people, what, null, place === undefined ? null : place, null, f.id);
  },

  // The people's current head. When the old one is gone a successor takes
  // the seat, so the line is unbroken for as long as the people is.
  leader(S, p, y) {
    const old = p.leader === undefined ? null : S.figures[p.leader];
    if (this.figureAlive(S, old, y)) return old;
    const f = this.newFigure(S, p, y, 'lord');
    if (!f) return null;
    p.leader = f.id;
    f.led = y;
    // what the last one held passes on, unless it went into the ground
    if (old) for (const a of old.holds) { f.holds.push(a);
      S.artifacts[a].owners.push({ who: f.id, from: y, how: 'inherited' }); }
    if (old) old.holds = [];
    this.deed(S, f, y, old ? 'took the seat after ' + old.name : 'led them here', p.capital);
    return f;
  },

  // The best commander a people has, or a new one if there is nobody left
  // who has done it before. Reusing the living one is what lets a captain
  // accumulate a record instead of every battle inventing a stranger.
  captain(S, p, y) {
    let best = null;
    for (const f of S.figures) {
      if (f.people !== p.id || f.role !== 'captain' || !this.figureAlive(S, f, y)) continue;
      if (!best || f.wins > best.wins) best = f;
    }
    return best || this.newFigure(S, p, y, 'captain');
  },

  // Reused the same way a captain is, so a smith accumulates a body of work
  // instead of every object inventing a stranger to have made it.
  smith(S, p, y, siteId) {
    let best = null;
    for (const f of S.figures) {
      if (f.people !== p.id || f.role !== 'smith' || !this.figureAlive(S, f, y)) continue;
      if (!best || f.made > best.made) best = f;
    }
    return best || this.newFigure(S, p, y, 'smith', siteId);
  },

  age(S, y) {
    for (const f of S.figures) {
      if (f.died >= 0 || f.born + f.life > y) continue;
      f.died = y;
      f.cause = 'age';
      this.bury(S, f, y);
    }
  },

  // ---- what people make ----
  // Five classes, because what a thing was for decides where it ends up:
  // weapons and armour are lost on fields and go down with fighters, tools
  // are left where the work was, vessels go into graves and hoards, and
  // what somebody wore is the thing most likely to still be on them.
  ART_CLASS: {
    weapon: ['sword', 'longsword', 'axe', 'war-axe', 'spear', 'blade',
             'war-pick', 'long knife', 'mace', 'halberd'],
    armour: ['helm', 'shield', 'mail-coat', 'greaves', 'war-mask',
             'breastplate', 'gauntlets', 'scale-coat'],
    wear:   ['torc', 'ring', 'brooch', 'circlet', 'amulet', 'pendant',
             'armband', 'belt-buckle', 'diadem', 'cloak-pin'],
    tool:   ['pick', 'chisel', 'awl', 'saw', 'plumb-bob', 'lamp',
             'adze', 'file', 'tongs', 'drill'],
    vessel: ['bowl', 'cup', 'urn', 'cauldron', 'flask', 'ewer',
             'platter', 'drinking-horn', 'basin'],
  },
  // ornament is not made of what the tools are made of
  ART_RICH: ['gold', 'silver'],
  ART_ORN: ['amber', 'jet', 'greenstone', 'shell'],
  // What a thing is worth before anything has happened to it. Deliberately
  // small: this separates things whose histories are otherwise equal, and
  // must not decide the ranking on its own, or the list becomes an
  // inventory of gold rather than a set of stories.
  WORTH: { gold: 2, silver: 2, steel: 2, amber: 1, greenstone: 1, jet: 1,
           shell: 0, iron: 1, bronze: 1, copper: 0, bone: 0 },
  CLASS_WORTH: { wear: 1, weapon: 1, armour: 1, vessel: 0, tool: 0 },
  ART_ADJ: ['bright', 'grey', 'weeping', 'long', 'cold', 'first', 'quiet',
            'red', 'nine-fold', 'unlucky', 'thin', 'black', 'twice-broken',
            'plain', 'crooked', 'star-marked', 'silent', 'old'],

  // What a people reaches for depends on what it is doing: at war it makes
  // war-gear, delving it makes tools, and at ease it makes things to eat and
  // drink out of, which are the things worth burying somebody with.
  wantClass(S, p, y) {
    const atWar = S.wars.some(w => w.ended < 0 && (w.a === p.id || w.b === p.id));
    const r = this.rnd(84, p.id, y);
    if (atWar) return r < 0.38 ? 'weapon' : r < 0.66 ? 'armour'
                   : r < 0.84 ? 'wear' : 'vessel';
    if (p.delve > 1.2) return r < 0.40 ? 'tool' : r < 0.60 ? 'vessel'
                   : r < 0.80 ? 'wear' : r < 0.92 ? 'weapon' : 'armour';
    return r < 0.28 ? 'vessel' : r < 0.56 ? 'wear' : r < 0.74 ? 'tool'
         : r < 0.90 ? 'weapon' : 'armour';
  },

  // Something is made, by somebody, in a year, out of what the ground gave.
  // Nobody writes the story of an object; the object collects one.
  make(S, p, y) {
    if (S.artifacts.length >= HIST.MAX_ARTIFACTS) return null;
    const live = this.living(S, p, y);
    if (!live.length) return null;
    const at = S.sites[this.pick(live, 80, p.id, y)];
    const smith = this.smith(S, p, y, at.id);
    if (!smith) return null;
    const cls = this.wantClass(S, p, y);
    const k = at.j * HIST.N + at.i;
    const id = S.artifacts.length;
    // Gold is for things that are looked at rather than used, and what
    // somebody wore was never made of the same stuff as their pick.
    const rich = S.grid.ore[k] > 0.14;
    const mat = cls === 'wear'
      ? (rich ? this.pick(this.ART_RICH, 87, id, y) : this.pick(this.ART_ORN, 88, id, y))
      : (cls === 'vessel' || cls === 'armour') && rich ? 'gold' : p.metal;
    const a = {
      id, cls, kind: this.pick(this.ART_CLASS[cls], 81, id, y), mat,
      made: y, madeBy: smith.id, madeAt: at.id, people: p.id,
      owners: [], rest: null,
    };
    a.name = 'the ' + this.pick(this.ART_ADJ, 82, id, y) + ' ' + mat + ' ' +
             a.kind + ' of ' + (this.rnd(86, id, y) < 0.5 ? at.name : p.name);
    S.artifacts.push(a);
    smith.made++;
    this.deed(S, smith, y, 'made ' + a.name, at.id);
    // War-gear goes to whoever leads the fighting rather than to the seat,
    // which is why so much of it ends its life on a field instead of in a
    // barrow - and why the things worth remembering were carried by the
    // people worth remembering.
    let to = (cls === 'weapon' || cls === 'armour')
      ? this.captain(S, p, y) : this.leader(S, p, y);
    if (to && to.holds.length >= HIST.HOLD_MAX) {
      // their hands are full; it is made for somebody else
      for (const f of S.figures)
        if (f.people === p.id && this.figureAlive(S, f, y) &&
            f.holds.length < HIST.HOLD_MAX) { to = f; break; }
    }
    if (to) { a.owners.push({ who: to.id, from: y, how: 'made for' }); to.holds.push(id); }
    this.log(S, y, p.id, 'made', id, at.id, null, smith.id);
    return a;
  },

  // ---- what survives being left ----
  // How long a material lasts once nobody is looking after it, as the years
  // at which roughly a third of it is left. Gold comes up exactly as it went
  // down; iron does not, and after enough centuries there is a rust stain
  // and a shape in the soil where the blade was. This is the quiet reason
  // that what a people worked decides how much of them there is to find.
  KEEPS: {
    gold: 1e9, greenstone: 1e9, silver: 4000, jet: 6000, amber: 3000,
    // Steel barely rusts: it was worked past what anybody after could manage,
    // and it is the reason the height of this world is also the part of it
    // there is most left to find.
    steel: 9000, bronze: 2500, copper: 2000, shell: 1500, iron: 900, bone: 700,
  },
  CONDITION: [[0.75, 'sound'], [0.45, 'worn'], [0.22, 'corroded'],
              [0.07, 'a fragment'], [0, 'a stain in the soil']],

  // Years a thing has actually spent in the ground. Time in somebody's hands
  // does not count against it - what is in use gets looked after, and a
  // blade carried for two centuries and then buried has only been rusting
  // for the years since it was buried.
  buriedYears(S, a, now) {
    let total = 0, since = -1;
    for (const o of a.owners) {
      if (o.how === 'taken out of the ground by') {
        if (since >= 0) { total += Math.max(0, o.from - since); since = -1; }
      } else if (o.how === 'went into the ground with' ||
                 o.how === 'lost on the field' ||
                 o.how === 'put into the ground for safety by') {
        if (since < 0) since = o.from;
      }
    }
    if (since >= 0) total += Math.max(0, now - since);
    return total;
  },

  // 1 is as-made, 0 is gone. Pure function of material and buried time.
  condition(S, a, now) {
    const keeps = this.KEEPS[a.mat] || 2000;
    return Math.exp(-this.buriedYears(S, a, now) / keeps);
  },

  conditionWord(c) {
    for (const [t, w] of this.CONDITION) if (c >= t) return w;
    return 'gone';
  },

  // ---- what the ground keeps ----
  deposit(S, i, j, kind, y, people, figure, artifact, cls) {
    const d = {
      id: S.deposits.length, i, j, kind, t: y, people,
      figure: figure === undefined ? null : figure,
      artifact: artifact === undefined ? null : artifact,
      cls: cls === undefined ? null : cls,
      robbed: -1, robbedBy: null,
    };
    S.deposits.push(d);
    return d;
  },

  // A grave is where a person's things stop moving. What goes in with them
  // depends on what they were: a captain takes their war-gear down, a lord
  // takes the cup they drank from.
  bury(S, f, y, place) {
    const home = S.sites[place === undefined ? f.home : place] ||
                 S.sites[S.peoples[f.people].capital];
    if (!home) return;
    // the burial ground sits just outside the settlement
    const i = clamp(home.i + (f.id % 3) - 1, 0, HIST.N - 1);
    const j = clamp(home.j + ((f.id >> 2) % 3) - 1, 0, HIST.N - 1);
    if (!f.holds.length) {
      if (this.rnd(70, f.id, y) > HIST.GRAVE_GOODS) return;
      this.deposit(S, i, j, 'grave', y, f.people, f.id, null,
                   f.role === 'captain' ? 'weapon' : 'wear');
    } else {
      // everything they had goes down with them; anything skipped here
      // would be an object that afterwards exists nowhere at all
      for (const aid of f.holds) {
        const a = S.artifacts[aid];
        a.owners.push({ who: f.id, from: y, how: 'went into the ground with' });
        a.rest = { i, j, t: y, how: 'grave', figure: f.id };
        this.deposit(S, i, j, 'grave', y, f.people, f.id, aid, a.cls);
      }
      f.holds = [];
    }
    this.log(S, y, f.people, 'was buried', null, home.id, f.cause, f.id);
  },

  // Later peoples dig up earlier ones. A robbed grave is empty, and that is
  // a story rather than a disappointment - the trench is still there, and
  // whatever came out of it went back into somebody's hands.
  rob(S, p, y, i, j) {
    for (const d of S.deposits) {
      if (d.robbed >= 0 || d.people === p.id) continue;
      if (y - d.t < HIST.ROB_WAIT) continue;
      if (Math.abs(d.i - i) > HIST.ROB_R || Math.abs(d.j - j) > HIST.ROB_R) continue;
      if (this.rnd(71, d.id, y) > HIST.ROB) continue;
      d.robbed = y;
      d.robbedBy = p.id;
      if (d.artifact !== null) {
        const a = S.artifacts[d.artifact];
        // Whoever was there, not always the seat. Funnelling every robbed
        // thing to the current lord put a large part of a world's treasure
        // into one grave, which is both unlikely and makes the whole record
        // of that world read as a single story.
        const here = [];
        for (const f of S.figures)
          if (f.people === p.id && this.figureAlive(S, f, y)) here.push(f);
        const taker = here.length ? this.pick(here, 72, d.id, y) : this.leader(S, p, y);
        // arms full: this one stays in the ground for somebody else to find
        if (taker && taker.holds.length >= HIST.HOLD_MAX) {
          d.robbed = -1; d.robbedBy = null; continue;
        }
        if (taker) {
          a.owners.push({ who: taker.id, from: y, how: 'taken out of the ground by' });
          a.rest = null;
          taker.holds.push(a.id);
        }
      }
      this.log(S, y, p.id, 'opened a grave of', d.people, null, null, null);
    }
  },

  // ---- war ----
  atWar(S, a, b) {
    for (const w of S.wars) {
      if (w.ended >= 0) continue;
      if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) return w;
    }
    return null;
  },

  declare(S, p, foe, y) {
    const w = {
      id: S.wars.length, a: p.id, b: foe.id, began: y, ended: -1,
      winner: null, battles: [], took: [],
      cause: this.pick(['a border', 'a road', 'an insult', 'a mine',
                        'a marriage refused', 'a grave opened'], 72, p.id, y),
    };
    S.wars.push(w);
    this.log(S, y, p.id, 'declared war on', foe.id, null, w.cause);
    return w;
  },

  peace(S, w, y, winner) {
    w.ended = y;
    w.winner = winner === null ? null : winner.id;
    this.log(S, y, w.a, winner ? 'lost the war to' : 'made peace with',
             w.b, null, null, null);
  },

  fight(S, w, y, dt) {
    const A = S.peoples[w.a], B = S.peoples[w.b];
    const la = this.living(S, A, y).length, lb = this.living(S, B, y).length;
    if (!la || !lb || A.fell >= 0 || B.fell >= 0) {
      return this.peace(S, w, y, !la ? B : !lb ? A : null);
    }
    if (this.rnd(73, w.id, y) < HIST.BATTLE * (dt / 10)) this.battle(S, w, y);
    if (y - w.began > HIST.WAR_LEN && this.rnd(74, w.id, y) < HIST.PEACE * (dt / 10))
      this.peace(S, w, y, null);
  },

  // Named for the ground rather than for the nearest settlement, which stays
  // the nearest for a whole war and made every battle in it share a name.
  // Fighting the same ford twice is real; saying it the same way twice is
  // what read as a stutter.
  FIELD_ORD: ['the field at ', 'the second field at ', 'the third field at ',
              'the fourth field at ', 'the fifth field at ', 'the sixth field at ',
              'the seventh field at '],
  fieldName(S, i, j, owner) {
    let prior = 0;
    for (const b of S.battles) if (b.i === i && b.j === j) prior++;
    return this.FIELD_ORD[Math.min(prior, this.FIELD_ORD.length - 1)] +
           this.nameFor(owner, 400 + i, j * 31 + 7);
  },

  strength(S, p, y, cmd) {
    let n = 0;
    for (const id of this.living(S, p, y)) n += S.sites[id].pop;
    return Math.max(1, n) * (cmd ? 1 + HIST.CMD_EDGE * clamp(cmd.wins / 5, 0, 1) : 1);
  },

  // A battle happens where the two peoples actually touch - between their
  // nearest living pair - and is decided mostly by weight of numbers, tilted
  // by whoever is commanding. What the loser drops stays on the field.
  battle(S, w, y) {
    const A = S.peoples[w.a], B = S.peoples[w.b];
    let pa = null, pb = null, pd = 1e9;
    for (const x of this.living(S, A, y)) for (const z of this.living(S, B, y)) {
      const sa = S.sites[x], sb = S.sites[z];
      const d = Math.hypot(sa.i - sb.i, sa.j - sb.j);
      if (d < pd) { pd = d; pa = sa; pb = sb; }
    }
    if (!pa) return null;
    let i = Math.round((pa.i + pb.i) / 2), j = Math.round((pa.j + pb.j) / 2);
    for (let n = 0; n < 4 && S.grid.water[j * HIST.N + i]; n++) {
      i = clamp(i + 1, 0, HIST.N - 1);              // nobody fights in the lake
      if (S.grid.water[j * HIST.N + i]) j = clamp(j + 1, 0, HIST.N - 1);
    }
    if (S.grid.water[j * HIST.N + i]) return null;
    const ca = this.captain(S, A, y), cb = this.captain(S, B, y);
    const sa = this.strength(S, A, y, ca), sb = this.strength(S, B, y, cb);
    const winA = this.rnd(75, w.id, y) < sa / (sa + sb);
    const win = winA ? A : B, lose = winA ? B : A;
    const wc = winA ? ca : cb, lc = winA ? cb : ca;
    const held = winA ? pb : pa;
    const b = {
      id: S.battles.length, war: w.id, t: y, i, j,
      x: this.wx(i), y: this.wy(j), a: A.id, b: B.id, winner: win.id,
      cmdWin: wc ? wc.id : null, cmdLose: lc ? lc.id : null,
      name: this.fieldName(S, i, j, held.people), fell: [],
    };
    S.battles.push(b);
    w.battles.push(b.id);
    // both sides now know the ground they fought over
    this.learn(S, A, i, j, HIST.KNOWN_SITE);
    this.learn(S, B, i, j, HIST.KNOWN_SITE);
    if (wc) { wc.wins++; this.deed(S, wc, y, 'won ' + b.name, held.id); }
    if (lc) {
      lc.losses++;
      if (this.rnd(76, lc.id, y) < HIST.CMD_FALLS) {
        lc.died = y;
        lc.cause = 'battle';
        b.fell.push(lc.id);
        for (const aid of lc.holds) {
          const a = S.artifacts[aid];
          a.owners.push({ who: null, from: y, how: 'lost on the field' });
          a.rest = { i, j, t: y, how: 'battle', figure: lc.id };
          this.deposit(S, i, j, 'battle', y, lose.id, lc.id, aid, a.cls);
        }
        lc.holds = [];
        this.log(S, y, lose.id, 'fell at', b.id, null, 'battle', lc.id);
      }
    }
    // war-gear, broken and dropped, whether or not anybody named was there
    this.deposit(S, i, j, 'battle', y, lose.id, null, null,
                 this.rnd(85, b.id, y) < 0.6 ? 'weapon' : 'armour');
    this.log(S, y, win.id, 'won a battle at', b.id, null, null, wc ? wc.id : null);
    if (this.rnd(77, b.id, y) < HIST.TAKES_SITE) {
      // The same mercy the disasters get: a people is not wiped off the map
      // in its first generation by one bad afternoon. Once it has been
      // something, it can be destroyed.
      const lp = S.peoples[held.people];
      const itsLast = this.living(S, lp, y).length <= 1 && lp.peak < 3;
      if (!itsLast) {
        this.abandon(S, held, y, 'sacked', win.id);
        w.took.push(held.id);
      }
    }
    return b;
  },

  // ---- heroes ----
  // A hero is not declared, only recognised. Renown is a count of what a
  // figure actually did, and the epithet is chosen from the deeds - so the
  // name a people remembers somebody by is a fact about them.
  // One measure per role. Counting a smith's objects *and* the deed each one
  // logged scored them three times over for the same act, which is how they
  // came to be four fifths of everyone remembered.
  renownOf(f) {
    const gone = f.cause === 'battle' || f.cause === 'the deep' || f.cause === 'the wild';
    let n;
    // Capped, because these accumulate with reuse: one explorer can walk out
    // a dozen times in a life and one smith can work for forty years, while
    // a captain needs a war to win anything at all. Uncapped, the people a
    // world remembers are simply whoever had the most repeatable job.
    if (f.role === 'captain') n = f.wins * 4;
    else if (f.role === 'smith') n = Math.min(f.made, 6) * 2;
    else if (f.role === 'explorer') n = Math.min(f.deeds.length, 5) * 2;
    else if (f.role === 'settler') n = f.deeds.length * 3;
    else n = f.deeds.length;
    // a long reign is its own kind of being remembered
    if (f.led >= 0) n += 2 + (f.died >= 0 ? Math.floor((f.died - f.led) / 25) : 0);
    return n + (gone ? 3 : 0);
  },

  // A thing is legendary for the same reason a person is: because of what
  // happened to it. Hands it passed through, whether somebody remembered
  // carried it, whether it was lost on a field, and how often the ground
  // has failed to keep it.
  // Which peoples have ever had their hands on it. An object that outlived
  // the people who made it and was picked up by another is the single
  // strongest sign that a story is attached to it.
  crossed(S, a) {
    const seen = new Set([a.people]);
    for (const o of a.owners) if (o.who !== null) seen.add(S.figures[o.who].people);
    return seen.size;
  },

  fameOf(S, a, heroes) {
    let n = a.owners.length;
    for (const o of a.owners) {
      if (o.how === 'taken out of the ground by') n += 3;
      if (o.how === 'lost on the field') n += 5;
      if (o.how === 'put into the ground for safety by') n += 4;
      if (o.how === 'lost in the wild with') n += 5;
      if (o.who !== null && heroes.has(o.who)) n += 5;
    }
    n += (this.crossed(S, a) - 1) * 4;
    n += Math.floor((S.now - a.made) / 2000);   // sheer survival counts a little
    n += (this.WORTH[a.mat] || 0) + (this.CLASS_WORTH[a.cls] || 0);
    return n;
  },

  // What to call a thing, read off its own history. Current resting place
  // first, because a title that says "lost on the field" about something
  // sitting in a barrow is simply wrong - it was recovered and reburied,
  // and that is a different story worth telling.
  // What to call a thing, read off its own history. Ordered most specific
  // first: where it lies now, then what befell it, then who had it, and
  // only at the bottom the generic counts - which will otherwise catch
  // almost everything on the way past and flatten the whole list.
  titleFor(S, a, heroes) {
    const robbed = a.owners.filter(o => o.how === 'taken out of the ground by').length;
    const wasLost = a.owners.some(o => o.how === 'lost on the field');
    const hero = a.owners.find(o => o.who !== null && heroes.has(o.who));
    const peoples = this.crossed(S, a);
    const how = a.rest ? a.rest.how : null;
    if (how === 'battle') return 'lost on the field and never lifted';
    if (wasLost) return 'taken off a battlefield and buried again';
    if (how === 'hoard') return 'hidden against a bad year, and never come back for';
    if (how === 'lost') return 'out in the country with ' +
      S.figures[a.rest.figure].name + ', who did not come back';
    if (hero) return 'which ' + S.figures[hero.who].name + ' carried';
    if (heroes.has(a.madeBy)) return 'out of the hands of ' + S.figures[a.madeBy].name;
    if (peoples > 1) {
      // who actually had it, in the order they had it
      const chain = [], seen = new Set();
      const add = pid => { if (!seen.has(pid)) { seen.add(pid); chain.push(S.peoples[pid].name); } };
      add(a.people);
      for (const o of a.owners) if (o.who !== null) add(S.figures[o.who].people);
      if (chain.length > 2) return 'held by ' + chain.join(', then ');
      if (robbed >= 3) return 'which will not stay buried';
      // Name the person who lifted it, not just their people: within one
      // world the same two peoples do most of the robbing, so the pair alone
      // reads as one story told over and over. A name is also better telling.
      const lifter = a.owners.find(o => o.how === 'taken out of the ground by');
      if (lifter && lifter.who !== null) {
        const base = 'put in the ground by ' + chain[0] + ', and taken out of it by ' +
                     S.figures[lifter.who].name;
        // where it finally came to rest separates things that one lord took
        // out of one people's graves in a single sweep
        if (a.rest && a.rest.figure !== null && a.rest.figure !== lifter.who)
          return base + ', to lie with ' + S.figures[a.rest.figure].name;
        return base;
      }
      return 'buried by ' + chain[0] + ' and dug up by ' + chain[1];
    }
    if (robbed >= 3) return 'which will not stay buried';
    if (!how) return 'never put down';
    // How it would actually come up is a fact worth leading with, and it is
    // the one thing that separates two objects with the same history.
    const cond = this.condition(S, a, S.now);
    const under = this.buriedYears(S, a, S.now);
    if (cond < 0.08) return 'gone to nothing but its own shape in the soil';
    if (cond > 0.95 && under > 2000)
      return Math.round(under / 100) + ' centuries under, and still bright';
    if (robbed >= 1) return 'dug up ' + robbed + (robbed === 1 ? ' time' : ' times') + ' since';
    // for anything still lying where it was put, say who it is lying with
    if (a.rest && a.rest.figure !== null)
      return 'in the ground with ' + S.figures[a.rest.figure].name + ' since ' + a.rest.t;
    if (S.now - a.made > HIST.SPAN * 0.75) return 'out of the first years, and still whole';
    if ((this.WORTH[a.mat] || 0) >= 2) return 'still where it was put, and worth the digging';
    return 'through ' + a.owners.length + ' pairs of hands';
  },

  crown(S) {
    for (const f of S.figures) f.renown = this.renownOf(f);
    const ranked = S.figures.slice().sort((a, b) => b.renown - a.renown || a.id - b.id);
    S.heroes = ranked.filter(f => f.renown >= HIST.HERO_MIN)
                     .slice(0, HIST.HEROES).map(f => f.id);
    for (const id of S.heroes) {
      const f = S.figures[id];
      const kind = f.cause === 'the deep' ? 'deep'
                 : f.role === 'explorer' ? 'far'
                 : f.wins >= 2 ? 'war'
                 : f.made > 0 ? 'make' : 'lead';
      f.epithet = this.pick(this.EPITHET[kind], 90, f.id, f.born);
    }
    // and the things. Fame is reckoned after the people, because carrying a
    // thing is one of the ways a thing becomes worth carrying.
    const heroes = new Set(S.heroes);
    for (const a of S.artifacts) a.fame = this.fameOf(S, a, heroes);
    S.legends = S.artifacts.slice()
      .sort((x, z) => z.fame - x.fame || x.id - z.id)
      .slice(0, HIST.LEGENDS).map(a => a.id);
    for (const id of S.legends) S.artifacts[id].title = this.titleFor(S, S.artifacts[id], heroes);
  },

  // ---- what an ordinary dig turns up ----
  // The named things are a few dozen; potsherds and broken tools are without
  // end, so they are a function rather than a list. How long people stood
  // here and how long ago is the whole of it.
  bulkAt(S, i, j, now) {
    let years = 0, last = -1, who = -1;
    for (const s of S.sites) {
      if (Math.abs(s.i - i) > 1 || Math.abs(s.j - j) > 1) continue;
      const end = s.abandoned < 0 ? now : s.abandoned;
      years += Math.max(0, end - s.founded);
      if (end > last) { last = end; who = s.people; }
    }
    if (!years) return null;
    return {
      density: clamp(years / 600, 0, 1),
      people: who,
      depth: this.buryDepth(S, i, j, last < 0 ? 0 : now - last),
      what: who < 0 ? [] : ['potsherds', 'charcoal', 'bone', 'broken ' +
        (S.peoples[who].delve > 1.2 ? 'tools' : 'vessels')],
    };
  },

  // ---- what is left, at a given year ----
  // None of this is stored. Age since the roof went, plus the material and
  // the ground it stands on, is the whole model.
  roofYears(s) { return s.mat === 'timber' ? HIST.ROOF_TIMBER : HIST.ROOF_STONE; },
  wallYears(s) { return s.mat === 'timber' ? HIST.WALL_TIMBER : HIST.WALL_STONE; },

  // 0 lived-in, 1 standing but empty, 2 roofless, 3 walls falling,
  // 4 footprint only, 5 nothing above ground
  stage(S, s, now) {
    if (s.abandoned < 0 || now < s.abandoned) return 0;
    const age = now - s.abandoned;
    if (age < this.roofYears(s) * 0.4) return 1;
    if (age < this.roofYears(s)) return 2;
    if (age < this.wallYears(s)) return 3;
    if (this.sink(S, s, now) < HIST.GONE_DEPTH) return 4;
    return 5;
  },

  // Descent begins when the roof does. Soft valley ground swallows a
  // building; on rock it barely moves, which is why some old walls are
  // still standing where nothing else is.
  sink(S, s, now) {
    if (s.abandoned < 0 || now < s.abandoned) return 0;
    const roofless = now - s.abandoned - this.roofYears(s);
    if (roofless <= 0) return 0;
    return this.buryDepth(S, s.i, s.j, roofless);
  },

  // Saturating, not linear: a thing settles until it meets ground that will
  // not take it, and then stops. Six thousand years fits in the top three
  // metres - roughly what a real site accumulates - so the whole record is
  // spade-depth, and everything below it belongs to the caves rather than
  // to people. Buildings and grave goods share the one curve.
  buryDepth(S, i, j, years) {
    if (years <= 0) return 0;
    const k = j * HIST.N + i;
    const soft = clamp(S.grid.soil[k] / MATS.SOIL_MAX, 0, 1);
    const rate = HIST.SINK_HARD + (HIST.SINK_SOFT - HIST.SINK_HARD) * soft;
    return HIST.SINK_MAX * rate * (1 - Math.exp(-years / HIST.SINK_TAU));
  },

  depositDepth(S, d, now) { return this.buryDepth(S, d.i, d.j, now - d.t); },

  // A road stops being repaired when either end dies. After that it is a
  // hollow-way: still visibly straight, slowly filling in.
  linkLive(S, l, y) {
    const a = S.sites[l.a], b = S.sites[l.b];
    const ends = [a, b].map(s => s.abandoned < 0 ? Infinity : s.abandoned);
    return Math.min(ends[0], ends[1]);
  },
};
