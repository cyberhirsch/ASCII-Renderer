// The record, read off the chronicle instead of written.
//
// A hall belongs to whichever people had a settlement nearest to it, and
// what is cut into its pillars is drawn from that people's own event log:
// real names, real years, real causes, and nothing that did not happen.
// Two runs of a seed cut the same words, and none of it is stored.
//
// Depth still lays a life out in order - within the people a hall belongs
// to, band -1 carries their beginning, -2 the middle of their time, -3 the
// end of it - so going down still reads a story front to back. But WHOSE
// story depends on where you went down. Two entrances a few hundred units
// apart can belong to two peoples and two thousand years, which is the
// whole reason to try another one.
const Lore = {
  S: null,
  WIDTH: 46,     // the widest a cut line may be, panel included
  REACH: 1400,   // world units from a hall to the nearest settlement before
                 // nobody's record covers it and the pillars are blank

  init() {
    if (!this.S) this.S = Chronicle.run();
    return this.S;
  },

  // ---- which people cut this hall ----

  // Nearest settlement to a point, over the whole span - a place that stood
  // for four centuries and fell is as much a claim on the ground as one
  // still standing.
  nearestSite(x, y) {
    const S = this.init();
    let best = null, bd = Infinity;
    for (const s of S.sites) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return (best && bd <= this.REACH * this.REACH) ? best : null;
  },

  // The hall's owners: the site nearest its anchor, the people who held it,
  // and the slice of their life this depth belongs to. Null where the
  // chronicle simply does not reach - the region is finite and the world
  // is not, so far enough out the halls are nobody's.
  hall(cx, cy, k) {
    const a = hallAt(cx, cy, k);
    if (!a) return null;
    const site = this.nearestSite(a.ax, a.ay);
    if (!site) return null;
    const S = this.S;
    const p = S.peoples[site.people];
    const from = p.rise;
    const to = p.fell >= 0 ? p.fell : S.now;
    // band -1 shallowest is the beginning, -3 deepest is the end
    const i = Math.max(0, Math.min(2, -k - 1));
    const span = Math.max(1, (to - from) / 3);
    return { site, people: p, from: from + i * span, to: from + (i + 1) * span };
  },

  // ---- turning what happened into what is cut ----

  // The sim's causes are labels; a wall wants them said. Anything not
  // listed already reads as English and is used as it stands.
  CAUSE: {
    left: 'everybody had gone',
    sacked: 'it was sacked',
    flood: 'the water came',
    plague: 'plague',
    famine: 'famine',
    'the deep': 'the deep',
  },


  name(S, id) { return id === null || id === undefined ? null : S.figures[id].name; },

  // One event, as a line on a wall. The chronicle's deed events already
  // carry their own prose ('made the grey gold brooch of Vesesk'), so those
  // only need whoever did it put in front; the structural ones are given a
  // voice here.
  line(S, e, p) {
    const who = this.name(S, e.who);
    const site = e.place !== null && S.sites[e.place] ? S.sites[e.place].name : null;
    const other = (e.target !== null && S.peoples[e.target]) ? S.peoples[e.target].name : null;
    switch (e.action) {
      case 'founded':   return 'We set the first stone of ' + site + '.';
      case 'settled':   return 'We put people into ' + site + '.';
      case 'settled far out at':
        return 'We sent settlers a long way, to ' + site + '.';
      case 'roaded':    return 'We cut the road to ' + site + '.';
      case 'bridged':   return 'We threw a bridge for the road to ' + site + '.';
      case 'fortified': return 'We walled ' + site + ' against them.';
      case 'declared war on': return 'We took up arms against ' + other +
        (e.cause ? ', over ' + e.cause + '.' : '.');
      case 'made peace with': return 'We put down our arms.';
      case 'lost the war to': return other + ' broke us in the field.';
      case 'won a battle at': return who ? who + ' won the day for us.'
                                         : 'The day went to us.';
      case 'fell at':   return who + ' did not come off the field.';
      case 'was buried': return who + ' was laid in the ground' +
        (e.cause && e.cause !== 'age' ? ', taken by ' + e.cause + '.' : '.');
      case 'never came back': return who + ' walked out and did not return.';
      case 'opened a grave of': return 'We opened what an older people buried.';
      case 'made':      return null;   // the deed line says it better
      case 'ended':
        // A site's ending is logged against whoever ENDED it, not whoever
        // held it - so on our own wall the same event is either our loss
        // or our doing, and it has to be read the right way round.
        if (e.place !== null && site) {
          return S.sites[e.place].people === p.id
            ? site + ' was lost: ' + (this.CAUSE[e.cause] || e.cause) + '.'
            : 'We broke ' + site + ' and took the ground.';
        }
        return null;
      default:
        // a deed: prose already, and it wants a name in front of it
        return who ? who + ' ' + e.action + '.' : null;
    }
  },

  // What a hall's pillars say. Deterministic in the hall's own cell, so the
  // same wall always carries the same words.
  inscription(cx, cy, k) {
    const h = this.hall(cx, cy, k);
    const key = cx + ',' + cy + ',' + k;
    if (!h) return null;
    const S = this.S;
    const p = h.people;
    // Compose first, then measure. The year rides in front of every line,
    // so a cap on the text alone lets the finished line overrun the panel.
    const pool = [];
    for (const e of S.events) {
      if (e.actor !== p.id || e.t < h.from || e.t > h.to) continue;
      const l = this.line(S, e, p);
      if (!l) continue;
      const cut = String(e.t).padStart(4) + '  ' + l;
      if (cut.length <= this.WIDTH) pool.push(cut);
    }
    const head = [p.name + ', ' + p.kind + '.', ''];
    if (!pool.length) {
      return { band: k, key, people: p.id,
               lines: head.concat(['Nothing of these years was cut here.']) };
    }
    // a window into the pool, placed by the hall's own cell
    const want = Math.min(4, pool.length);
    const start = jsUhash(((cx * 31) ^ (cy * 17)) >>> 0,
                          ((8 + k) ^ (CFG.SEED >>> 0)) >>> 0) % pool.length;
    const lines = head.slice();
    for (let i = 0; i < want; i++) lines.push(pool[(start + i) % pool.length]);
    // and how it ended for them, at the deepest band
    if (k <= -3) {
      lines.push('');
      lines.push(p.fell >= 0
        ? 'Ended in the ' + this.ord(p.fell) + ' year, by ' + (p.cause || 'decline') + '.'
        : 'They are up there still.');
    }
    return { band: k, key, people: p.id, lines };
  },

  // 1st, 2nd, 3rd, 4th - and 11th through 13th, which break the pattern
  ord(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  },

  // what a hall calls itself: the settlement it answers to, and its shape
  KIND: ['Hall', 'Gallery', 'Delve', 'Vault', 'Stair-house', 'Cut'],
  hallName(cx, cy, k) {
    const h = this.hall(cx, cy, k);
    const kind = this.KIND[jsUhash((cx ^ 0x9e37) >>> 0, (cy ^ (8 + k)) >>> 0) %
                           this.KIND.length];
    return h ? 'the ' + kind + ' of ' + h.site.name : 'an unnamed ' + kind.toLowerCase();
  },

  // The six peoples, in the order they stood here. This is the record in
  // one screen: who they were, how long they lasted, and what finished
  // them - all of it read off the sim rather than described.
  chronology() {
    const S = this.init();
    const out = ['Six peoples have stood on this ground.', ''];
    let widest = 0;
    const rows = [];
    for (const p of S.peoples) {
      if (!p.founded) continue;
      const who = p.name + ', ' + p.kind;
      const when = p.rise + '-' + (p.fell >= 0 ? p.fell : '');
      const how = p.fell >= 0 ? (p.cause || 'decline') : 'still there';
      rows.push([who, when, how]);
      if (who.length > widest) widest = who.length;
    }
    for (const [who, when, how] of rows) {
      out.push('  ' + who.padEnd(widest + 2) + when.padEnd(11) + how);
    }
    out.push('');
    out.push('They cut the halls under you, and wrote on the walls');
    out.push('as they went. The deeper you read, the later it gets.');
    return out;
  },

  // Who the world remembers, for the journal. Not one civilisation any
  // more - whichever peoples the player has actually read.
  peopleName(id) {
    const S = this.init();
    return S.peoples[id] ? S.peoples[id].name : 'someone';
  },
};
