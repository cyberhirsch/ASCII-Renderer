// What somebody wants from you.
//
// Nothing here is written down as a quest. A person's want is a function of
// who they are and what the sim already did: a smith at a mine has no
// timber and asks for some; somebody at a hold knows a place their own
// record names and cannot go there themselves. Two runs of a seed ask the
// same two things of the same two people.
//
// Only what the game can actually check is asked for. A quest to recover a
// named object would be better than either of these and is not here,
// because relics are not carryable yet - there is no item that holds an
// artifact and no way to dig one out of a deposit. Asking for one would be
// a quest that cannot be finished.
const Quest = {
  // What each kind of place is short of, and what it has to spare. Both
  // sides come from what the place does, so a mine trades metal for wood
  // and a farm trades food for the tools it cannot make.
  WANT: {
    mine: ['wood', 'wood'],
    farm: ['stone', 'wood'],
    hold: ['iron', 'stone'],
    fort: ['stone', 'wood'],
  },
  PAY: {
    mine: ['copper', 'iron', 'tin'],
    farm: ['fruit', 'wood', 'sap'],
    hold: ['gem', 'copper'],
    fort: ['iron', 'stone'],
  },
  BRING_MIN: 2, BRING_MAX: 5,
  PAY_MIN: 1, PAY_MAX: 3,
  ARRIVE: 14,        // how near a place you must get for it to count
  // How far a person will send you. Walking is 4.2 units a second, so the
  // far end of this is a couple of minutes out and the same back - far
  // enough to be a journey, near enough to be one you finish.
  SEEK_MIN: 120,
  SEEK_MAX: 900,

  // ---- what one person wants, decided once and for all by the seed ----
  forNpc(n) {
    if (!n) return null;
    const S = Lore.init();
    const site = S.sites[n.site];
    const kind = site ? site.kind : 'farm';
    const r = hash01(n.id * 71, 5, CFG.SEED >>> 0);
    // A keeper is the one who knows where things are, so a keeper sends
    // you somewhere. Everybody else works, and wants materials.
    if (n.role === 'keeper' || r < 0.34) {
      const place = this.aPlace(S, n);
      if (place) return this.seek(n, place);
    }
    return this.bring(n, kind);
  },

  bring(n, kind) {
    const want = this.WANT[kind] || this.WANT.farm;
    const pay = this.PAY[kind] || this.PAY.farm;
    const item = want[jsUhash(n.id >>> 0, 11) % want.length];
    const give = pay[jsUhash(n.id >>> 0, 12) % pay.length];
    const need = this.BRING_MIN +
      jsUhash(n.id >>> 0, 13) % (this.BRING_MAX - this.BRING_MIN + 1);
    const paid = this.PAY_MIN +
      jsUhash(n.id >>> 0, 14) % (this.PAY_MAX - this.PAY_MIN + 1);
    return {
      id: 'b' + n.id, kind: 'bring', npc: n.id,
      item, need, give, paid,
      ask: ['"We are short of ' + ITEMS[item].name + ' here. Bring me ' + need,
            'and I will not send you away empty."'],
      task: ('bring ' + need + ' ' + ITEMS[item].name + ' to ' + n.name +
             ' at ' + n.siteName).slice(0, NPC.WIDTH),
    };
  },

  // Somewhere the record actually names: a place of theirs that ended, or
  // a field their people fought on. The bearing is the only direction you
  // are given, because there is no map to put a marker on.
  aPlace(S, n) {
    const opts = [];
    const take = (x, y, name, why) => {
      const d = Math.hypot(x - n.x, y - n.y);
      if (d < this.SEEK_MIN || d > this.SEEK_MAX) return;
      if (name.length > 30) return;          // it has to fit on a wall of text
      opts.push({ x, y, name, why, d });
    };
    // their own dead places first: a person sends you where their people
    // actually were, not to a stranger's ruin
    for (const s of S.sites) {
      if (s.abandoned < 0 || s.people !== n.people) continue;
      take(s.x, s.y, s.name, 'ours once, until the ' + Lore.ord(s.abandoned) + ' year');
    }
    for (const b of S.battles) {
      if (b.a !== n.people && b.b !== n.people) continue;
      take(b.x, b.y, b.name, 'we fought there in the ' + Lore.ord(b.t) + ' year');
    }
    // and any ruin near enough to walk to, if their own are all too far
    if (!opts.length) {
      for (const s of S.sites) {
        if (s.abandoned < 0) continue;
        take(s.x, s.y, s.name, 'nobody has lived there since the ' +
             Lore.ord(s.abandoned) + ' year');
      }
    }
    if (!opts.length) return null;
    return opts[jsUhash(n.id >>> 0, 21) % opts.length];
  },

  seek(n, place) {
    const dx = place.x - n.x, dy = place.y - n.y;
    return {
      id: 's' + n.id, kind: 'seek', npc: n.id,
      x: place.x, y: place.y, name: place.name,
      ask: ['"There is a place out there. ' + place.name + ',',
            place.why + '.',
            'It lies ' + this.bearing(dx, dy) + ' of here, ' +
            Math.round(Math.hypot(dx, dy) / 10) + ' leagues.',
            'Go and see what is left of it, and tell me."'],
      task: ('find ' + place.name + ', ' + this.bearing(dx, dy) +
             ' of ' + n.siteName).slice(0, NPC.WIDTH),
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
    if (q.kind === 'bring') return Game.count(q.item) >= q.need;
    // a place is found by standing in it; nothing is marked, so arriving
    // is the whole of the proof
    return Math.hypot(Player.x - q.x, Player.y - q.y) < this.ARRIVE;
  },

  hand(q, n) {
    if (q.kind === 'bring') {
      Game.take(q.item, q.need);
      Game.give(q.give, q.paid);
      return '"That is what we needed." (+' + q.paid + ' ' + ITEMS[q.give].name + ')';
    }
    Game.give('gem', 1);
    return '"So it is still standing." (+1 ' + ITEMS.gem.name + ')';
  },
};
