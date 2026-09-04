// What somebody wants from you, and in what order.
//
// Nobody hands over a list. Every person carries a CHAIN of two to four
// steps, you are given one at a time, and the next is not offered until the
// one in front of it is finished. So a conversation you have already had is
// worth having again, and a person you walked past in the first hour has
// something different to say in the fourth.
//
// Three kinds of step, and they are the three things the game can actually
// check without inventing a system to check them with:
//
//   seek   stand in a place the record names
//   read   read what was cut in a hall, at a given depth
//   ask    hear a particular thing out of the elder
//
// The last two are what make the chains interlock. The elder's memory is
// graded and some of it is wrong (js/tales.js); a chain can send you to him
// for a story and then down a stair to find out the story is not what was
// cut at the time. That is the whole loop: told, checked, corrected.
//
// There used to be a fourth kind - fetch me five wood - and it is gone. It
// asked nothing of the six thousand years behind the person saying it.
//
// A quest to lift a NAMED object is still not here, because relics are not
// carryable: no item holds an artifact and nothing digs one out of a
// deposit. The chains point at where they lie; picking one up is next.
const Quest = {
  ARRIVE: 14,        // how near a place you must get for it to count
  // How far a person will send you. Walking is 4.2 units a second, so the
  // far end of this is a couple of minutes out and the same back - far
  // enough to be a journey, near enough to be one you finish.
  SEEK_MIN: 120,
  SEEK_MAX: 900,
  MIN_STEPS: 2,
  MAX_STEPS: 4,

  // ---- the chain ----

  // Everything one person will ever ask, in order. Deterministic in their
  // id, so a chain is the same on every run of a seed and a step you have
  // finished cannot be re-rolled into something else.
  chain(n) {
    if (!n) return [];
    if (this._chains && this._chainOf === Lore.S && this._chains[n.id]) {
      return this._chains[n.id];
    }
    const S = Lore.init();
    const want = this.MIN_STEPS +
      jsUhash(n.id >>> 0, (CFG.SEED ^ 0xC4A1) >>> 0) % (this.MAX_STEPS - this.MIN_STEPS + 1);
    const steps = [];
    const used = new Set();
    // The order is the story: go and look at a place, go down and read what
    // was cut under it, go and ask the old one what is said about it, then
    // go and stand where the two of them disagree.
    const builders = n.elder
      ? [this.stepDoubt, this.stepRead, this.stepLift, this.stepDeep]
      : [this.stepPlace, this.stepRead, this.stepAsk, this.stepLift, this.stepDeep];
    for (const make of builders) {
      if (steps.length >= want) break;
      const st = make.call(this, S, n, steps.length, used);
      if (st) { steps.push(st); used.add(st.key); }
    }
    // Everybody has something. A person the record gives nothing to still
    // wants what everybody in this world wants, which is to know what is
    // written under their own feet.
    if (!steps.length) {
      const st = this.stepRead(S, n, 0, used) || this.stepAnyPlace(S, n, 0, used);
      if (st) steps.push(st);
    }
    for (let i = 0; i < steps.length; i++) steps[i].id = 'q' + n.id + '.' + i;
    if (!this._chains || this._chainOf !== Lore.S) {
      this._chains = {}; this._chainOf = Lore.S;
    }
    this._chains[n.id] = steps;
    return steps;
  },

  // Whether a step has been taken on, finished, or never offered. Read
  // through here rather than off Game directly so a chain can be built and
  // inspected without a game running - the tests do exactly that.
  state(id) {
    if (typeof Game === 'undefined' || !Game.quests) return 'none';
    return Game.quests[id] || 'none';
  },

  // How far along you are: the first step that is not marked done. A step
  // you finished by keeping the thing instead of handing it over closes the
  // chain where it stands - they asked you for one thing and you said no.
  at(n) {
    const c = this.chain(n);
    for (let i = 0; i < c.length; i++) {
      const st = this.state(c[i].id);
      if (st === 'kept') return c.length;
      if (st !== 'done') return i;
    }
    return c.length;
  },

  // What they are asking right now, or null when the chain is finished.
  current(n) {
    const c = this.chain(n);
    const i = this.at(n);
    return i < c.length ? c[i] : null;
  },

  // Kept for everything that used to ask one person for one thing.
  forNpc(n) { return this.current(n); },

  // The elder is the one person who both tells and asks, so his two
  // streams interleave: three stories, then something to go and check, and
  // no more stories until it has been checked. Once he has told you
  // everything he has, the rest of the chain comes out on its own.
  ELDER_GATE: 3,

  elderStep(n, told) {
    if (!n || !n.elder) return this.current(n);
    const more = (typeof Tales !== 'undefined') && Tales.next(n, told);
    if (!more) return this.current(n);
    const earned = Math.floor(told.length / this.ELDER_GATE);
    return this.at(n) < earned ? this.current(n) : null;
  },

  // Spoken prose, broken to the panel width without splitting a word. A
  // step's ask is built out of names of unknown length - a thing's name can
  // run to forty characters on its own - so none of it is laid out by hand.
  wrap(str) {
    const out = [];
    let line = '';
    for (const word of String(str).split(/\s+/)) {
      if (!word) continue;
      if (!line) { line = word; continue; }
      if (line.length + 1 + word.length <= NPC.WIDTH) { line += ' ' + word; continue; }
      out.push(line);
      line = word;
    }
    if (line) out.push(line);
    return out;
  },

  // ---- the steps ----

  // Somewhere the record actually names: a place of theirs that ended, or a
  // field their people fought on. The bearing is the only direction you are
  // given, because there is no map to put a marker on.
  aPlace(S, n, used) {
    const opts = [];
    const take = (x, y, name, why, key) => {
      if (used && used.has(key)) return;
      const d = Math.hypot(x - n.x, y - n.y);
      if (d < this.SEEK_MIN || d > this.SEEK_MAX) return;
      if (name.length > 30) return;          // it has to fit on a wall of text
      opts.push({ x, y, name, why, d, key });
    };
    for (const s of S.sites) {
      if (s.abandoned < 0 || s.people !== n.people) continue;
      take(s.x, s.y, s.name, 'ours once, until the ' + Lore.ord(s.abandoned) + ' year',
           'site' + s.id);
    }
    for (const b of S.battles) {
      if (b.a !== n.people && b.b !== n.people) continue;
      take(b.x, b.y, b.name, 'we fought there in the ' + Lore.ord(b.t) + ' year',
           'battle' + b.id);
    }
    if (!opts.length) {
      for (const s of S.sites) {
        if (s.abandoned < 0) continue;
        take(s.x, s.y, s.name, 'nobody has lived there since the ' +
             Lore.ord(s.abandoned) + ' year', 'site' + s.id);
      }
    }
    if (!opts.length) return null;
    return opts[jsUhash((n.id * 31 + (used ? used.size : 0)) >>> 0, 21) % opts.length];
  },

  stepPlace(S, n, i, used) {
    const p = this.aPlace(S, n, used);
    if (!p) return null;
    return this.seek(n, p, i);
  },

  stepAnyPlace(S, n, i, used) { return this.stepPlace(S, n, i, used); },

  seek(n, place, i) {
    const dx = place.x - n.x, dy = place.y - n.y;
    const way = this.bearing(dx, dy);
    return {
      kind: 'seek', npc: n.id, key: place.key,
      x: place.x, y: place.y, name: place.name,
      ask: this.wrap('"There is a place out there. ' + place.name + ', ' +
            place.why + '. It lies ' + way + ' of here, ' +
            Math.round(Math.hypot(dx, dy) / 10) +
            ' leagues. Go and see what is left of it, and tell me."'),
      task: ('find ' + place.name + ', ' + way + ' of ' + n.siteName)
              .slice(0, NPC.WIDTH),
      pay: ['"So that is what is left of it."'],
    };
  },

  // Read what was cut, at a depth. Which band matters: the story runs
  // founding, digging, end down the three of them, so asking for the
  // deepest is asking you to go all the way down.
  BAND_NAME: { '-1': 'the shallowest gallery', '-2': 'the middle galleries',
               '-3': 'the deepest gallery they cut' },

  stepRead(S, n, i, used) {
    const band = -1 - (jsUhash((n.id * 7 + i) >>> 0, 33) % 3);
    const key = 'band' + band;
    if (used && used.has(key)) return null;
    return {
      kind: 'read', npc: n.id, key, band,
      ask: this.wrap('"What I have is said. What is cut is cut. Go down and ' +
            'read ' + this.BAND_NAME[String(band)] +
            ', and come back knowing something I do not."'),
      task: ('read what is cut in ' + this.BAND_NAME[String(band)])
              .slice(0, NPC.WIDTH),
      pay: ['"Then you have been further down than I have."'],
    };
  },

  // Go and hear a particular thing out of the elder. This is what ties two
  // people together: the person who sends you does not have the story, and
  // the one who does has it wrong.
  stepAsk(S, n, i, used) {
    if (typeof Tales === 'undefined' || typeof NPC === 'undefined') return null;
    const e = NPC.elder();
    if (!e || e.id === n.id) return null;
    const pool = Tales.forNpc(e).filter(t => t.id !== 'halls' &&
                                             !(used && used.has('tale' + t.id)));
    if (!pool.length) return null;
    const t = pool[jsUhash((n.id * 53 + i) >>> 0, 44) % pool.length];
    return {
      kind: 'ask', npc: n.id, key: 'tale' + t.id, tale: t.id, who: e.id,
      ask: this.wrap('"There is a thing I have only half of: ' + t.subject +
            '. ' + e.name + ' at ' + e.siteName + ' is older than me and has ' +
            'the rest of it. Go and hear it, and bring it back."'),
      task: ('hear about ' + t.subject + ' from ' + e.name).slice(0, NPC.WIDTH),
      pay: ['"So that is how it is told. I will keep it."'],
    };
  },

  // Go and get a named thing out of the ground. This is the step the whole
  // apparatus was building towards: the chronicle made the object, gave it
  // a maker and a chain of owners, and put it in a grave four thousand
  // years ago, and now somebody wants it in their hands. Bounded like every
  // other journey, and only ever pointed at something still down there.
  stepLift(S, n, i, used) {
    if (typeof Relic === 'undefined') return null;
    const opts = [];
    for (const r of Relic.all()) {
      if (used && used.has('relic' + r.art)) continue;
      const d = Math.hypot(r.x - n.x, r.y - n.y);
      if (d < this.SEEK_MIN || d > this.SEEK_MAX) continue;
      if (r.name.length > 44) continue;      // it has to fit on a wall of text
      opts.push(r);
    }
    if (!opts.length) return null;
    const r = opts[jsUhash((n.id * 67 + i) >>> 0, 88) % opts.length];
    const way = this.bearing(r.x - n.x, r.y - n.y);
    const how = r.how === 'battle' ? 'It went down on a field'
                                   : 'It went into the ground with the dead';
    return {
      kind: 'lift', npc: n.id, key: 'relic' + r.art, art: r.art,
      x: r.x, y: r.y, name: r.name,
      ask: this.wrap('"' + this.upper(r.name) + '. ' + how + ' in the ' +
        Lore.ord(r.t) + ' year, and it is still there. It lies ' + way +
        ' of here, ' + Math.round(Math.hypot(r.x - n.x, r.y - n.y) / 10) +
        ' leagues. Take a shovel. It will not be deep."'),
      task: ('dig up ' + r.name + ', ' + way + ' of ' + n.siteName)
              .slice(0, NPC.WIDTH),
      pay: ['"You actually went and got it."'],
      keep: ['"Then it is yours. I would have liked to hold it."'],
    };
  },

  upper(s) { return s.charAt(0).toUpperCase() + s.slice(1); },

  // The last step of an elder's own chain, and the point of the whole
  // apparatus: he knows one of his own stories has drifted, and sends you
  // to the ground it happened on to see for yourself.
  stepDoubt(S, n, i, used) {
    if (typeof Tales === 'undefined') return null;
    // Bounded like every other journey. A doubt about something two hundred
    // leagues off is not a quest, it is an eight-minute walk each way.
    const bad = Tales.doubtful(n).filter(t => {
      if (t.x === null || t.y === null) return false;
      if (used && used.has('doubt' + t.id)) return false;
      const d = Math.hypot(t.x - n.x, t.y - n.y);
      return d >= this.SEEK_MIN && d <= this.SEEK_MAX;
    });
    if (bad.length) {
      const t = bad[jsUhash((n.id * 91 + i) >>> 0, 55) % bad.length];
      return {
        kind: 'seek', npc: n.id, key: 'doubt' + t.id,
        x: t.x, y: t.y, name: t.subject,
        ask: this.wrap('"I have told you about ' + t.subject + '. I am not ' +
              'sure of it - it came to me through too many mouths. Stand on ' +
              'the ground it happened on, and see what is actually there."'),
        task: ('stand where ' + t.subject + ' ended up').slice(0, NPC.WIDTH),
        pay: ['"Then I have been saying it wrong for forty years."'],
      };
    }
    // Nothing he doubts is near enough to walk to - most of what an elder
    // has wrong happened thousands of years and hundreds of leagues away.
    // So the check happens the other way round: the walls hold what was cut
    // at the time, and going down to read them is how you find out he is
    // wrong. This is the loop the whole design is for.
    // A tale with a listed slip in it first: a wall can contradict that.
    // One he has simply lost cannot be contradicted by anything, so it is
    // only asked about when there is nothing better to doubt.
    const all = Tales.doubtful(n).filter(t => !(used && used.has('doubt' + t.id)));
    const far = all.filter(t => t.slips.length).length ? all.filter(t => t.slips.length) : all;
    if (!far.length) return null;
    const t = far[jsUhash((n.id * 91 + i) >>> 0, 55) % far.length];
    const band = -1 - (jsUhash((n.id * 3 + i) >>> 0, 66) % 3);
    if (used && used.has('band' + band)) return null;
    return {
      kind: 'read', npc: n.id, key: 'doubt' + t.id, band,
      ask: this.wrap('"I have told you about ' + t.subject + ', and I am ' +
            'not sure of it - it came through too many mouths. Go down to ' +
            this.BAND_NAME[String(band)] + ' and read what they cut at the ' +
            'time. Then tell me how far off I am."'),
      task: ('check ' + t.subject + ' against ' + this.BAND_NAME[String(band)])
              .slice(0, NPC.WIDTH),
      pay: ['"Then I have been saying it wrong for forty years."'],
    };
  },

  // The furthest thing they will ask for: the deepest band, which can only
  // be reached by going all the way down.
  stepDeep(S, n, i, used) {
    const key = 'band-3';
    if (used && used.has(key)) return null;
    return {
      kind: 'read', npc: n.id, key, band: -3,
      ask: this.wrap('"One more, and it is the last of what I want. The ' +
            'lowest gallery holds the end of whoever cut it. Go down to it, ' +
            'and read how they finished."'),
      task: 'read the end of somebody, in the lowest gallery',
      pay: ['"Nobody came back up from that. You did."'],
    };
  },

  // Eight points, by comparison rather than by angle - the same reckoning
  // the chronicle's myth uses, so a bearing means one thing in this world.
  bearing(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const ns = dy < 0 ? 'north' : 'south', ew = dx < 0 ? 'west' : 'east';
    if (ax < ay * 0.45) return ns;
    if (ay < ax * 0.45) return ew;
    return ns + '-' + ew;
  },

  // ---- can it be finished, and what happens when it is ----
  done(q) {
    if (!q) return false;
    if (q.kind === 'seek') {
      // a place is found by standing in it; nothing is marked, so arriving
      // is the whole of the proof
      return Math.hypot(Player.x - q.x, Player.y - q.y) < this.ARRIVE;
    }
    if (typeof Game === 'undefined') return false;
    if (q.kind === 'read') {
      // any hall at that depth will do: the bands are the story's three
      // acts, not three particular rooms
      for (const k of (Game.read || [])) {
        if (Number(k.split(',')[2]) === q.band) return true;
      }
      return false;
    }
    if (q.kind === 'ask') return (Game.told || []).indexOf(q.tale) >= 0;
    if (q.kind === 'lift') return Game.count(Relic.itemId(q.art)) > 0;
    return false;
  },

  hand(q, n) {
    if (q.kind === 'lift') {
      // it changes hands, and they are the ones holding it now
      Game.take(Relic.itemId(q.art), 1);
      Game.give('gem', 2);
      return (q.pay ? q.pay[0] : '"Good."') + ' (+2 ' + ITEMS.gem.name + ')';
    }
    Game.give('gem', 1);
    return (q.pay ? q.pay[0] : '"Good."') + ' (+1 ' + ITEMS.gem.name + ')';
  },

  // The other answer. You dug it up; nobody can make you give it over. The
  // thing stays in your hands and that person stops asking you for things -
  // which is the cost, and it is a real one, because a chain is the only
  // way anybody in this world tells you anything.
  keep(q, n) {
    return q.keep ? q.keep[0] : '"Keep it, then."';
  },
};
