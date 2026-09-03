// What is remembered out loud.
//
// The halls carry the record cut into stone. This is the other half of it:
// the part that got here by being told. Same chronicle - the same people,
// the same things they made, the same fields they fought on - but spoken by
// somebody who has it from somebody who had it, which is the only way
// anything from before the living reaches you at all.
//
// Nothing here is authored. A tale is the simulation's own record of a
// person, a thing or a battle, said the way a person would say it, and
// every name, year and cause in it is one the run actually produced. Two
// visits to a seed hear the same tales in the same order.
const Tales = {
  WIDTH: 50,        // the widest a spoken line may be
  HOLDS: 12,        // how many one elder carries

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

  // How far off a thing is, said the way the myth and the quests say it:
  // one of eight points and a distance in leagues, and nothing marked.
  whereFrom(n, x, y) {
    const dx = x - n.x, dy = y - n.y;
    const d = Math.hypot(dx, dy);
    if (d < 20) return 'It is here, under your feet.';
    return 'It lies ' + Quest.bearing(dx, dy) + ' of here, ' +
           Math.max(1, Math.round(d / 10)) + ' leagues.';
  },

  // ---- where a thing or a person ended up ----

  // The cell a deposit sits in, in world units. Graves and hoards are
  // recorded on the simulation's own grid, which is coarse - a cell is 128
  // units - so this is where to go and dig, not where to put a pin.
  spot(k) {
    return [Chronicle.wx(k.i), Chronicle.wy(k.j)];
  },

  graveOf(S, figureId) {
    for (const d of S.deposits) {
      if (d.kind === 'grave' && d.figure === figureId) return d;
    }
    return null;
  },

  // ---- the three kinds of thing worth telling ----

  // A person. Their people, their trade, the span of them, and the one
  // deed the record keeps them for.
  hero(S, id, n) {
    const f = S.figures[id];
    if (!f) return null;
    const p = S.peoples[f.people];
    const head = (f.name + (f.epithet ? ', ' + f.epithet : '')).toUpperCase();
    const body = [];
    body.push(...this.wrap('"' + f.name + ' was ' + p.name + ', and their ' +
      f.role + '. Born in the ' + Lore.ord(f.born) + ' year, and gone by the ' +
      Lore.ord(f.died) + ', of ' + (f.cause || 'age') + '.'));
    // Their own deeds, in the record's own words. Named rather than
    // pronouned: the chronicle does not record who anybody was, and
    // guessing it out loud would be inventing something.
    const deeds = (f.deeds || []).filter(d => d.what);
    if (deeds.length) {
      const d = deeds[jsUhash(f.id >>> 0, 41) % deeds.length];
      body.push('');
      body.push(...this.wrap(f.name + ' ' + d.what + ', in the ' +
                             Lore.ord(d.t) + ' year.'));
    }
    // A win/loss tally was here and read as a scoreboard rather than as
    // something a person would say out loud. The deed above it is what
    // they are actually remembered for, which is the better line anyway.
    if (f.wins > 1 && f.losses === 0) {
      body.push('');
      body.push(...this.wrap('Never beaten on a field, and there were ' +
                             f.wins + ' of them.'));
    }
    const g = this.graveOf(S, f.id);
    let x = null, y = null;
    if (g) {
      [x, y] = this.spot(g);
      body.push('');
      body.push(...this.wrap(f.name + ' was laid in the ground in the ' +
                             Lore.ord(g.t) + ' year. ' + this.whereFrom(n, x, y) + '"'));
    } else {
      body[body.length - 1] += '"';
    }
    return { id: 'h' + f.id, kind: 'hero', head, body, x, y,
             place: f.name + "'s grave" };
  },

  // A thing. The chronicle already reckons why each of these is worth
  // remembering and writes it as one line, so that line is the tale.
  thing(S, id, n) {
    const a = S.artifacts[id];
    if (!a) return null;
    const head = a.name.toUpperCase();
    const body = [];
    const maker = a.madeBy !== null && S.figures[a.madeBy]
      ? S.figures[a.madeBy].name : null;
    body.push(...this.wrap(this.said('"' + a.name + ', made in the ' +
      Lore.ord(a.made) + ' year' + (maker ? ' by ' + maker : '') +
      ', of ' + a.mat + '.')));
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
                             this.whereFrom(n, x, y) + '"'));
    } else {
      body[body.length - 1] += '"';
    }
    return { id: 'a' + a.id, kind: 'thing', head, body, x, y, place: a.name };
  },

  // A field. Who met on it, who had the day, and who did not come off it.
  field(S, id, n) {
    const b = S.battles[id];
    if (!b) return null;
    const A = S.peoples[b.a], B = S.peoples[b.b];
    if (!A || !B) return null;
    const won = S.peoples[b.winner];
    const body = [];
    body.push(...this.wrap(this.said('"' + A.name + ' and ' + B.name +
      ' met at ' + b.name + ' in the ' + Lore.ord(b.t) + ' year.')));
    body.push('');
    body.push(...this.wrap('The day went to ' + (won ? won.name : 'neither') + '.'));
    const lost = b.cmdLose !== null && S.figures[b.cmdLose] ? S.figures[b.cmdLose] : null;
    const win = b.cmdWin !== null && S.figures[b.cmdWin] ? S.figures[b.cmdWin] : null;
    if (win) body.push(...this.wrap(win.name + ' led the side that held it.'));
    if (lost) body.push(...this.wrap(lost.name + ' led the side that did not.'));
    body.push('');
    body.push(...this.wrap(this.whereFrom(n, b.x, b.y) + '"'));
    return { id: 'b' + b.id, kind: 'field', head: b.name.toUpperCase(),
             body, x: b.x, y: b.y, place: b.name };
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
             place: 'the way down' };
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
    // battles by how much turned on them: a war's first field is its story
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
};
