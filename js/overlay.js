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

  // A black screen, made of the same cells as everything else. 0 means
  // "the scene's own glyph" and BLANK means "no ink at all", so filling
  // with BLANK puts the field out without the renderer needing a mode for
  // it - the opening then writes its text into the dark like any panel.
  blackout() {
    if (this.data) this.data.fill(this.BLANK);
    this.dirty = true;
  },

  // Colours a cell can carry. The character lives in the low byte and the
  // colour above it, so a tinted cell costs nothing extra - 0 means "take
  // the scene's own colour", which is what every line of text does.
  // 4 is plain white under both its names: the player's mark on the map,
  // and text that must not borrow its colour from whatever is behind it.
  // 6 and 7 are the opening timelapse's, which is the one screen that
  // draws a road and a ruin as distinct things.
  C: { none: 0, land: 1, water: 2, site: 3, self: 4, white: 4, cave: 5,
       ruin: 6, road: 7 },

  write(x, y, str, tint) {
    if (!this.data || y < 0 || y >= this.rows) return;
    const row = y * this.cols;
    const hue = (tint || 0) << 8;
    const put = (cx, code) => {
      if (cx >= 0 && cx < this.cols) {
        // the clear-air cells either side of a word are not tinted: there
        // is no ink in them to colour
        this.data[row + cx] = code === this.BLANK ? code : (code | hue);
      }
    };
    // Every gap in UI text is cleared, not just the ends: a space between
    // two words has to read as a space, and letting the glyph field show
    // through it turns a sentence back into noise. Anything unprintable
    // (the atlas is ASCII 32..126) clears too.
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      put(x + i, (code > 32 && code < 127) ? code : this.BLANK);
    }
    // plus one cell of clear air on each side of the whole insert
    if (str.length) { put(x - 1, this.BLANK); put(x + str.length, this.BLANK); }
    this.dirty = true;
  },

  writeRight(y, str, t) { this.write(this.cols - 1 - str.length, y, str, t); },
  writeCentre(y, str, t) { this.write((this.cols - str.length) >> 1, y, str, t); },

  // One cell, one colour: what the map is drawn with.
  put(x, y, ch, tint) {
    if (!this.data || y < 0 || y >= this.rows || x < 0 || x >= this.cols) return;
    const code = ch.charCodeAt(0);
    this.data[y * this.cols + x] =
      (code > 32 && code < 127) ? (code | ((tint || 0) << 8)) : this.BLANK;
    this.dirty = true;
  },
};
