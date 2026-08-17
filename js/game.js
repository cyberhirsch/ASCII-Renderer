// Game state: inventory, modal panels (inventory / craft / examine), and the
// actions they expose. All UI is written into the ASCII grid via Overlay -
// no DOM. One keydown layer routes keys by mode; while a panel is open the
// player is frozen and every key is captured here.
const Game = {
  mode: 'play',        // play | inventory | craft | examine
  inv: new Map(),      // item id -> count
  cursor: 0,
  uiDirty: true,
  toastMsg: '', toastT: 0,
  needSave: false, saveTimer: 0,

  init() { this.load(); },

  // ---- inventory ----

  count(id) { return this.inv.get(id) || 0; },

  give(id, n) {
    this.inv.set(id, this.count(id) + n);
    this.needSave = true;
    this.uiDirty = true;
  },

  take(id, n) {
    const c = this.count(id);
    if (c < n) return false;
    if (c === n) this.inv.delete(id); else this.inv.set(id, c - n);
    this.needSave = true;
    this.uiDirty = true;
    return true;
  },

  toast(msg) { this.toastMsg = msg; this.toastT = 3; this.uiDirty = true; },

  open(mode) { this.mode = mode; this.cursor = 0; this.uiDirty = true; },
  close() { this.mode = 'play'; this.uiDirty = true; },

  // ---- input: returns true when the key was consumed ----

  key(code) {
    if (this.mode === 'play') {
      if (code === 'Tab') { this.open('inventory'); return true; }
      return false;
    }
    if (code === 'KeyQ' || code === 'Escape' || code === 'Tab') {
      this.close();
      return true;
    }
    if (code === 'KeyW' || code === 'ArrowUp') {
      this.cursor--; this.uiDirty = true; return true;
    }
    if (code === 'KeyS' || code === 'ArrowDown') {
      this.cursor++; this.uiDirty = true; return true;
    }
    if (code === 'KeyE' || code === 'Enter') { this.confirm(); return true; }
    return true;   // swallow everything else while a panel is open
  },

  confirm() {
    // panel-specific confirm actions land with their phases
  },

  // ---- per-frame ----

  tick(dt) {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) { this.toastMsg = ''; this.uiDirty = true; }
    }
    if (this.needSave) {
      this.saveTimer += dt;
      if (this.saveTimer > 2) { this.saveTimer = 0; this.save(); }
    }
  },

  // ---- panel rendering (into the Overlay glyph grid) ----

  panel(lines) {
    const w = Math.max(...lines.map(l => l.length)) + 4;
    const x0 = Math.max(0, (Overlay.cols - w) >> 1);
    const y0 = Math.max(1, ((Overlay.rows - lines.length) >> 1) - 2);
    for (let i = 0; i < lines.length; i++) {
      Overlay.write(x0, y0 + i, ('  ' + lines[i]).padEnd(w, ' '));
    }
  },

  drawUI() {
    if (this.toastMsg) {
      Overlay.writeCentre(Overlay.rows - 3, ' ' + this.toastMsg + ' ');
    }
    if (this.mode === 'inventory') this.drawInventory();
  },

  drawInventory() {
    const lines = ['INVENTORY', ''];
    const ids = [...this.inv.keys()];
    if (ids.length === 0) {
      lines.push('(empty)');
      lines.push('');
      lines.push('dig for stone, examine [E] a');
      lines.push('tree for wood');
    } else {
      for (const id of ids) {
        const it = ITEMS[id] || { name: id };
        lines.push(it.name.padEnd(14) + ' x ' + this.count(id));
      }
    }
    lines.push('');
    lines.push('[Q] close');
    this.panel(lines);
  },

  // ---- persistence ----

  save() {
    if (typeof localStorage === 'undefined') { this.needSave = false; return; }
    const obj = {};
    for (const [k, v] of this.inv) obj[k] = v;
    try { localStorage.setItem('ascii-inv-v1', JSON.stringify(obj)); }
    catch (e) { console.warn('inventory save failed: ' + e.message); }
    this.needSave = false;
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem('ascii-inv-v1');
    if (!s) return;
    try {
      const obj = JSON.parse(s);
      this.inv.clear();
      for (const k of Object.keys(obj)) this.inv.set(k, obj[k]);
    } catch (e) { console.warn('inventory load failed'); }
  },
};
