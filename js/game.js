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
  read: [],             // inscription keys already read, in the order found
  done: false,          // the record has been pieced together
  spawnAt: null,        // where a saved game left the player standing

  // The prologue: what they say came before the record. It runs once, for
  // somebody who has never been here - a returning player is dropped
  // straight back in where they stopped, and does not sit through the
  // creation of the world a second time.
  mythT: 0,
  MYTH_LINE: 0.38,   // seconds before the next line of it arrives
  MYTH_HOLD: 1.2,    // and how long it stands complete before the title

  init() {
    this.load();
    if (!this.spawnAt) this.mode = 'myth';
  },

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

  // ---- digging: what the ground is made of decides what it takes ----

  // Pickaxes come in three metals and a point only bites what it is harder
  // than. Stone takes rock and the soft metals; iron ore wants bronze; the
  // gem pockets want iron. That ladder is what the journey for tin is FOR -
  // without it bronze is a trinket, and with it bronze is the rung that
  // reaches iron, which is the rung that reaches the lantern.
  PICKS: [['pick', 1], ['bronzepick', 2], ['ironpick', 3]],
  PICK_NAME: ['bare hands', 'a stone pickaxe', 'a bronze pickaxe', 'an iron pickaxe'],

  pickTier() {
    let t = 0;
    for (const [id, tier] of this.PICKS) if (this.count(id) && tier > t) t = tier;
    return t;
  },

  // how hard this point is to shift, on the same scale
  needFor(mat, x, y, z) {
    if (mat === MATS.GEM) return 3;
    if (mat === MATS.ORE && oreItem(x, y, z) === 'iron') return 2;
    return 1;
  },


  // Returns the scoop radius to carve, or 0 when the right tool is missing
  // (a toast explaining why is already queued). Pays out whatever the
  // material yields. Soil moves in bigger bites than rock does.
  digAt(x, y, z) {
    const mat = matAt(x, y, z, terrainH(x, y));
    if (mat === MATS.DIRT) {
      if (!this.count('shovel')) { this.toast('soil - you need a shovel'); return 0; }
      return CFG.DIG_R * 1.4;
    }
    const need = this.needFor(mat, x, y, z);
    const tier = this.pickTier();
    if (tier < need) {
      // say which rung is missing, not just that something is
      this.toast(tier === 0 ? 'solid rock - you need a pickaxe'
        : 'the point turns - this wants ' + this.PICK_NAME[need]);
      return 0;
    }
    if (mat === MATS.GEM) {
      this.give('gem', 1);
      this.toast('a gem comes loose (' + this.count('gem') + ')');
    } else if (mat === MATS.ORE) {
      const id = oreItem(x, y, z);
      this.give(id, 1);
      this.toast('+1 ' + ITEMS[id].name + ' (' + this.count(id) + ')');
    } else {
      this.give('stone', 1);
      this.toast('+1 stone (' + this.count('stone') + ')');
    }
    return CFG.DIG_R;
  },

  open(mode) { this.mode = mode; this.cursor = 0; this.uiDirty = true; },
  close() { this.mode = 'play'; this.uiDirty = true; },

  // ---- console: text commands, "devmode" gates the debug view toggles ----

  openConsole() { this.cmdBuf = ''; this.mode = 'console'; this.uiDirty = true; },

  // Takes the raw keyboard event, not just the code - it needs the actual
  // typed character, which the code-only key() routing below doesn't carry.
  consoleInput(e) {
    if (e.code === 'Escape') { this.close(); return; }
    if (e.code === 'Enter') {
      if (!this.cmdBuf.trim()) { this.close(); return; }
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
    const arg = cmd.split(/\s+/);
    const verb = arg[0].toLowerCase();
    // waiting out a whole cycle to see midnight is no way to work
    if (verb === 'time') {
      if (arg.length > 1 && isFinite(parseFloat(arg[1]))) {
        Sky.setHour(parseFloat(arg[1]));
      }
      this.cmdHistory.push('time ' + Sky.hour().toFixed(2) +
        (Sky.paused ? ' (frozen)' : ''));
      return;
    }
    if (verb === 'freeze') {
      Sky.paused = !Sky.paused;
      this.cmdHistory.push(Sky.paused ? 'time frozen' : 'time running');
      return;
    }
    if (verb === 'daylen') {
      if (arg.length > 1 && parseFloat(arg[1]) > 0) CFG.DAY_LEN = parseFloat(arg[1]);
      this.cmdHistory.push('day length ' + CFG.DAY_LEN + 's');
      return;
    }
    // The seed is the world. Handing someone a number hands them the same
    // hills, the same caves and the same dead civilisation, which is the
    // whole claim this project makes - so it needs to be sayable at runtime
    // and not only editable in a source file nobody who plays this has.
    if (verb === 'seed') {
      if (arg.length > 1) {
        const v = Number(arg[1]);
        if (!Number.isInteger(v) || v < 0 || v >= SEED_MAX) {
          this.cmdHistory.push('seed must be a whole number below ' + SEED_MAX);
          this.cmdHistory.push('(above that an f32 uniform stops carrying it)');
          return;
        }
        if (v === CFG.SEED) { this.cmdHistory.push('already standing in ' + v); return; }
        // Half the modules cache something derived from the seed - the
        // spawn, the civilisation, the resident dig chunks - so the honest
        // way into another world is to load it. Flush what is owed first.
        this.save();
        if (typeof Edits !== 'undefined') Edits.save();
        if (typeof Removed !== 'undefined') Removed.save();
        this.cmdHistory.push('walking to ' + v + '...');
        if (typeof location !== 'undefined') location.search = '?seed=' + v;
        return;
      }
      this.cmdHistory.push('seed ' + CFG.SEED + '  -  "seed <n>" walks to another world');
      this.cmdHistory.push('every world keeps its own digs, items and record');
      return;
    }
    if (verb === 'quality') {
      if (typeof Quality === 'undefined') {
        this.cmdHistory.push('quality control is not loaded');
        return;
      }
      if (arg.length > 1 && !Quality.set(arg[1].toLowerCase())) {
        this.cmdHistory.push('quality: low, medium, high, or auto');
        return;
      }
      this.cmdHistory.push(Quality.describe());
      return;
    }
    // The screen already IS text. Handing it back as text is the one export
    // format this renderer can offer that no screenshot improves on.
    if (verb === 'copy') {
      if (typeof GPURenderer === 'undefined' || !GPURenderer.ok) {
        this.cmdHistory.push('nothing to copy - the renderer is not running');
        return;
      }
      // Nobody wants a picture of themselves asking for a picture, so the
      // console closes first and the grab waits for the HUD to be redrawn
      // without it. Two frames, because the redraw happens inside the frame
      // loop and this is not being called from it. The world itself is
      // unaffected: the overlay is substituted in the glyph pass, not
      // marched in the raymarch, so nothing has to be re-rendered.
      this.close();
      const done = m => this.toast(m);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        GPURenderer.captureText().then(txt => {
          const rows = txt.split('\n').length;
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(txt).then(
              () => done(rows + ' lines copied'),
              () => { console.log(txt); done('clipboard refused it - see the console'); });
          } else { console.log(txt); done('no clipboard here - see the console'); }
        }, e => done('copy failed: ' + e.message));
      }));
      return;
    }
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
      case 'wipe':
        this.inv.clear(); this.read = []; this.done = false; this.used.clear();
        if (typeof localStorage !== 'undefined') {
          // this world only: another seed's digs are none of its business
          localStorage.removeItem(saveKey('ascii-save-v1'));
          localStorage.removeItem(saveKey('ascii-caves-v1'));
          localStorage.removeItem(saveKey('ascii-removed-v1'));
        }
        this.cmdHistory.push('save wiped - reload to start over');
        break;
      case 'help':
        this.cmdHistory.push('commands: seed <n>, quality <low|medium|high|auto>,');
        this.cmdHistory.push('copy, time <h>, freeze, daylen <s>, devmode,');
        this.cmdHistory.push('wipe, clear, help');
        break;
      default:
        this.cmdHistory.push('unknown command: ' + cmd);
    }
    if (this.cmdHistory.length > 40) this.cmdHistory.splice(0, this.cmdHistory.length - 40);
  },

  // ---- input: returns true when the key was consumed ----

  key(code) {
    // the prologue yields to anything at all, and lands on the title
    if (this.mode === 'myth') {
      if (code !== 'F11') { this.mode = 'title'; this.uiDirty = true; }
      return true;
    }
    if (this.mode === 'play') {
      if (code === 'Tab') { this.open('inventory'); return true; }
      if (code === 'KeyC') { this.open('craft'); return true; }
      if (code === 'KeyJ') { this.open('journal'); return true; }
      if (code === 'KeyE') { this.examine(); return true; }
      return false;
    }
    // the title is dismissed by anything, and offers nothing else
    if (this.mode === 'title') {
      if (code !== 'F11') this.close();
      return true;
    }
    if (code === 'KeyJ' && this.mode !== 'journal') { this.open('journal'); return true; }
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
      const made = r.n || 1;
      this.give(r.out, made);
      this.toast('crafted: ' + (made > 1 ? made + ' ' : '') + ITEMS[r.out].name);
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

  // The spent set rides along in every save, and a long walk gathers
  // thousands of loose stones - unbounded, it is the one part of the save
  // that grows without end. Oldest first out, so a patch the player left
  // far behind will eventually offer itself again, which is a cheaper
  // failure than a save that never stops growing. (A Set iterates in
  // insertion order, so the first value is always the oldest.)
  USED_MAX: 512,

  spend(key) {
    this.used.add(key);
    while (this.used.size > this.USED_MAX) {
      this.used.delete(this.used.values().next().value);
    }
    this.needSave = true;
  },

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
      acts.push({ label, fn: () => { this.spend(this.useKey(t, what)); fn(); } });
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
    } else if (t.kind === 'ore' || t.kind === 'gem') {
      const id = t.kind === 'gem' ? 'gem' : oreItem(...t.point);
      const need = t.kind === 'gem' ? 3 : (id === 'iron' ? 2 : 1);
      const has = this.pickTier() >= need;
      once('mine', 'mine  (+1 ' + ITEMS[id].name + ')' +
        (has ? '' : '  (needs ' + this.PICK_NAME[need] + ')'), () => {
          if (!has) { this.toast('you need ' + this.PICK_NAME[need] + ' for that'); return; }
          this.give(id, 1);
          this.toast('+1 ' + ITEMS[id].name + ' (' + this.count(id) + ')');
        });
    } else if (t.kind === 'stone') {
      acts.push({ label: 'pick up  (+1 stone)', fn: () => {
        Removed.add(t.ix, t.iy);
        this.give('stone', 1);
        this.toast('+1 stone (' + this.count('stone') + ')');
        this.close();
      } });
    } else if (t.kind === 'boulder') {
      const has = this.pickTier() >= 1;   // plain rock: any pick will do
      acts.push({ label: 'break' + (has ? '  (+3 stone)' : '  (needs a pickaxe)'),
        fn: () => {
          if (!has) { this.toast('you need a pickaxe for that'); return; }
          Removed.add(t.ix, t.iy);
          this.give('stone', 3);
          this.toast('the boulder splits  (+3 stone)');
          this.close();
        } });
    } else if (t.kind === 'rock' || t.kind === 'cavewall' || t.kind === 'dug') {
      // Loose scree, gathered by hand: the bootstrap out of having no tools
      // at all, since every recipe starts with stone.
      once('gather', 'gather loose stone  (+1 stone)', () => {
        this.give('stone', 1);
        this.toast('+1 stone (' + this.count('stone') + ')');
      });
    } else if (t.kind === 'pillar' && t.hall) {
      // Far enough out, no people's record reaches the hall and the pillar
      // is only a pillar. The region is finite; the world is not.
      const ins = Lore.inscription(t.hall.cx, t.hall.cy, t.hall.k);
      if (ins) {
        const seen = this.read.includes(ins.key);
        acts.push({ label: seen ? 'read again' : 'read the inscription',
          fn: () => this.readInscription(ins) });
      }
    } else if (t.kind === 'water') {
      acts.push({ label: 'drink', fn: () => this.toast('Cold and clean.') });
    }
    return acts;
  },

  // ---- the record ----

  // Which depths the player has read from. The story runs founding, digging,
  // end down the three bands, so holding all three is holding the whole of
  // it - and it can only be done by going down.
  bandsRead() {
    const b = new Set();
    for (const k of this.read) b.add(k.split(',')[2]);
    return b;
  },

  objective() {
    if (this.done) return 'the record is whole';
    const n = this.bandsRead().size;
    if (this.read.length === 0) return 'find the carved halls, and read what they cut';
    return 'the record runs deeper: ' + n + ' of 3 depths read';
  },

  readInscription(ins) {
    this.reading = ins;
    if (!this.read.includes(ins.key)) {
      this.read.push(ins.key);
      this.needSave = true;
    }
    this.open('reading');
    if (!this.done && this.bandsRead().size >= 3) {
      this.done = true;
      this.needSave = true;
    }
  },

  chop(t, sp) {
    if (!this.count('axe')) { this.toast('you need an axe for that'); return; }
    if (typeof Removed === 'undefined') { this.toast('the axe is not sharp yet'); return; }
    Removed.add(t.ix, t.iy);
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
      case 'stone':     return ['LOOSE STONE', 'Fist-sized. It would go in a',
                                'pocket without complaint.'];
      case 'boulder':   return ['BOULDER', 'Half-buried and going nowhere.',
                                'It would take a pickaxe.'];
      case 'water':     return ['WATER', 'Still, dark, patient.'];
      case 'lichen':    return ['GLOW LICHEN', ITEMS.lichen.desc];
      case 'ore':       return [ITEMS[oreItem(...t.point)].name.toUpperCase() + ' VEIN',
                                'A seam of metal threading the stone.'];
      case 'gem':       return ['GEM IN THE ROCK',
                                'Deep in a vein, something is catching',
                                'the light that is not stone.'];
      case 'cavewall':  return ['CAVE WALL', 'Water-worn stone. It has been',
                                'down here longer than anything.'];
      case 'dug':       return ['HEWN ROCK', 'Tool marks. Yours.'];
      case 'stair':     return ['STAIR WELL', 'Old, deliberate, patient work.',
                                'Someone cut this. Long ago.'];
      case 'pillar':    return ['CARVED PILLAR', 'Tool marks spiral upward.',
                                'It is holding the mountain up.'];
      case 'hallfloor': return ['CARVED FLOOR', 'Dead flat. Nothing natural',
                                'is this flat.'];
      case 'sand':      return ['SHORE SAND', 'Fine and pale. A shovel would',
                                'move it easily.'];
      case 'rock':      return ['BARE ROCK', 'Too steep for soil to hold.',
                                'Loose scree lies at your feet.'];
      case 'grass':     return ['MEADOW', 'Wind-combed grass over deep soil.'];
      default:          return [t.kind.toUpperCase(), ''];
    }
  },

  // ---- per-frame ----

  tick(dt) {
    if (this.mode === 'myth') {
      this.mythT += dt;
      this.uiDirty = true;
      const all = (Lore.init().myth || { lines: [] }).lines;
      // once it has all been said, hold it a moment and then step aside
      if (this.mythT > all.length * this.MYTH_LINE + this.MYTH_HOLD * 4) {
        this.mode = 'title';
      }
    }
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

  // Panels are lines of text placed in the field, not boxes: nothing is
  // padded out to a common width, because padding would clear a rectangle
  // of cells and put the solid backing chip back.
  panel(lines) {
    const w = Math.max(...lines.map(l => l.length));
    const x0 = Math.max(1, (Overlay.cols - w) >> 1);
    const y0 = Math.max(1, ((Overlay.rows - lines.length) >> 1) - 2);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) Overlay.write(x0, y0 + i, lines[i]);
    }
  },

  drawUI() {
    if (this.toastMsg) {
      Overlay.writeCentre(Overlay.rows - 3, ' ' + this.toastMsg + ' ');
    }
    if (this.mode === 'myth') this.drawMyth();
    if (this.mode === 'inventory') this.drawInventory();
    if (this.mode === 'examine') this.drawExamine();
    if (this.mode === 'craft') this.drawCraft();
    if (this.mode === 'console') this.drawConsole();
    if (this.mode === 'reading') this.drawReading();
    if (this.mode === 'journal') this.drawJournal();
    if (this.mode === 'title') this.drawTitle();
  },

  // One line of the myth at a time, laid out for the whole of it from the
  // first line, so the text does not walk up the screen as more arrives.
  drawMyth() {
    const all = (Lore.init().myth || { lines: [] }).lines;
    if (!all.length) { this.mode = 'title'; return; }
    const shown = Math.min(all.length, Math.floor(this.mythT / this.MYTH_LINE));
    const w = Math.max(...all.map(l => l.length));
    const x0 = Math.max(1, (Overlay.cols - w) >> 1);
    const y0 = Math.max(1, (Overlay.rows - (all.length + 2)) >> 1);
    for (let i = 0; i < shown; i++) if (all[i]) Overlay.write(x0, y0 + i, all[i]);
    if (shown >= all.length) {
      Overlay.write(x0, y0 + all.length + 1, 'press any key');
    }
  },

  drawTitle() {
    this.panel([
      'A S C I I   W O R L D',
      '',
      'Every hill, cave and stone here is a',
      'number, worked out the moment you look',
      'at it. Nothing is stored. It goes on as',
      'far as you care to walk.',
      '',
      'You are standing at a cave mouth. Someone',
      'cut the stair below you, a long time ago,',
      'and left their record on the walls.',
      '',
      'Find out who they were.',
      '',
      'E    look at what is in front of you',
      'WASD walk    LMB dig    Tab your things',
      'C    craft   J record   Enter console',
      '',
      'press any key',
    ]);
  },

  drawReading() {
    if (!this.reading) return;
    const lines = ['CUT INTO THE PILLAR', ''];
    for (const l of this.reading.lines) lines.push(l);
    lines.push('');
    if (this.done && this.bandsRead().size >= 3) {
      lines.push('That is the last of it. The record is whole.');
      lines.push('[J] read it through  [Q] close');
    } else {
      lines.push(this.objective());
      lines.push('[Q] close');
    }
    this.panel(lines);
  },

  drawJournal() {
    const lines = ['THE RECORD', ''];
    if (this.read.length === 0) {
      lines.push('Nothing yet. Somewhere below, someone');
      lines.push('cut their history into the stone.');
    } else {
      // Deepest last, so the panel reads the way the descent did. Different
      // halls can belong to different peoples now, so each entry carries
      // its own name rather than the panel carrying one for all of them.
      const order = [...this.read].sort((a, b) =>
        Number(b.split(',')[2]) - Number(a.split(',')[2]));
      for (const key of order) {
        const [cx, cy, k] = key.split(',').map(Number);
        const ins = Lore.inscription(cx, cy, k);
        if (!ins) continue;
        for (const l of ins.lines) lines.push(l);
        lines.push('');
      }
      lines.push(this.done
        ? 'That is as deep as anyone cut. Nobody came back up.'
        : this.objective());
    }
    lines.push('[Q] close');
    this.panel(lines);
  },

  drawConsole() {
    const w = Math.min(Overlay.cols - 4, 70);
    const h = 9;
    const x0 = 2, y0 = Math.max(1, Overlay.rows - h - 2);
    Overlay.write(x0, y0, 'CONSOLE' + (this.devMode ? ' [dev]' : ''));
    const rows = h - 2;
    const hist = this.cmdHistory.slice(-rows);
    for (let i = 0; i < rows; i++) {
      if (hist[i]) Overlay.write(x0 + 1, y0 + 1 + i, hist[i].slice(0, w - 2));
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
      const out = (r.n > 1 ? r.n + ' ' : '') + ITEMS[r.out].name;
      lines.push((i === cur ? '> ' : '  ') +
        out.padEnd(16) + needs + mark + owned);
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

  // Everything the player accumulated, including where they were standing:
  // a world you return to has to still have you in it.
  snapshot() {
    const inv = {};
    for (const [k, v] of this.inv) inv[k] = v;
    return {
      inv, read: this.read, done: this.done,
      at: typeof Player !== 'undefined' ? [Player.x, Player.y, Player.angle,
                                           Player.pitch, Player.z] : null,
      t: typeof Sky !== 'undefined' ? Sky.t : null,
      used: [...this.used],
    };
  },

  restore(s) {
    this.inv.clear();
    for (const k of Object.keys(s.inv || {})) this.inv.set(k, s.inv[k]);
    this.read = Array.isArray(s.read) ? s.read : [];
    this.done = !!s.done;
    this.used = new Set((s.used || []).slice(-this.USED_MAX));
    this.spawnAt = Array.isArray(s.at) ? s.at : null;
    if (typeof s.t === 'number' && typeof Sky !== 'undefined') Sky.t = s.t;
  },

  save() {
    if (typeof localStorage === 'undefined') { this.needSave = false; return; }
    try { localStorage.setItem(saveKey('ascii-save-v1'), JSON.stringify(this.snapshot())); }
    catch (e) { console.warn('save failed: ' + e.message); }
    this.needSave = false;
  },

  load() {
    if (typeof localStorage === 'undefined') return;
    const s = localStorage.getItem(saveKey('ascii-save-v1'));
    if (!s) return;
    try { this.restore(JSON.parse(s)); }
    catch (e) { console.warn('load failed'); }
  },
};
