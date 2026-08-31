// Render quality: how many rays a frame is allowed, and who decides.
//
// SUN_SAMPLES, AO_SAMPLES and the shading cutoff all travel to the GPU as
// per-frame uniforms, so changing them costs nothing beyond the next frame -
// no recompile, no reallocation. That is what makes an automatic setting
// possible at all, and it is the only lever a player has: the shipped build
// is a single HTML file with no js/config.js inside it to edit.
//
// The cost of a frame is very close to linear in these numbers, which is
// why stepping down a level is a reliable way out of a watchdog reset
// rather than a guess.
const Quality = {
  LEVELS: {
    low:    { sun: 4,  ao: 8,  near: 18 },
    medium: { sun: 8,  ao: 16, near: 28 },
    high:   { sun: 16, ao: 32, near: 40 },   // the shipped defaults
  },
  ORDER: ['low', 'medium', 'high'],
  name: 'high',
  auto: true,

  ms: 16.7,        // smoothed frame time
  hold: 0,         // seconds since the last change
  capped: null,    // a level that already proved too slow to hold
  easy: 0,         // seconds of comfortable frames since the last hard one

  // Thresholds are deliberately far apart. Anything in between is a frame
  // rate worth keeping, and a rule that fires inside that band would spend
  // the session walking up and down the ladder.
  DOWN_MS: 22,     // slower than ~45 fps: give something up
  UP_MS: 11,       // faster than ~90 fps: there is headroom to spend
  SETTLE: 2.5,     // seconds a verdict has to hold before it counts
  // How long the good frames have to keep coming before a level that once
  // failed is worth another try. What a frame costs depends on where the
  // player is standing - a dense forest at noon is not a verdict on the
  // open plain beyond it - so the cap has to be able to lift. Half a minute
  // makes a retry rare enough that a genuinely slow machine settles down
  // and stays there.
  RELAX: 30,

  init() {
    this.load();
    this.apply();
  },

  apply() {
    const q = this.LEVELS[this.name];
    CFG.SUN_SAMPLES = q.sun;
    CFG.AO_SAMPLES = q.ao;
    // SHADE_FAR sits a hair past SHADE_NEAR: the budget is a hard cut, not
    // a taper, because past it a penumbra is smaller than one glyph
    CFG.SHADE_NEAR = q.near;
    CFG.SHADE_FAR = q.near + 0.001;
  },

  // Returns false for anything that is not a level or "auto".
  set(name) {
    if (name === 'auto') {
      this.auto = true;
      this.capped = null;
      this.hold = 0;
      this.save();
      return true;
    }
    if (!this.LEVELS[name]) return false;
    this.auto = false;
    this.name = name;
    this.apply();
    this.save();
    return true;
  },

  describe() {
    return 'quality ' + this.name + (this.auto ? ' (auto)' : ' (fixed)') +
      ' - ' + this.ms.toFixed(1) + ' ms, ' +
      CFG.SUN_SAMPLES + ' sun / ' + CFG.AO_SAMPLES + ' ao rays';
  },

  tick(dt) {
    // the smoothing is slow on purpose: one heavy frame is not a verdict
    this.ms += (dt * 1000 - this.ms) * Math.min(1, dt * 2);
    if (!this.auto) return;
    if (this.ms < this.UP_MS) {
      this.easy += dt;
      if (this.easy > this.RELAX) { this.capped = null; this.easy = 0; }
    } else {
      this.easy = 0;
    }
    this.hold += dt;
    if (this.hold < this.SETTLE) return;
    const i = this.ORDER.indexOf(this.name);
    if (this.ms > this.DOWN_MS && i > 0) {
      // remember what did not hold, so the step back up below cannot walk
      // straight into it again and start the ladder oscillating
      this.capped = this.name;
      this.name = this.ORDER[i - 1];
      this.apply();
      this.hold = 0;
    } else if (this.ms < this.UP_MS && i < this.ORDER.length - 1 &&
               this.ORDER[i + 1] !== this.capped) {
      this.name = this.ORDER[i + 1];
      this.apply();
      this.hold = 0;
    }
  },

  // Not part of the world save: how fast this machine is has nothing to do
  // with which seed is being walked, and it should survive a change of world.
  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('ascii-quality',
        JSON.stringify({ name: this.name, auto: this.auto }));
    } catch (e) { /* a lost preference is not worth a warning */ }
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem('ascii-quality');
    if (!s) return;
    try {
      const o = JSON.parse(s);
      if (this.LEVELS[o.name]) this.name = o.name;
      if (typeof o.auto === 'boolean') this.auto = o.auto;
    } catch (e) { console.warn('quality load failed'); }
  },
};
