// Cleared cells: a sparse set of world cells whose hash-placed prop the
// player has taken away - a felled tree, a pocketed stone, a broken rock.
// One cell holds one prop, so a single set covers all of them.
// CPU-authoritative like the dig edits: collision and examine skip cleared
// cells, and the GPU receives the REMOVED_MAX cells nearest the player so the
// renderer stops drawing them. Clearing is rare, so persistence is a
// synchronous write on change, no debounce.
const Removed = {
  set: new Set(),      // "ix,iy"
  gpuDirty: false,
  data: null,          // packed vec2f cells for the GPU

  init() {
    this.data = new Float32Array(CFG.REMOVED_MAX * 2);
    this.load();
  },

  has(ix, iy) { return this.set.has(ix + ',' + iy); },

  add(ix, iy) {
    this.set.add(ix + ',' + iy);
    this.gpuDirty = true;
    this.save();
  },

  // pack the REMOVED_MAX cleared cells nearest the player; returns the count
  pack(px, py) {
    const cells = [...this.set].map(k => k.split(',').map(Number));
    cells.sort((a, b) =>
      ((a[0] - px) ** 2 + (a[1] - py) ** 2) -
      ((b[0] - px) ** 2 + (b[1] - py) ** 2));
    const n = Math.min(cells.length, CFG.REMOVED_MAX);
    this.data.fill(0);
    for (let i = 0; i < n; i++) {
      this.data[i * 2] = cells[i][0];
      this.data[i * 2 + 1] = cells[i][1];
    }
    return n;
  },

  save() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem('ascii-removed-v1', JSON.stringify([...this.set])); }
    catch (e) { console.warn('cleared-cell save failed: ' + e.message); }
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem('ascii-removed-v1');
    if (!s) return;
    try {
      this.set = new Set(JSON.parse(s));
      this.gpuDirty = this.set.size > 0;
    } catch (e) { console.warn('cleared-cell load failed'); }
  },
};
