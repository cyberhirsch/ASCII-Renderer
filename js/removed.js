// Cleared cells: a sparse set of world cells whose hash-placed prop the
// player has taken away - a felled tree, a pocketed stone, a broken rock.
// One cell holds one prop, so a single set covers all of them.
// CPU-authoritative like the dig edits: collision and examine skip cleared
// cells, and the GPU receives the REMOVED_MAX cells nearest the player so the
// renderer stops drawing them. Persistence is debounced the way the dig
// edits are: felling a tree used to serialise and write the whole set
// synchronously, which is a stutter that grows with the set.
const Removed = {
  set: new Set(),      // "ix,iy" - the authority
  cells: null,         // the same cells as [ix, iy] numbers, for packing
  gpuDirty: false,
  needSave: false,
  saveTimer: 0,
  data: null,          // packed vec2f cells for the GPU

  init() {
    this.data = new Float32Array(CFG.REMOVED_MAX * 2);
    this.load();
  },

  has(ix, iy) { return this.set.has(ix + ',' + iy); },

  add(ix, iy) {
    const k = ix + ',' + iy;
    if (this.set.has(k)) return;
    this.set.add(k);
    if (this.cells) this.cells.push([ix, iy]);
    this.gpuDirty = true;
    this.needSave = true;
  },

  // Numeric mirror of the set, so packing does not re-parse every key. The
  // set stays the authority: anything that reaches into it directly changes
  // its size, and a size that no longer matches rebuilds this from scratch.
  syncCells() {
    if (this.cells && this.cells.length === this.set.size) return;
    this.cells = [];
    for (const k of this.set) {
      const c = k.split(',');
      this.cells.push([Number(c[0]), Number(c[1])]);
    }
  },

  // pack the REMOVED_MAX cleared cells nearest the player; returns the count
  pack(px, py) {
    this.syncCells();
    const cells = this.cells;
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
    if (typeof localStorage === 'undefined') { this.needSave = false; return; }
    try { localStorage.setItem(saveKey('ascii-removed-v1'), JSON.stringify([...this.set])); }
    catch (e) { console.warn('cleared-cell save failed: ' + e.message); }
    this.needSave = false;
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem(saveKey('ascii-removed-v1'));
    if (!s) return;
    try {
      this.set = new Set(JSON.parse(s));
      this.cells = null;
      this.gpuDirty = this.set.size > 0;
    } catch (e) { console.warn('cleared-cell load failed'); }
  },

  tick(dt) {
    if (!this.needSave) return;
    this.saveTimer += dt;
    if (this.saveTimer > 2) { this.saveTimer = 0; this.save(); }
  },
};
