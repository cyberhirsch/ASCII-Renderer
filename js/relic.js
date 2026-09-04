// The named things, and getting them out of the ground.
//
// The chronicle makes two hundred objects over six thousand years, gives
// each one a maker, a chain of owners and a reason to be remembered, and
// then puts it somewhere: into a grave with whoever owned it, or face down
// on the field it was dropped on. Until now that was a fact you could only
// be told. This is the part where you go and dig it up.
//
// They are shallow. Whoever buried them buried them by hand, and the ground
// has come up over them since rather than swallowed them - so a shovel and
// the right patch of soil is the whole of the tooling. No excavation, no
// depth to guess at: stand on it and dig.
//
// Nothing here is stored either. Where a thing lies is its own record's
// `rest` field, which the tales already read to tell you about it, so the
// story you were told and the hole you dig are reading the same number.
const Relic = {
  REACH: 14,     // dig this near a resting place and it comes up. The same
                 // radius a quest counts as having arrived somewhere, so
                 // "you are there" means one thing everywhere in the game.
  SENSE: 40,     // and examine this near it, and the ground says so

  _sites: null, _of: null,

  // Every resting place in the world, in world units. Graves cluster - a
  // people buries its dead together - so several things share a spot and
  // one hole gives them up one at a time.
  all() {
    const S = Lore.init();
    if (this._sites && this._of === S) return this._sites;
    const out = [];
    for (const a of S.artifacts) {
      if (!a.rest) continue;
      out.push({
        art: a.id,
        x: Chronicle.wx(a.rest.i), y: Chronicle.wy(a.rest.j),
        how: a.rest.how, t: a.rest.t, name: a.name,
        cls: a.cls, mat: a.mat,
      });
    }
    this._sites = out;
    this._of = S;
    return out;
  },

  byArt(id) {
    for (const r of this.all()) if (r.art === id) return r;
    return null;
  },

  // What is still in the ground within `r` of a point, nearest first. What
  // has been lifted is gone: the world does not put it back.
  near(x, y, r) {
    const reach = r === undefined ? this.REACH : r;
    const lifted = (typeof Game === 'undefined') ? [] : (Game.lifted || []);
    let best = null, bd = reach * reach;
    for (const s of this.all()) {
      if (lifted.indexOf(s.art) >= 0) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  },

  // How many are left in one spot, so a hole can say there is more in it.
  countAt(x, y, r) {
    const reach = r === undefined ? this.REACH : r;
    const lifted = (typeof Game === 'undefined') ? [] : (Game.lifted || []);
    let n = 0;
    for (const s of this.all()) {
      if (lifted.indexOf(s.art) >= 0) continue;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < reach * reach) n++;
    }
    return n;
  },

  // ---- carrying one ----

  // A relic is not a stack of stone, it is one object with a history, so it
  // needs an identity in an inventory that otherwise counts things. The id
  // carries the artifact number and everything else is looked up from the
  // record - nothing about a thing you are holding is copied anywhere.
  itemId(art) { return 'relic:' + art; },
  artOf(itemId) {
    const m = /^relic:(\d+)$/.exec(String(itemId));
    return m ? Number(m[1]) : -1;
  },
  isRelic(itemId) { return this.artOf(itemId) >= 0; },

  art(itemId) {
    const S = Lore.init();
    const i = this.artOf(itemId);
    return i >= 0 && S.artifacts[i] ? S.artifacts[i] : null;
  },

  name(itemId) {
    const a = this.art(itemId);
    return a ? a.name : String(itemId);
  },

  // What examining one in your own hands says. Everything on these lines is
  // the record's: what it is, who made it, and why it is remembered.
  describe(itemId) {
    const a = this.art(itemId);
    if (!a) return ['', ''];
    const S = Lore.S;
    const maker = a.madeBy !== null && S.figures[a.madeBy] ? S.figures[a.madeBy].name : null;
    const line = a.mat + ' ' + a.kind + ', made in the ' + Lore.ord(a.made) +
                 ' year' + (maker ? ' by ' + maker : '') + '.';
    return [a.name, line, a.title ? 'The one ' + a.title + '.' : ''];
  },

  // ---- what the ground says ----

  // Examining the soil over one. Not a marker and not a glow: the ground
  // reads wrong, the way it does over anything anybody ever dug.
  ground(x, y) {
    const s = this.near(x, y, this.SENSE);
    if (!s) return null;
    const d = Math.hypot(s.x - x, s.y - y);
    const close = d < this.REACH;
    return {
      site: s, dist: d, close,
      lines: close
        ? ['DISTURBED SOIL',
           'Turned over once, a long time ago, and',
           'never packed back down. Something is',
           'under this.']
        : ['OLD GROUND',
           'The soil here lies in the wrong order.',
           'Somebody worked it, and not recently.',
           'It reads strongest ' + Quest.bearing(s.x - x, s.y - y) + ' of here.'],
    };
  },
};
