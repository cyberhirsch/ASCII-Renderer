// Procedural glyph atlas.
//
// Glyph order is measured, not guessed: every candidate is rendered and its
// ink coverage sampled, then the set is sorted by coverage and resampled so
// the ramp is close to linear in brightness. A hand-ordered ramp is uneven —
// the gaps show up as banding in smooth gradients.

// Full printable-ASCII strip (codes 32..126) for the text overlay, rendered
// at the display cell size like the ramp atlas so texels stay 1:1 with pixels.
const TextAtlas = {
  FIRST: 32, COUNT: 95,

  build(cellW, cellH) {
    const W = Math.max(4, Math.round(cellW || 10));
    const H = Math.max(6, Math.round(cellH || 18));
    const cv = document.createElement('canvas');
    cv.width = W * this.COUNT;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(6, Math.round(H * 0.85))}px "Consolas", "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.COUNT; i++) {
      ctx.fillText(String.fromCharCode(this.FIRST + i), i * W + W / 2, H / 2);
    }
    return { canvas: cv };
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

  // cell is the on-screen size of a glyph in device pixels; rendering the
  // atlas at exactly that size keeps texel-to-pixel mapping 1:1, which is
  // what stops the glyphs from aliasing into moire
  build(setName, cellW, cellH) {
    const ramp = this.buildRamp(setName || CFG.GLYPH_SET);
    this.ramp = ramp;
    const W = Math.max(4, Math.round(cellW || 10));
    const H = Math.max(6, Math.round(cellH || 18));
    const n = ramp.length;
    const cv = document.createElement('canvas');
    cv.width = W * n;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(6, Math.round(H * 0.85))}px "Consolas", "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      ctx.fillText(ramp[i].ch, i * W + W / 2, H / 2);
    }
    return { canvas: cv, levels: n,
             chars: ramp.map(g => g.ch).join('') };
  },
};
