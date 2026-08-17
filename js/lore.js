// The people who cut the halls.
//
// Nothing here is authored: a seed gives a civilisation its name, its
// founder, the thing it dug up, and the way it ended, and the inscriptions
// are generated from those facts. Two runs of the same seed tell exactly the
// same story, and a different seed tells a different one.
//
// The record is laid out by DEPTH. Band -1 carries the founding, -2 the
// digging, -3 the end - so reading the story in order means going down,
// which is the whole reason the caves are there.
// 1st, 2nd, 3rd, 4th - and 11th through 13th, which break the pattern
function ord(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

const Lore = {
  HEAD: ['kar', 'dun', 'mor', 'thal', 'ves', 'gor', 'bal', 'rin', 'oth',
         'urd', 'kel', 'zar', 'mun', 'fel', 'has', 'tor', 'bre', 'skal'],
  TAIL: ['az', 'ok', 'ur', 'eth', 'im', 'ash', 'orn', 'ul', 'ek', 'ir',
         'and', 'uz', 'in', 'ad', 'oth', 'esk'],

  cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); },

  // pick from a table by hash, so every name is a function of the seed
  pick(tbl, a, b) {
    return tbl[jsUhash((a ^ (CFG.SEED >>> 0)) >>> 0, b >>> 0) % tbl.length];
  },

  name(a, b) { return this.cap(this.pick(this.HEAD, a, b) + this.pick(this.TAIL, a, b + 1)); },
  longName(a, b) {
    return this.cap(this.pick(this.HEAD, a, b) + this.pick(this.HEAD, a, b + 7) +
                    this.pick(this.TAIL, a, b + 3));
  },

  // The one civilisation this world remembers. Everything the inscriptions
  // say is drawn from here, so they agree with each other.
  civ() {
    if (this._civ) return this._civ;
    const h = (n) => jsUhash((CFG.SEED >>> 0), n >>> 0);
    const FOUND = ['a vein of copper', 'a spring that ran warm',
                   'stone that split clean', 'a cave already cut'];
    const DEEP = ['the Hollow', 'the Pale Seam', 'the Quiet', 'the Blue Fire',
                  'the Door', 'the Long Vein'];
    const END = ['the water came', 'the lamps went out and stayed out',
                 'the deep gallery answered', 'the stone began to move',
                 'nothing came up the stair again'];
    this._civ = {
      name: this.longName(1, 2),
      people: this.name(3, 4) + 'ai',
      founder: this.name(5, 6),
      last: this.name(7, 8),
      delve: this.name(9, 10),
      found: FOUND[h(11) % FOUND.length],
      deep: DEEP[h(12) % DEEP.length],
      end: END[h(13) % END.length],
      years: 120 + (h(14) % 400),
      depth: 3 + (h(15) % 6),
    };
    return this._civ;
  },

  // Beats of the story, by depth band. Each hall gets one, chosen by its
  // own cell, so a band's halls between them tell that chapter.
  BEATS: {
    '-1': [
      c => [`${c.name} began here.`,
            `${c.founder} found ${c.found} and called it enough.`,
            `We were ${c.people}. We cut downward because we could.`],
      c => [`In the ${ord(c.years)} year the upper halls were finished.`,
            `Every lamp was lit. ${c.founder} walked them all in a day`,
            `and said the walls would outlast the walkers.`],
      c => [`We traded metal upward and took grain down.`,
            `The sky-folk had no name for us that we liked,`,
            `so we kept our own: ${c.people}.`],
      c => [`Here the first stair was cut, by hand, in the dark.`,
            `${c.founder} cut the first step and the last of that flight.`],
    ],
    '-2': [
      c => [`${c.delve} took the lower cut.`,
            `The stone rings hollow below this floor.`,
            `We are told this is only water. It is not water.`],
      c => [`We reached ${c.deep} in the ${ord(c.years + 40)} year.`,
            `${c.founder}'s law said seal it and set a watch.`,
            `We did not seal it.`],
      c => [`The lamps burn blue in the deep gallery.`,
            `No one will say why. ${c.delve} has stopped going down.`],
      c => [`Count the galleries. There should be ${c.depth}.`,
            `There are more than ${c.depth}.`,
            `We did not cut the others.`],
    ],
    '-3': [
      c => [`${c.last} held the gate here.`,
            `Long enough for the upper halls to empty. Not longer.`],
      c => [`It came up through the floor we cut.`,
            `We made the road for it. That is the whole of it.`],
      c => [`If you are reading this, ${c.end}.`,
            `Do not go below the ${ord(c.depth)} gallery.`,
            `We did. There is no one left to say what we found.`],
      c => [`${c.name} ended in the ${ord(c.years + 90)} year.`,
            `${c.last} wrote this and put down the chisel.`,
            `We were ${c.people}. We were here.`],
    ],
  },

  // the inscription cut into the pillars of one hall
  inscription(cx, cy, k) {
    const band = String(Math.max(-3, Math.min(-1, k)));
    const beats = this.BEATS[band] || this.BEATS['-1'];
    const i = jsUhash(((cx * 31) ^ (cy * 17)) >>> 0,
                      ((8 + k) ^ (CFG.SEED >>> 0)) >>> 0) % beats.length;
    const c = this.civ();
    return { band: k, key: cx + ',' + cy + ',' + k, lines: beats[i](c) };
  },

  // what a hall calls itself
  hallName(cx, cy, k) {
    const c = this.civ();
    const KIND = ['Hall', 'Gallery', 'Delve', 'Vault', 'Stair-house', 'Cut'];
    const kind = KIND[jsUhash((cx ^ 0x9e37) >>> 0, (cy ^ (8 + k)) >>> 0) % KIND.length];
    return `the ${kind} of ${this.name(cx + 40, cy + 90 + k)}`;
  },
};
