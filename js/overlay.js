// Text overlay composited into the ASCII grid by the glyph pass — the HUD is
// made of the same character cells as the world, not a DOM layer floating
// over it. Cell value 0 is transparent; any printable ASCII code (32..126)
// renders that character over a dark backing chip.
const Overlay = {
  cols: 0, rows: 0, data: null, dirty: false,
  BLANK: CFG.UI_BLANK,   // a cell the glyph pass leaves empty

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
    const row = y * this.cols;
    const put = (cx, code) => {
      if (cx >= 0 && cx < this.cols) this.data[row + cx] = code;
    };
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      put(x + i, (code >= 32 && code < 127) ? code : 32);
    }
    // One cell of clear air on each side of the text itself, so a word never
    // runs straight into the glyph field. It hugs the trimmed extent, not
    // the string, so a padded panel line still gets its gap around the words
    // rather than out at the padding's edge - and spaces inside the line go
    // on showing the scene.
    const first = str.search(/\S/);
    if (first >= 0) {
      put(x + first - 1, this.BLANK);
      put(x + str.replace(/\s+$/, '').length, this.BLANK);
    }
    this.dirty = true;
  },

  writeRight(y, str) { this.write(this.cols - 1 - str.length, y, str); },
  writeCentre(y, str) { this.write((this.cols - str.length) >> 1, y, str); },
};
