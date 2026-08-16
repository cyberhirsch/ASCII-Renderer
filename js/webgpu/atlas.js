// Procedural glyph atlas: a brightness ramp of ASCII glyphs rendered to an
// offscreen canvas, white-on-black so the GPU can use the red channel as a
// coverage mask and tint it with the traced surface color.
const GlyphAtlas = {
  RAMP: ' .`:-=+*%#@',
  CELL: 32,

  build() {
    const n = this.RAMP.length;
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
      ctx.fillText(this.RAMP[i], i * this.CELL + this.CELL / 2, this.CELL / 2 + 1);
    }
    return { canvas: cv, levels: n, cell: this.CELL };
  },
};
