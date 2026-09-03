// What somebody wants from you.
//
// Nothing here is written down as a quest. A person's want is a function of
// who they are and what the sim already did: somebody knows a place their
// own record names and cannot go there themselves. Two runs of a seed ask
// the same thing of the same people.
//
// There is exactly one kind, and it is a journey. There used to be a
// second - fetch me five wood - and it is gone: it asked nothing of the
// world the chronicle built, it could have been written for any game, and
// a person who has six thousand years behind them deserves better than to
// stand in a doorway wanting timber. What is left is the mechanic the whole
// design rests on: a place named out loud, a bearing, a distance, and
// nothing marked on anything.
//
// A quest to recover a NAMED object would be better still and is not here,
// because relics are not carryable yet - there is no item that holds an
// artifact and no way to dig one out of a deposit. The elder can now tell
// you where they lie (see js/tales.js); lifting one is the next thing.
const Quest = {
  ARRIVE: 14,        // how near a place you must get for it to count
  // How far a person will send you. Walking is 4.2 units a second, so the
  // far end of this is a couple of minutes out and the same back - far
  // enough to be a journey, near enough to be one you finish.
  SEEK_MIN: 120,
  SEEK_MAX: 900,

  // ---- what one person wants, decided once and for all by the seed ----
  //
  // The elder is not one of them. They deal in what is remembered, not in
  // errands, and what they have to give is in js/tales.js.
  forNpc(n) {
    if (!n || n.elder) return null;
    const S = Lore.init();
    const place = this.aPlace(S, n);
    return place ? this.seek(n, place) : null;
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
  // A place is found by standing in it. Nothing is marked, so arriving is
  // the whole of the proof.
  done(q) {
    if (!q) return false;
    return Math.hypot(Player.x - q.x, Player.y - q.y) < this.ARRIVE;
  },

  hand(q, n) {
    Game.give('gem', 1);
    return '"So that is what is left of it." (+1 ' + ITEMS.gem.name + ')';
  },
};
