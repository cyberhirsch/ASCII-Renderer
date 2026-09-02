// The people who are still here.
//
// Every chronicle but the last one ends. The people who have not ended yet
// are living in settlements the record can name, and this puts somebody in
// them - so the world has a voice in it that is not cut into a wall.
//
// Nothing is stored. Who stands where is a function of the site and the
// seed, the same way the buildings on that site are, so two visits find the
// same person in the same doorway. What they SAY comes out of their own
// people's event log: they are not given lines, they are asked questions
// about a history that happened.
const NPC = {
  PER_400: 1,        // another soul on the ground per this much population
  MAX_AT: 3,         // and never more than a village's worth to talk to
  RING: 6.0,         // how far out from the middle of a place they stand
  REACH: 3.2,        // how close you must be to speak to one
  WIDTH: 52,         // the widest anything said here may be, panel included

  // A role is what the ground is for, not a job title: a mine has somebody
  // who works metal, a farm somebody who works ground, a hold somebody who
  // keeps the record. It decides what they want and what they can spare.
  ROLE: {
    hold: ['keeper', 'the one who keeps the record'],
    farm: ['grower', 'who works this ground'],
    mine: ['smith', 'who works the metal out of it'],
    fort: ['warden', 'who watches the road'],
  },

  _all: null,

  // Everybody alive in the world, in one list. Small - a dozen settlements
  // and at most three to a settlement - so it is built once and kept.
  all() {
    if (this._all) return this._all;
    const S = Lore.init();
    const out = [];
    for (const site of S.sites) {
      if (site.abandoned >= 0) continue;      // nobody lives in a ruin
      const p = S.peoples[site.people];
      // A people can fall while one of its places is never formally
      // abandoned, so a site being un-ruined is not enough: somebody has to
      // still be standing behind it, or the last of the Anuaya would be out
      // here telling you they have held this ground since the 162nd year.
      if (!p || p.fell >= 0) continue;
      const n = clamp(1 + Math.floor(site.pop / (400 / this.PER_400)), 1, this.MAX_AT);
      for (let i = 0; i < n; i++) {
        const a = (i / n + hash01(site.id, i, CFG.SEED >>> 0) * 0.3) * Math.PI * 2;
        const r = this.RING * (0.7 + hash01(site.id + 31, i, CFG.SEED >>> 0) * 0.6);
        const x = site.x + Math.cos(a) * r;
        const y = site.y + Math.sin(a) * r;
        const [role, doing] = this.ROLE[site.kind] || this.ROLE.farm;
        out.push({
          id: out.length,
          name: Chronicle.nameFor(site.people, 700 + out.length, site.id * 13 + i),
          role, doing,
          people: site.people, peopleName: p ? p.name : '?',
          site: site.id, siteName: site.name,
          x, y, z: terrainH(x, y),
          // facing the middle of their own settlement, which is where
          // anyone standing in a village stands looking
          facing: Math.atan2(site.y - y, site.x - x),
        });
      }
    }
    this._all = out;
    return out;
  },

  // The nearest person within reach, or null.
  near(x, y, maxD) {
    const r = maxD === undefined ? this.REACH : maxD;
    let best = null, bd = r * r;
    for (const n of this.all()) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  },

  byId(id) { const a = this.all(); return id >= 0 && id < a.length ? a[id] : null; },

  // Everyone standing at one site, for the renderer to pack alongside it.
  atSite(siteId) { return this.all().filter(n => n.site === siteId); },

  // A figure, in world space. The catalogue already draws a person for
  // scale; this is that same body with materials that read as somebody
  // rather than as an instrument left in the scene.
  parts(n) {
    const P = transformParts(figureParts(0, 0, n.facing), { pos: [n.x, n.y, n.z] });
    // Pale, deliberately. The first try dressed them in timber, and a
    // timber-brown figure standing in tree shade against dark ground is
    // invisible at five paces - the shape was right and could not be seen.
    // Somebody has to read against the world they are standing in.
    for (const p of P) p.mat = p.k === 'sph' ? 'bone' : 'daub';
    return P;
  },

  // What they say when you come up to them. Their own people, their own
  // place, and one thing that actually happened to them.
  greet(n) {
    const S = Lore.init();
    const p = S.peoples[n.people];
    const out = [(n.name + ', ' + n.doing).toUpperCase().slice(0, this.WIDTH), ''];
    out.push('"We are ' + n.peopleName + '. My people have held this');
    out.push('ground since the ' + Lore.ord(p.rise) + ' year.');
    // one real event from their own record, so nobody says anything that
    // did not happen
    const mine = [];
    for (const e of S.events) {
      if (e.actor !== n.people) continue;
      const l = Lore.line(S, e, p);
      if (!l) continue;
      const said = String(e.t).padStart(4) + '  ' + l;
      if (said.length <= this.WIDTH) mine.push(said);
    }
    if (mine.length) {
      const i = jsUhash((n.id * 977) >>> 0, (CFG.SEED >>> 0)) % mine.length;
      out.push('');
      out.push(mine[i]);
    }
    return out;
  },
};
