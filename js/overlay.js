// Text overlay composited into the ASCII grid by the glyph pass — the HUD is
// made of the same character cells as the world, not a DOM layer floating
// over it. Cell value 0 is transparent; any printable ASCII code (32..126)
// renders that character over a dark backing chip.
const Overlay = {
  cols: 0, rows: 0, data: null, dirty: false,

  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.data = new Uint32Array(cols * rows);
    this.dirty = true;
  },

  clear() {
    if (this.data) this.data.fill(0);
    this.dirty = true;
  },

  write(x, y, str) {
    if (!this.data || y < 0 || y >= this.rows) return;
    for (let i = 0; i < str.length; i++) {
      const cx = x + i;
      if (cx < 0 || cx >= this.cols) continue;
      const code = str.charCodeAt(i);
      this.data[y * this.cols + cx] = (code >= 32 && code < 127) ? code : 32;
    }
    this.dirty = true;
  },

  writeRight(y, str) { this.write(this.cols - 1 - str.length, y, str); },
  writeCentre(y, str) { this.write((this.cols - str.length) >> 1, y, str); },
};
