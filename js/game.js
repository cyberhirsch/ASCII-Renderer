// Game state: inventory, modal panels (inventory / craft / examine), and the
// actions they expose. All UI is written into the ASCII grid via Overlay -
// no DOM. One keydown layer routes keys by mode; while a panel is open the
// player is frozen and every key is captured here.
const Game = {
  mode: 'play',        // play | inventory | craft | examine | console
  inv: new Map(),      // item id -> count
  cursor: 0,
  uiDirty: true,
  toastMsg: '', toastT: 0,
  needSave: false, saveTimer: 0,
  devMode: false,       // gates debug view toggles (mono/raw) behind a command
  cmdBuf: '',
  cmdHistory: [],

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

  // ---- console: text commands, "devmode" gates the debug view toggles ----

  openConsole() { this.cmdBuf = ''; this.mode = 'console'; this.uiDirty = true; },

  // Takes the raw keyboard event, not just the code - it needs the actual
  // typed character, which the code-only key() routing below doesn't carry.
  consoleInput(e) {
    if (e.code === 'Escape') { this.close(); return; }
    if (e.code === 'Enter') {
      this.runCommand(this.cmdBuf);
      this.cmdBuf = '';
      this.uiDirty = true;
      return;
    }
    if (e.code === 'Backspace') {
      this.cmdBuf = this.cmdBuf.slice(0, -1);
      this.uiDirty = true;
      return;
    }
    if (e.key && e.key.length === 1 && this.cmdBuf.length < 60) {
      this.cmdBuf += e.key;
      this.uiDirty = true;
    }
  },

  runCommand(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    this.cmdHistory.push('> ' + cmd);
    switch (cmd.toLowerCase()) {
      case 'devmode':
        this.devMode = !this.devMode;
        this.cmdHistory.push(this.devMode
          ? 'dev mode on - M/X view toggles unlocked'
          : 'dev mode off');
        break;
      case 'clear':
        this.cmdHistory.length = 0;
        break;
      case 'help':
        this.cmdHistory.push('commands: devmode, clear, help');
        break;
      default:
        this.cmdHistory.push('unknown command: ' + cmd);
    }
    if (this.cmdHistory.length > 40) this.cmdHistory.splice(0, this.cmdHistory.length - 40);
  },

  // ---- input: returns true when the key was consumed ----

  key(code) {
    if (this.mode === 'play') {
      if (code === 'Tab') { this.open('inventory'); return true; }
      if (code === 'KeyC') { this.open('craft'); return true; }
      if (code === 'KeyE') { this.examine(); return true; }
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
    if (this.mode === 'craft') {
      const n = RECIPES.length;
      const r = RECIPES[((this.cursor % n) + n) % n];
      if (!this.canCraft(r)) { this.toast('missing ingredients'); return; }
      for (const [id, cnt] of Object.entries(r.needs)) this.take(id, cnt);
      this.give(r.out, 1);
      this.toast('crafted: ' + ITEMS[r.out].name);
      return;
    }
    if (this.mode === 'examine' && this.actions.length) {
      const n = this.actions.length;
      const i = ((this.cursor % n) + n) % n;
      this.actions[i].fn();
      // actions may consume themselves (once-per-target); rebuild the list
      this.actions = this.actionsFor(this.target);
      this.cursor = Math.min(i, Math.max(0, this.actions.length - 1));
      this.uiDirty = true;
    }
  },

  // ---- examine ----

  target: null, actions: [],
  used: new Set(),   // once-per-target actions spent this session

  examine() {
    const p = Player;
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const t = World.examineRay(p.x, p.y, p.z + CFG.EYE,
      Math.cos(p.angle) * cp, Math.sin(p.angle) * cp, sp);
    if (!t) { this.toast('nothing within reach'); return; }
    this.target = t;
    this.actions = this.actionsFor(t);
    this.open('examine');
  },

  useKey(t, what) {
    return what + ':' + (t.kind === 'tree'
      ? t.ix + ',' + t.iy
      : t.point.map(v => Math.round(v)).join(','));
  },

  actionsFor(t) {
    const acts = [];
    const once = (what, label, fn) => {
      if (this.used.has(this.useKey(t, what))) return;
      acts.push({ label, fn: () => { this.used.add(this.useKey(t, what)); fn(); } });
    };
    if (t.kind === 'tree') {
      const sp = SPECIES[treeSpecies(t.ix, t.iy)];
      acts.push({ label: 'chop' + (this.count('axe') ? '' : '  (needs an axe)'),
        fn: () => this.chop(t, sp) });
      if (sp.harvest) {
        once('harvest', 'harvest  (+' + sp.harvest[1] + ' ' +
          ITEMS[sp.harvest[0]].name + ')', () => {
            this.give(sp.harvest[0], sp.harvest[1]);
            this.toast('+' + sp.harvest[1] + ' ' + ITEMS[sp.harvest[0]].name);
          });
      }
      once('branch', 'break branch  (+1 wood)', () => {
        this.give('wood', 1);
        this.toast('+1 wood (' + this.count('wood') + ')');
      });
      acts.push({ label: 'hug', fn: () => this.toast(sp.hug) });
    } else if (t.kind === 'lichen') {
      once('pick', 'harvest  (+1 glow lichen)', () => {
        this.give('lichen', 1);
        this.toast('+1 glow lichen (' + this.count('lichen') + ')');
      });
    } else if (t.kind === 'water') {
      acts.push({ label: 'drink', fn: () => this.toast('Cold and clean.') });
    }
    return acts;
  },

  chop(t, sp) {
    if (!this.count('axe')) { this.toast('you need an axe for that'); return; }
    if (typeof Fells === 'undefined') { this.toast('the axe is not sharp yet'); return; }
    Fells.add(t.ix, t.iy);
    this.give('wood', sp.chop);
    this.toast('the ' + sp.name + ' falls  (+' + sp.chop + ' wood)');
    this.close();
  },

  describe(t) {
    switch (t.kind) {
      case 'tree': {
        const sp = SPECIES[treeSpecies(t.ix, t.iy)];
        return [sp.name.toUpperCase(), sp.desc];
      }
      case 'water':     return ['WATER', 'Still, dark, patient.'];
      case 'lichen':    return ['GLOW LICHEN', ITEMS.lichen.desc];
      case 'cavewall':  return ['CAVE WALL', 'Water-worn stone. It has been',
                                'down here longer than anything.'];
      case 'dug':       return ['HEWN ROCK', 'Tool marks. Yours.'];
      case 'stair':     return ['STAIR WELL', 'Old, deliberate, patient work.',
                                'Someone cut this. Long ago.'];
      case 'pillar':    return ['CARVED PILLAR', 'Tool marks spiral upward.',
                                'It is holding the mountain up.'];
      case 'hallfloor': return ['CARVED FLOOR', 'Dead flat. Nothing natural',
                                'is this flat.'];
      case 'sand':      return ['SHORE SAND', 'Fine and pale.'];
      case 'rock':      return ['BARE ROCK', 'Too steep for anything to root.'];
      case 'grass':     return ['MEADOW', 'Wind-combed grass.'];
      default:          return [t.kind.toUpperCase(), ''];
    }
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
    if (this.mode === 'examine') this.drawExamine();
    if (this.mode === 'craft') this.drawCraft();
    if (this.mode === 'console') this.drawConsole();
  },

  drawConsole() {
    const w = Math.min(Overlay.cols - 4, 70);
    const h = 9;
    const x0 = 2, y0 = Math.max(1, Overlay.rows - h - 2);
    for (let i = 0; i < h; i++) Overlay.write(x0, y0 + i, ''.padEnd(w, ' '));
    Overlay.write(x0, y0, (' CONSOLE' + (this.devMode ? ' [dev]' : '')).padEnd(w, ' '));
    const rows = h - 2;
    const hist = this.cmdHistory.slice(-rows);
    for (let i = 0; i < rows; i++) {
      const line = hist[i] || '';
      Overlay.write(x0 + 1, y0 + 1 + i, line.slice(0, w - 2).padEnd(w - 2, ' '));
    }
    Overlay.write(x0 + 1, y0 + h - 1, ('> ' + this.cmdBuf + '_').slice(0, w - 2));
  },

  canCraft(r) {
    for (const [id, cnt] of Object.entries(r.needs)) {
      if (this.count(id) < cnt) return false;
    }
    return true;
  },

  drawCraft() {
    const lines = ['CRAFTING', ''];
    const n = RECIPES.length;
    const cur = ((this.cursor % n) + n) % n;
    for (let i = 0; i < n; i++) {
      const r = RECIPES[i];
      const needs = Object.entries(r.needs)
        .map(([id, cnt]) => cnt + ' ' + ITEMS[id].name).join(', ');
      const owned = this.count(r.out) ? '  (have ' + this.count(r.out) + ')' : '';
      const mark = this.canCraft(r) ? '' : '  - missing';
      lines.push((i === cur ? '> ' : '  ') +
        ITEMS[r.out].name.padEnd(12) + needs + mark + owned);
    }
    lines.push('');
    lines.push('[W/S] choose  [E] craft  [Q] close');
    this.panel(lines);
  },

  drawExamine() {
    if (!this.target) return;
    const lines = [...this.describe(this.target), ''];
    if (this.actions.length) {
      const n = this.actions.length;
      const cur = ((this.cursor % n) + n) % n;
      for (let i = 0; i < n; i++) {
        lines.push((i === cur ? '> ' : '  ') + this.actions[i].label);
      }
      lines.push('');
      lines.push('[W/S] choose  [E] do  [Q] close');
    } else {
      lines.push('[Q] close');
    }
    this.panel(lines);
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
