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

  // How old they are. This is the one thing about a living person that is
  // invented rather than remembered - the chronicle only tracks figures,
  // and every figure it names is dead - and it is invented for a reason.
  // The oldest person in a world is the one who was told things by people
  // who were told them, and word of mouth is the only way anything from
  // before the living gets to you out loud.
  AGE_MIN: 23, AGE_MAX: 79,
  ELDER: ['elder', 'who remembers what nobody wrote down'],

  // Standing still is the one thing nobody does. What each of them does
  // instead comes off the same thing their words do - the ground they are
  // standing on and what it is for. A grower walks a row up and back, a
  // smith stays at the fire and turns, a warden walks a beat, and the
  // elder does not go far and does not go fast.
  //
  // No state is kept. Where somebody is at a given moment is a function of
  // the clock, their id and the seed, the same way everything else in this
  // world is a function of something rather than a thing that was saved.
  ROAM: {
    keeper: { r: 2.2, rate: 0.14 },
    grower: { r: 3.4, rate: 0.22 },
    smith:  { r: 0.0, rate: 0.30 },
    warden: { r: 4.6, rate: 0.13 },
    elder:  { r: 1.2, rate: 0.08 },
  },
  // The furthest any of them gets from their own spot. The path is r wide
  // and 0.62r deep, so the corner of it is r * hypot(1, 0.62) = 1.18r away
  // - not r, which is the number this was first set to and which the
  // warden was already outside. The resident bounding sphere is grown by
  // this, so it has to be the real maximum and not the radius.
  ROAM_MAX: 5.5,
  LOOK: 6.5,         // come this close and they turn and look at you

  _all: null, _elder: null, _t: 0,

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
        const age = this.AGE_MIN +
          jsUhash((site.id * 101 + i) >>> 0, (CFG.SEED ^ 0xA6E) >>> 0) %
          (this.AGE_MAX - this.AGE_MIN + 1);
        out.push({
          id: out.length,
          name: Chronicle.nameFor(site.people, 700 + out.length, site.id * 13 + i),
          role, doing, age, elder: false,
          // where they walk about, out of step with each other
          phase: hash01(site.id * 17 + i, 3, (CFG.SEED ^ 0x9A1C) >>> 0) * Math.PI * 2,
          people: site.people, peopleName: p ? p.name : '?',
          site: site.id, siteName: site.name,
          // x,y is the spot they belong to, and it never moves: every
          // bearing and distance anybody quotes is measured from it. Where
          // they actually ARE right now is px,py, which wanders.
          x, y, z: terrainH(x, y),
          px: x, py: y, pz: terrainH(x, y),
          // facing the middle of their own settlement, which is where
          // anyone standing in a village stands looking
          facing: Math.atan2(site.y - y, site.x - x),
        });
      }
    }
    // The eldest, and there is exactly one. Ties break on the lower id so
    // the same person holds the tales on every run of a seed.
    let old = null;
    for (const n of out) if (!old || n.age > old.age) old = n;
    if (old) {
      old.elder = true;
      old.role = this.ELDER[0];
      old.doing = this.ELDER[1];
      this._elder = old;
    }
    this._all = out;
    return out;
  },

  // The one who remembers. Null in a world whose peoples have all ended.
  elder() { this.all(); return this._elder; },

  // Where somebody is at time t. A closed path around their own spot, and
  // slow: the point is that the village is not a photograph, not that
  // anybody is going anywhere. Two frequencies rather than one so it does
  // not read as a circle being traced.
  walk(n, t) {
    const w = this.ROAM[n.role] || this.ROAM.grower;
    const a = t * w.rate + n.phase;
    return [n.x + Math.cos(a) * w.r,
            n.y + Math.sin(a * 0.7 + n.phase) * w.r * 0.62];
  },

  // Move everybody. Called once a frame with the wall clock; nothing is
  // stored, so a frame that never happens costs nothing and a reload puts
  // everybody exactly where the clock says they should be.
  tick(t, px, py) {
    this._t = t;
    for (const n of this.all()) {
      const w = this.ROAM[n.role] || this.ROAM.grower;
      const here = this.walk(n, t);
      n.px = here[0]; n.py = here[1];
      n.pz = terrainH(n.px, n.py);
      if (px !== undefined &&
          (n.px - px) ** 2 + (n.py - py) ** 2 < this.LOOK * this.LOOK) {
        // somebody standing this close to you gets looked at
        n.facing = Math.atan2(py - n.py, px - n.px);
      } else if (w.r > 0.01) {
        // otherwise they face the way they are going, taken off the path
        // itself rather than tracked, so it is right on the first frame
        const ahead = this.walk(n, t + 0.35);
        n.facing = Math.atan2(ahead[1] - n.py, ahead[0] - n.px);
      } else {
        // nowhere to go: turning at the fire
        n.facing = n.phase + t * w.rate;
      }
    }
  },

  // The nearest person within reach, or null. Measured against where they
  // ARE, not where they belong: you speak to the person, not to the spot.
  near(x, y, maxD) {
    const r = maxD === undefined ? this.REACH : maxD;
    let best = null, bd = r * r;
    for (const n of this.all()) {
      const d = (n.px - x) ** 2 + (n.py - y) ** 2;
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
    const P = transformParts(figureParts(0, 0, n.facing), { pos: [n.px, n.py, n.pz] });
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
    if (n.elder) {
      out.push('');
      out.push('I have ' + n.age + ' years on me, and there is nobody');
      out.push('older left to ask."');
    }
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
