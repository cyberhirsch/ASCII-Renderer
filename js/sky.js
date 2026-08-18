// Time of day: the one place that decides where the sun and moon are and
// what colour the world is lit by. Every value here already travelled to the
// GPU as a per-frame uniform, so a full cycle costs the shader nothing.
//
// Night is art-directed rather than simulated. The glyph ramp only has ~24
// brightness steps; a physically dark night would crush the whole scene into
// the bottom two or three and read as an empty screen. So night is a bright
// moonlit blue - it says "night" through hue and contrast, and the ramp
// stays fully used. Yellow is reserved for the moon and stars, which is what
// makes them read as the only light sources up there.
const Sky = {
  t: 0.30,          // 0..1 through the day. .25 dawn, .5 noon, .75 dusk, 0 midnight
  paused: false,

  // sun height above the horizon, -1..1; the whole cycle keys off this
  sunHeight() { return Math.sin((this.t - 0.25) * Math.PI * 2); },

  // 0 by day, 1 in full night. Held back until the sun is actually down, so
  // the warm twilight owns the crossing instead of the blue taking over
  // while the sun is still on the horizon.
  night() { return 1 - smoothstep(-0.18, 0.06, this.sunHeight()); },

  // How far the key light has warmed. Asymmetric on purpose: sunlight
  // reddens over a long approach as its path through the air lengthens,
  // then goes quickly once the sun is under and only the afterglow is left.
  warmth() {
    const h = this.sunHeight();
    return h >= 0 ? 1 - smoothstep(0, CFG.WARM_UP, h)
                  : 1 - smoothstep(0, CFG.WARM_DOWN, -h);
  },

  // The red in the sky itself - a narrower thing than the warmth of the
  // light, and one that outlives the sun by a little.
  dusk() {
    const h = this.sunHeight();
    return h >= 0 ? 1 - smoothstep(0, CFG.DUSK_UP, h)
                  : 1 - smoothstep(0, CFG.DUSK_DOWN, -h);
  },

  // How far out the stars are. Deliberately behind night(): the lighting has
  // already gone blue by sunset, but the sky is still far too bright to see
  // anything in it. The first stars wait until the sun is properly under.
  starAmt() {
    return smoothstep(CFG.STAR_DUSK, CFG.STAR_DARK, -this.sunHeight());
  },

  // The celestial sphere's rotation. One turn a day, in the same sense the
  // sun travels, so the stars and the sun agree about which way the world
  // is turning.
  skyAngle() { return this.t * Math.PI * 2; },

  update(dt) {
    if (this.paused) return;
    this.t = (this.t + dt / CFG.DAY_LEN) % 1;
  },

  // hour of day, for the HUD and the console: t maps straight onto the
  // clock, so t=0 is midnight, .25 sunrise, .5 noon, .75 sunset
  hour() { return this.t * 24; },

  setHour(h) { this.t = ((h / 24) % 1 + 1) % 1; },

  dir(az, el) {
    const c = Math.cos(el);
    return [Math.cos(az) * c, Math.sin(az) * c, Math.sin(el)];
  },

  sunDir() {
    const el = Math.asin(clamp(this.sunHeight(), -1, 1)) * 0.8;
    return this.dir(CFG.SUN_AZ + this.t * Math.PI * 2, el);
  },

  // Where the light actually comes from. Once the sun is down it stops
  // lighting anything - it is under the world - so the moon takes over as
  // the key. Without this the night has no directional light at all: only
  // ambient survives, the whole scene collapses into the bottom two or three
  // glyphs of a 24-step ramp, and any shaded pocket falls off the end into
  // solid black. The handover happens at the horizon, where both are grazing
  // and neither casts much, so it costs nothing to switch there.
  keyDir() {
    return this.sunHeight() > 0 ? this.sunDir() : this.moonDir();
  },

  // the moon runs opposite the sun, so it is up when the sun is not
  moonDir() {
    const el = Math.asin(clamp(-this.sunHeight(), -1, 1)) * 0.75;
    return this.dir(CFG.SUN_AZ + Math.PI * 0.7 + this.t * Math.PI * 2, el);
  },

  // ---- palettes, blended by sun height ----
  // day: warm key over a blue sky. twilight: the sun reddens at the horizon.
  // night: everything blue, lit by a cool moon.
  DAY:   { sun: [1.00, 0.94, 0.78], sunI: 1.55,
           amb: [0.30, 0.42, 0.62], ambI: 0.55,
           lo:  [0.42, 0.56, 0.76], hi: [0.10, 0.22, 0.50] },
  DUSK:  { sun: [1.00, 0.55, 0.22], sunI: 1.30,
           amb: [0.42, 0.34, 0.44], ambI: 0.55,
           lo:  [0.74, 0.42, 0.32], hi: [0.14, 0.16, 0.44] },
  NIGHT: { sun: [0.52, 0.68, 1.00], sunI: 0.62,
           amb: [0.24, 0.36, 0.66], ambI: 0.62,
           lo:  [0.14, 0.22, 0.44], hi: [0.03, 0.07, 0.20] },

  mix3(a, b, k) { return a.map((v, i) => v + (b[i] - v) * k); },

  // the full lighting state for this instant
  state() {
    const n = this.night(), d = this.dusk(), w = this.warmth();
    const base = {
      sun: this.mix3(this.DAY.sun, this.NIGHT.sun, n),
      sunI: this.DAY.sunI + (this.NIGHT.sunI - this.DAY.sunI) * n,
      amb: this.mix3(this.DAY.amb, this.NIGHT.amb, n),
      ambI: this.DAY.ambI + (this.NIGHT.ambI - this.DAY.ambI) * n,
      lo: this.mix3(this.DAY.lo, this.NIGHT.lo, n),
      hi: this.mix3(this.DAY.hi, this.NIGHT.hi, n),
    };
    // Twilight rides on top of the day/night blend, and the two halves of it
    // are driven separately: the key light follows the long warmth curve
    // (this is the golden hour, and it starts while the sun is still well
    // up), while the red in the sky follows the narrower dusk curve.
    return {
      sunDir: this.sunDir(),
      keyDir: this.keyDir(),
      moonDir: this.moonDir(),
      night: n,
      starAmt: this.starAmt(),
      skyAngle: this.skyAngle(),
      sunCol: this.mix3(base.sun, this.DUSK.sun, w * 0.92),
      // and a low sun is a dimmer one - it is shining through more air
      sunI: (base.sunI + (this.DUSK.sunI - base.sunI) * w * 0.6) * (1 - w * 0.22),
      ambCol: this.mix3(base.amb, this.DUSK.amb, d * 0.7),
      ambI: base.ambI + (this.DUSK.ambI - base.ambI) * d * 0.5,
      skyLo: this.mix3(base.lo, this.DUSK.lo, d * 0.85),
      skyHi: this.mix3(base.hi, this.DUSK.hi, d * 0.45),
    };
  },
};
