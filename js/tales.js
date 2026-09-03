// What is remembered out loud, and how badly.
//
// The halls carry the record cut into stone. This is the other half of it:
// the part that got here by being told. Same chronicle - the same people,
// the same things they made, the same fields they fought on - but spoken by
// somebody who has it from somebody who had it.
//
// Which is the point. Nobody remembers six thousand years. What an elder
// says is graded by how far back it goes:
//
//   history      inside living memory. Right.
//   remembered   a few centuries. Right in the main.
//   myth         deep time. The numbers have grown, the causes have been
//                improved, and somebody else's work has been handed to a
//                better-known name.
//   lost         he knows the thing existed and nothing else about it.
//
// Every tale therefore carries two things: what he SAYS, and what actually
// happened. The walls have the second one. That gap is the game - you are
// told a story, you go down and read what was cut at the time, and the two
// do not agree. Nothing here is authored: the true side is the simulation's
// own record, and the false side is a listed, checkable corruption of it.
const Tales = {
  WIDTH: 50,        // the widest a spoken line may be
  HOLDS: 12,        // how many one elder carries

  // Where the bands fall, in years before now. A long life is about eighty,
  // so HISTORY is roughly "somebody I could have asked", REMEMBERED is
  // three or four tellings, and past that it is all telling.
  HISTORY: 300,
  REMEMBERED: 1200,
  LOST_IN: 4,       // one myth in this many has lost its details entirely

  // ---- saying it ----

  // A spoken sentence starts with a capital even when it opens on a name
  // the chronicle wrote lower case ("the nine-fold gold gauntlets of...").
  said(str) {
    const t = String(str);
    const i = t.search(/[A-Za-z]/);
    return i < 0 ? t : t.slice(0, i) + t[i].toUpperCase() + t.slice(i + 1);
  },

  // Break a sentence over lines without splitting a word. Everything here
  // is prose of unknown length - a title can run to sixty characters on its
  // own - so nothing is laid out by hand.
  wrap(str, w) {
    const width = w || this.WIDTH;
    const out = [];
    let line = '';
    for (const word of String(str).split(/\s+/)) {
      if (!word) continue;
      if (!line) { line = word; continue; }
      if (line.length + 1 + word.length <= width) { line += ' ' + word; continue; }
      out.push(line);
      line = word;
    }
    if (line) out.push(line);
    return out;
  },

  // ---- how well he has it ----

  // How reliable a thing this old is, in his mouth. Deterministic in the
  // thing's own key, so the same tale is wrong the same way every run.
  grade(S, t, key) {
    const age = S.now - t;
    if (age <= this.HISTORY) return { truth: 'history', age };
    if (age <= this.REMEMBERED) return { truth: 'remembered', age };
    const lost = jsUhash(key >>> 0, (CFG.SEED ^ 0x1057) >>> 0) % this.LOST_IN === 0;
    return { truth: lost ? 'lost' : 'myth', age };
  },

  // A number that has grown in the telling. Small counts multiply; large
  // ones round upward to something impressive. Those are the two ways a
  // number actually drifts when it is passed along by people who were not
  // there, and neither of them ever makes it smaller.
  swell(n, key) {
    const r = jsUhash(key >>> 0, (CFG.SEED ^ 0x5E11) >>> 0) % 3;
    if (n < 20) return n * (r === 0 ? 10 : r === 1 ? 7 : 3);
    return Math.round(n / 100 + 1) * 100;
  },

  // A year that has been rounded off by being passed along. This is the one
  // distortion every myth gets, because it is the one that always happens:
  // nobody who has a story third-hand has the year to the year, and what
  // comes out of a mouth instead is a round number. It also guarantees that
  // every myth is wrong about SOMETHING the walls can contradict - the
  // specific slips below only fire when the shape of the record allows it,
  // and a myth with nothing wrong in it defeats the whole arrangement.
  driftYear(y, truth, slips, what) {
    if (truth !== 'myth') return y;
    const said = Math.round(y / 100) * 100;
    if (said !== y) slips.push({ field: what, said, real: y });
    return said;
  },

  // How he hedges. A myth is not said with the same confidence as a thing
  // his grandfather saw, and saying so out loud is what tells the player
  // which of the two they are being handed.
  HEDGE: {
    history: '',
    remembered: 'They had this from their fathers, so take it as that. ',
    myth: 'This is old, and I have it third-hand. ',
    lost: '',
  },

  // ---- where a thing or a person ended up ----

  // The cell a deposit sits in, in world units. Graves and hoards are
  // recorded on the simulation's own grid, which is coarse - a cell is 128
  // units - so this is where to go and look, not where to put a pin.
  spot(k) {
    return [Chronicle.wx(k.i), Chronicle.wy(k.j)];
  },

  graveOf(S, figureId) {
    for (const d of S.deposits) {
      if (d.kind === 'grave' && d.figure === figureId) return d;
    }
    return null;
  },

  // How far off a thing is. A myth does not come with a distance: he knows
  // roughly which way and nothing more, which is the whole difference
  // between a lead you can walk and a story you cannot.
  whereFrom(n, x, y, truth) {
    const dx = x - n.x, dy = y - n.y;
    const d = Math.hypot(dx, dy);
    if (d < 20) return 'It is here, under your feet.';
    const way = Quest.bearing(dx, dy);
    if (truth === 'myth') return 'Somewhere ' + way + ' of here. That is all I have.';
    return 'It lies ' + way + ' of here, ' +
           Math.max(1, Math.round(d / 10)) + ' leagues.';
  },

  // ---- the three kinds of thing worth telling ----

  // A person. Their people, their trade, the span of them, and the one deed
  // the record keeps them for - with however much of that has drifted.
  hero(S, id, n) {
    const f = S.figures[id];
    if (!f) return null;
    const p = S.peoples[f.people];
    const g = this.grade(S, f.died, f.id * 7 + 1);
    const head = (f.name + (f.epithet ? ', ' + f.epithet : '')).toUpperCase();
    const body = [];
    const slips = [];
    const real = { people: p.name, role: f.role, born: f.born, died: f.died,
                   cause: f.cause || 'age', wins: f.wins };

    if (g.truth === 'lost') {
      body.push(...this.wrap('"There was one called ' + f.name + ', of ' +
        p.name + '. That is the whole of what came down - a name, and that ' +
        'they were somebody. Whatever they did, nobody told it to anybody ' +
        'who told it to me."'));
      return { id: 'h' + f.id, kind: 'hero', head, body, x: null, y: null,
               place: null, truth: g.truth, age: g.age, slips, real,
               subject: f.name };
    }

    // Deep enough back and the cause of death improves. Nobody's ancestor
    // died of being old.
    let cause = f.cause || 'age';
    if (g.truth === 'myth' && cause === 'age') {
      cause = 'a wound taken on a field';
      slips.push({ field: 'cause', said: cause, real: real.cause });
    }
    // A myth gives you the death and not the birth. That is how it comes
    // down: somebody is remembered for ending, not for starting, and
    // rounding both to the century had Aelmor born and dead in the 4600th.
    const diedSaid = this.driftYear(f.died, g.truth, slips, 'died');
    const born = g.truth === 'myth'
      ? 'Nobody has the year ' + f.name + ' was born.'
      : 'Born in the ' + Lore.ord(f.born) + ' year, and';
    body.push(...this.wrap(this.HEDGE[g.truth] + '"' + f.name + ' was ' +
      p.name + ', and their ' + f.role + '. ' + born +
      (g.truth === 'myth' ? ' They were gone by the ' : ' gone by the ') +
      Lore.ord(diedSaid) + ', of ' + cause + '.'));

    const deeds = (f.deeds || []).filter(d => d.what);
    if (deeds.length) {
      const d = deeds[jsUhash(f.id >>> 0, 41) % deeds.length];
      body.push('');
      body.push(...this.wrap(f.name + ' ' + d.what + ', in the ' +
                             Lore.ord(d.t) + ' year.'));
    }
    if (f.wins > 0) {
      const say = g.truth === 'myth' ? this.swell(f.wins, f.id * 13) : f.wins;
      if (say !== f.wins) slips.push({ field: 'wins', said: say, real: f.wins });
      body.push('');
      body.push(...this.wrap(f.losses === 0
        ? 'Never beaten on a field, and there were ' + say + ' of them.'
        : say + ' fields won, ' + f.losses + ' lost.'));
    }

    const grave = this.graveOf(S, f.id);
    let x = null, y = null;
    if (grave) {
      [x, y] = this.spot(grave);
      body.push('');
      body.push(...this.wrap(f.name + ' was laid in the ground in the ' +
        Lore.ord(grave.t) + ' year. ' + this.whereFrom(n, x, y, g.truth) + '"'));
    } else {
      body[body.length - 1] += '"';
    }
    return { id: 'h' + f.id, kind: 'hero', head, body, x, y,
             place: f.name + "'s grave", truth: g.truth, age: g.age,
             slips, real, subject: f.name };
  },

  // A thing. The chronicle already reckons why each of these is worth
  // remembering and writes it as one line, so that line is the tale - and
  // in deep time the maker is whoever the teller has heard of.
  thing(S, id, n) {
    const a = S.artifacts[id];
    if (!a) return null;
    const g = this.grade(S, a.rest ? a.rest.t : a.made, a.id * 11 + 3);
    const head = a.name.toUpperCase();
    const body = [];
    const slips = [];
    const maker = a.madeBy !== null && S.figures[a.madeBy]
      ? S.figures[a.madeBy].name : null;
    const real = { made: a.made, maker, mat: a.mat,
                   people: S.peoples[a.people] ? S.peoples[a.people].name : null };

    if (g.truth === 'lost') {
      body.push(...this.wrap('"There was a thing called ' + a.name + '. I ' +
        'could not tell you who made it, nor what became of it. It is a name ' +
        'with nothing hanging off it."'));
      return { id: 'a' + a.id, kind: 'thing', head, body, x: null, y: null,
               place: null, truth: g.truth, age: g.age, slips, real,
               subject: a.name };
    }

    let saidMaker = maker;
    if (g.truth === 'myth' && (S.heroes || []).length) {
      const famous = S.figures[S.heroes[jsUhash(a.id >>> 0, 61) % S.heroes.length]];
      if (famous && famous.name !== maker) {
        saidMaker = famous.name;
        slips.push({ field: 'maker', said: saidMaker, real: maker });
      }
    }
    const madeSaid = this.driftYear(a.made, g.truth, slips, 'made');
    body.push(...this.wrap(this.said(this.HEDGE[g.truth] + '"' + a.name +
      ', made in the ' + Lore.ord(madeSaid) + ' year' +
      (saidMaker ? ' by ' + saidMaker : '') + ', of ' + a.mat + '.')));
    if (a.title) {
      body.push('');
      body.push(...this.wrap('It is the one ' + a.title + '.'));
    }
    let x = null, y = null;
    if (a.rest) {
      [x, y] = this.spot(a.rest);
      const how = a.rest.how === 'grave' ? 'It went into the ground with the dead'
                : a.rest.how === 'hoard' ? 'It was hidden away'
                : a.rest.how === 'battle' ? 'It was dropped on the field'
                : a.rest.how === 'votive' ? 'It was given to the water'
                : 'It was lost';
      body.push('');
      body.push(...this.wrap(how + ' in the ' + Lore.ord(a.rest.t) +
        ' year, and nobody has lifted it since. ' +
        this.whereFrom(n, x, y, g.truth) + '"'));
    } else {
      body[body.length - 1] += '"';
    }
    return { id: 'a' + a.id, kind: 'thing', head, body, x, y, place: a.name,
             truth: g.truth, age: g.age, slips, real, subject: a.name };
  },

  // A field. Who met on it, who had the day, and who did not come off it.
  field(S, id, n) {
    const b = S.battles[id];
    if (!b) return null;
    const A = S.peoples[b.a], B = S.peoples[b.b];
    if (!A || !B) return null;
    const g = this.grade(S, b.t, b.id * 17 + 5);
    const won = S.peoples[b.winner];
    const body = [];
    const slips = [];
    const real = { t: b.t, winner: won ? won.name : null, a: A.name, b: B.name };

    if (g.truth === 'lost') {
      body.push(...this.wrap('"They fought at ' + b.name + ' once. Who, and ' +
        'over what, and who walked off it - none of that came down. The ' +
        'ground kept the name and let the rest go."'));
      return { id: 'b' + b.id, kind: 'field', head: b.name.toUpperCase(),
               body, x: b.x, y: b.y, place: b.name, truth: g.truth, age: g.age,
               slips, real, subject: b.name };
    }

    const metSaid = this.driftYear(b.t, g.truth, slips, 't');
    body.push(...this.wrap(this.said(this.HEDGE[g.truth] + '"' + A.name +
      ' and ' + B.name + ' met at ' + b.name + ' in the ' + Lore.ord(metSaid) +
      ' year.')));
    body.push('');
    // The side that lost is the side that gets forgotten, and in deep time
    // the teller's own people have a way of turning up on the winning one.
    let saidWinner = won ? won.name : 'neither';
    if (g.truth === 'myth' && won) {
      // The teller's own people turn up on the winning side when they were
      // there at all; otherwise the day simply goes to the wrong one, which
      // is what happens to a battle nobody alive has a stake in.
      const mine = (b.a === n.people || b.b === n.people) && n.peopleName;
      const other = won.id === b.a ? S.peoples[b.b] : S.peoples[b.a];
      const flip = mine ? n.peopleName
                 : (jsUhash(b.id >>> 0, 77) % 2 === 0 && other) ? other.name : null;
      if (flip && flip !== won.name) {
        saidWinner = flip;
        slips.push({ field: 'winner', said: saidWinner, real: won.name });
      }
    }
    body.push(...this.wrap('The day went to ' + saidWinner + '.'));
    const lost = b.cmdLose !== null && S.figures[b.cmdLose] ? S.figures[b.cmdLose] : null;
    const win = b.cmdWin !== null && S.figures[b.cmdWin] ? S.figures[b.cmdWin] : null;
    if (win) body.push(...this.wrap(win.name + ' led the side that held it.'));
    if (lost) body.push(...this.wrap(lost.name + ' led the side that did not.'));
    body.push('');
    body.push(...this.wrap(this.whereFrom(n, b.x, b.y, g.truth) + '"'));
    return { id: 'b' + b.id, kind: 'field', head: b.name.toUpperCase(),
             body, x: b.x, y: b.y, place: b.name, truth: g.truth, age: g.age,
             slips, real, subject: b.name };
  },

  // The first thing anybody tells you, and the only one that is about the
  // ground rather than about the past: there is a record down there, and
  // here is which way the nearest way down lies. Everything else in this
  // game is found by walking, and this is what makes walking worth it.
  HALLS_SCAN: 6,      // shaft cells searched either way; 48 units to a cell

  halls(S, n) {
    const body = [];
    const cut = S.peoples.filter(p => p.founded).map(p => p.name);
    body.push(...this.wrap('"The peoples before us cut halls under this ' +
      'country and wrote on the walls as they went. ' +
      (cut.length ? cut.join(', ') + ' - all of them.' : '')));
    body.push('');
    body.push(...this.wrap('The deeper you go the later it gets, so the ' +
      'end of a people is in the lowest gallery they cut.'));
    body.push('');
    body.push(...this.wrap('What is cut is what they knew at the time. What ' +
      'I have is what got said over it since. Where the two disagree, the ' +
      'stone is right and I am old.'));
    const way = this.nearestWayDown(n.x, n.y);
    body.push('');
    if (way) {
      body.push(...this.wrap('There is a way down ' +
        Quest.bearing(way.ax - n.x, way.ay - n.y) + ' of here, ' +
        Math.max(1, Math.round(Math.hypot(way.ax - n.x, way.ay - n.y) / 10)) +
        ' leagues. Find it, and read what they cut."'));
    } else {
      body.push(...this.wrap('Find a way down, and read what they cut."'));
    }
    return { id: 'halls', kind: 'halls', head: 'WHAT IS UNDER THE GROUND',
             body, x: way ? way.ax : null, y: way ? way.ay : null,
             place: 'the way down', truth: 'history', age: 0, slips: [],
             real: {}, subject: 'the halls' };
  },

  nearestWayDown(x, y) {
    const E = CAVES.SHAFT_E;
    const cx = Math.floor(x / E), cy = Math.floor(y / E);
    let best = null, bd = Infinity;
    for (let j = -this.HALLS_SCAN; j <= this.HALLS_SCAN; j++) {
      for (let i = -this.HALLS_SCAN; i <= this.HALLS_SCAN; i++) {
        const a = shaftAt(cx + i, cy + j, 0);
        if (!a) continue;
        const d = (a.ax - x) ** 2 + (a.ay - y) ** 2;
        if (d < bd) { bd = d; best = a; }
      }
    }
    return best;
  },

  // ---- who knows what ----

  // An elder's memory, best first and the three kinds interleaved so it is
  // not eight lords and then eight brooches. The famous are remembered by
  // everybody, which is what the chronicle's own ranking already means, so
  // this walks down the top of each list rather than picking at random.
  forNpc(n) {
    if (!n || !n.elder) return [];
    const S = Lore.init();
    const out = [this.halls(S, n)];
    const heroes = S.heroes || [], legends = S.legends || [];
    const fields = (S.battles || []).map(b => b.id);
    for (let i = 0; out.length < this.HOLDS; i++) {
      const before = out.length;
      if (i < legends.length) { const t = this.thing(S, legends[i], n); if (t) out.push(t); }
      if (out.length < this.HOLDS && i < heroes.length) {
        const t = this.hero(S, heroes[i], n); if (t) out.push(t);
      }
      if (out.length < this.HOLDS && i < fields.length) {
        const t = this.field(S, fields[i], n); if (t) out.push(t);
      }
      if (out.length === before) break;      // all three lists are spent
    }
    return out;
  },

  byId(n, id) {
    for (const t of this.forNpc(n)) if (t.id === id) return t;
    return null;
  },

  // The next one you have not heard, or null when there is no more of it.
  next(n, heard) {
    for (const t of this.forNpc(n)) if (heard.indexOf(t.id) < 0) return t;
    return null;
  },

  // The ones he has wrong, for whoever wants to send you to check. A tale
  // with a slip in it can be contradicted by a wall; a lost one cannot be
  // contradicted by anything, which is its own kind of answer.
  doubtful(n) {
    return this.forNpc(n).filter(t => t.slips.length || t.truth === 'lost');
  },
};
