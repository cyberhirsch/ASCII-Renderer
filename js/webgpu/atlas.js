// Procedural glyph atlas.
//
// Glyph order is measured, not guessed: every candidate is rendered and its
// ink coverage sampled, then the set is sorted by coverage and resampled so
// the ramp is close to linear in brightness. A hand-ordered ramp is uneven —
// the gaps show up as banding in smooth gradients.
// Billboard artwork: text rendered to a stacked atlas, one row per sign, which
// the compute shader samples when a ray lands on a hoarding panel.
const SignAtlas = {
  TEXTS: ['NOODLES', 'OPEN 24H', 'DATA', 'HOTEL',
          'GARAGE', 'SUSHI', 'TAXI', 'CITY BANK'],
  W: 256, H: 64,

  build() {
    const n = this.TEXTS.length;
    const cv = document.createElement('canvas');
    cv.width = this.W;
    cv.height = this.H * n;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const t = this.TEXTS[i];
      // shrink to fit the panel rather than overflow it
      const size = Math.min(this.H * 0.6, (this.W * 1.55) / t.length);
      ctx.font = `bold ${size | 0}px "Consolas", "Courier New", monospace`;
      ctx.fillText(t, this.W / 2, this.H * i + this.H / 2);
    }
    return { canvas: cv, count: n };
  },
};

const GlyphAtlas = {
  // Candidate pools, printable ASCII only — no block elements, which read as
  // pixels rather than as text. Both pools top out near 25% ink, so the tone
  // curve in the fragment shader does the work of keeping bright areas
  // (mainly sky) off the end of the ramp.
  SETS: {
    ascii:   ' .\'`^",:;!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@',
    symbols: ' .\'`^",:;!|/\\()[]{}<>~+-_=*#%&@$?',
  },
  CELL: 32,
  LEVELS: 24,

  measure(chars) {
    const S = 16;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.font = `bold ${S * 0.8}px "Consolas", "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const out = [];
    for (const ch of chars) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = '#fff';
      ctx.fillText(ch, S / 2, S / 2 + 1);
      const d = ctx.getImageData(0, 0, S, S).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i];
      out.push({ ch, cov: sum / (S * S * 255) });
    }
    return out;
  },

  // pick LEVELS glyphs whose coverages are as evenly spaced as possible
  buildRamp(setName) {
    const seen = new Set();
    const uniq = [];
    for (const g of this.measure(this.SETS[setName] || this.SETS.symbols)) {
      const key = g.cov.toFixed(4);
      if (seen.has(key)) continue;      // drop visually identical glyphs
      seen.add(key);
      uniq.push(g);
    }
    uniq.sort((a, b) => a.cov - b.cov);

    // Walk the sorted glyphs and take the first past each evenly spaced
    // threshold. Glyphs whose coverage is nearly identical look the same on
    // screen, so admitting them would spend ramp steps that show no change;
    // this keeps every step visually distinct and lets the count fall to
    // whatever the font can actually supply.
    const lo = uniq[0].cov, hi = uniq[uniq.length - 1].cov;
    const stepSize = (hi - lo) / (this.LEVELS - 1);
    const ramp = [];
    let next = lo;
    for (const g of uniq) {
      if (g.cov + 1e-9 >= next) {
        ramp.push(g);
        next = g.cov + stepSize;
      }
    }
    const last = uniq[uniq.length - 1];
    if (ramp[ramp.length - 1] !== last) ramp.push(last);
    return ramp;
  },

  build(setName) {
    const ramp = this.buildRamp(setName || CFG.GLYPH_SET);
    this.ramp = ramp;
    const n = ramp.length;
    const cv = document.createElement('canvas');
    cv.width = this.CELL * n;
    cv.height = this.CELL;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${this.CELL * 0.8}px "Consolas", "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      ctx.fillText(ramp[i].ch, i * this.CELL + this.CELL / 2, this.CELL / 2 + 1);
    }
    return { canvas: cv, levels: n, cell: this.CELL,
             chars: ramp.map(g => g.ch).join('') };
  },
};
