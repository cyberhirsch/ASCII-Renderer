// Felled trees: a sparse set of tree cells removed from the hash-placed
// forest. CPU-authoritative like the dig edits - collision and examine skip
// felled cells, and the GPU receives the FELL_MAX cells nearest the player
// so the renderer stops drawing them. Felling is rare, so persistence is a
// synchronous write on change, no debounce.
const Fells = {
  set: new Set(),      // "ix,iy"
  gpuDirty: false,
  data: null,          // packed vec2f cells for the GPU

  init() {
    this.data = new Float32Array(CFG.FELL_MAX * 2);
    this.load();
  },

  has(ix, iy) { return this.set.has(ix + ',' + iy); },

  add(ix, iy) {
    this.set.add(ix + ',' + iy);
    this.gpuDirty = true;
    this.save();
  },

  // pack the FELL_MAX felled cells nearest the player; returns the count
  pack(px, py) {
    const cells = [...this.set].map(k => k.split(',').map(Number));
    cells.sort((a, b) =>
      ((a[0] - px) ** 2 + (a[1] - py) ** 2) -
      ((b[0] - px) ** 2 + (b[1] - py) ** 2));
    const n = Math.min(cells.length, CFG.FELL_MAX);
    this.data.fill(0);
    for (let i = 0; i < n; i++) {
      this.data[i * 2] = cells[i][0];
      this.data[i * 2 + 1] = cells[i][1];
    }
    return n;
  },

  save() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem('ascii-fells-v1', JSON.stringify([...this.set])); }
    catch (e) { console.warn('fell save failed: ' + e.message); }
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem('ascii-fells-v1');
    if (!s) return;
    try {
      this.set = new Set(JSON.parse(s));
      this.gpuDirty = this.set.size > 0;
    } catch (e) { console.warn('fell load failed'); }
  },
};
