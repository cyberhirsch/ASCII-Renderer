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
  quests: {},           // quest id -> 'open' | 'done'; the only quest state
  done: false,          // the record has been pieced together
  spawnAt: null,        // where a saved game left the player standing

  // The prologue: what they say came before the record. It runs once, for
  // somebody who has never been here - a returning player is dropped
  // straight back in where they stopped, and does not sit through the
  // creation of the world a second time.
  //
  // Two parts, both on a black field. First the myth, which is what they
  // say came before anybody was counting. Then the record itself, run as a
  // timelapse rather than listed: seeing the myth without the history is
  // being told a world is old, and being shown six thousand years of it
  // arriving and going out is being shown that it is.
  mythT: 0,
  mythPart: 0,
  MYTH_LINE: 0.38,   // seconds before the next line of it arrives
  MYTH_HOLD: 1.2,    // and how long it stands complete before moving on

  prologue() {
    const L = Lore.init();
    return (L.myth || { lines: [] }).lines;
  },

  // Anything at all moves it on: the record, then the world. Nothing in
  // between - the record IS the introduction, and a panel after it telling
  // you what the game is and what to go and do undoes the whole point of
  // having shown you six thousand years instead of saying them.
  mythNext() {
    if (this.mythPart === 0) {
      this.mythPart = 1;
      this.mythT = 0;
    } else {
      this.mode = 'play';
    }
    this.uiDirty = true;
  },

  init() {
    this.load();
    if (!this.spawnAt) { this.mode = 'myth'; this.mythPart = 0; this.mythT = 0; }
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
  close() { this.mode = 'play'; this.menuAsk = false; this.uiDirty = true; },

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
    // the map's scale, since what you want to see changes with what you
    // are looking for: a cave mouth is a walk away, a settlement is not
    if (verb === 'map') {
      if (!this.devMode) {
        this.cmdHistory.push('the map is a devmode tool - run "devmode" first');
        return;
      }
      const z = this.MAP_ZOOM;
      if (arg.length > 1 && isFinite(parseFloat(arg[1]))) {
        this.MAP.u = clamp(parseFloat(arg[1]), 1, 400);
      } else {
        this.MAP.u = z[(z.indexOf(this.MAP.u) + 1) % z.length];
      }
      this.mapKey = '';
      this.uiDirty = true;
      this.cmdHistory.push('map ' + this.MAP.u + ' units to a cell' +
        '  (@ you, > cave mouth, HFMT standing, hfmt ruined)');
      return;
    }
    // Getting to the thing you are working on. Walking to the nearest
    // settlement is four hundred units, and doing that by hand every time
    // you change a line of the asset code is most of a debugging session.
    if (verb === 'teleport' || verb === 'tp') {
      if (!this.devMode) {
        this.cmdHistory.push('teleport is a devmode tool - run "devmode" first');
        return;
      }
      const what = (arg[1] || '').toLowerCase();
      if (what === 'building') { this.tpBuilding(); return; }
      if (what === 'npc') { this.tpNpc(); return; }
      this.cmdHistory.push('teleport building | npc');
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
        this.cmdHistory.push('copy, time <h>, freeze, daylen <s>, devmode, map,');
        this.cmdHistory.push('teleport <building|npc>,');
        this.cmdHistory.push('wipe, clear, help');
        break;
      default:
        this.cmdHistory.push('unknown command: ' + cmd);
    }
    if (this.cmdHistory.length > 40) this.cmdHistory.splice(0, this.cmdHistory.length - 40);
  },

  // ---- input: returns true when the key was consumed ----

  key(code) {
    // the prologue yields to anything at all
    if (this.mode === 'myth') {
      if (code !== 'F11') this.mythNext();
      return true;
    }
    if (this.mode === 'play') {
      if (code === 'Escape') { this.openMenu(); return true; }
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
    if (this.mode === 'talk') { this.talkAct(); return; }
    if (this.mode === 'menu') {
      const n = this.MENU.length;
      this.menuDo(this.MENU[((this.cursor % n) + n) % n][0]);
      return;
    }
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
    } else if (t.kind === 'npc') {
      const who = NPC.byId(t.npc);
      if (who) acts.push({ label: 'speak to ' + who.name, fn: () => this.talkTo(who) });
    } else if (t.kind === 'water') {
      acts.push({ label: 'drink', fn: () => this.toast('Cold and clean.') });
    }
    return acts;
  },

  // ---- people, and what they want ----

  talking: null, talkQ: null, talkSay: '',

  talkTo(who) {
    this.talking = who;
    this.talkQ = Quest.forNpc(who);
    this.talkSay = '';
    this.open('talk');
  },

  questState(q) { return q ? (this.quests[q.id] || 'none') : 'none'; },

  // One button does the whole conversation, because there is only ever one
  // thing to do next: take the work, hand it in, or nothing.
  talkAct() {
    const q = this.talkQ;
    if (!q) { this.close(); return; }
    const st = this.questState(q);
    if (st === 'none') {
      this.quests[q.id] = 'open';
      this.needSave = true;
      this.talkSay = '"Then we have an understanding."';
      this.uiDirty = true;
      return;
    }
    if (st === 'open' && Quest.done(q)) {
      this.quests[q.id] = 'done';
      this.needSave = true;
      this.talkSay = Quest.hand(q, this.talking);
      this.uiDirty = true;
      return;
    }
    this.close();
  },

  drawTalk() {
    const who = this.talking;
    if (!who) return;
    const lines = NPC.greet(who);
    const q = this.talkQ;
    const st = this.questState(q);
    lines.push('');
    if (q && st === 'none') {
      for (const l of q.ask) lines.push(l);
      lines.push('');
      lines.push('[E] take it on   [Q] walk away');
    } else if (q && st === 'open') {
      lines.push(Quest.done(q) ? '"You have it. Give it here."'
                               : '"' + q.task + '."');
      lines.push('');
      lines.push(Quest.done(q) ? '[E] hand it over   [Q] not yet'
                               : '[Q] leave');
    } else if (q) {
      lines.push('"That is settled between us."');
      lines.push('');
      lines.push('[Q] leave');
    } else {
      lines.push('[Q] leave');
    }
    if (this.talkSay) { lines.push(''); lines.push(this.talkSay); }
    this.panel(lines);
  },

  // What is owed and to whom, on the journal's back page.
  questLines() {
    const out = [];
    if (typeof NPC === 'undefined' || typeof Quest === 'undefined') return out;
    for (const id of Object.keys(this.quests)) {
      if (this.quests[id] !== 'open') continue;
      const n = NPC.byId(Number(id.slice(1)));
      const q = n ? Quest.forNpc(n) : null;
      if (q) out.push('  ' + q.task + (Quest.done(q) ? '   - go back' : ''));
    }
    return out;
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

  // The top line, and only when there is something true to put on it.
  //
  // It used to open with 'find the carved halls, and read what they cut',
  // which is the game handing you a quest nobody in it ever gave you. You
  // are not told what to do here: until you have read something off a wall
  // or somebody has asked you for something, there is nothing owed and the
  // line stays empty.
  objective() {
    if (this.done) return 'the record is whole';
    if (this.read.length === 0) {
      return this.questLines().length ? 'somebody has asked something of you  [J]' : '';
    }
    return 'the record runs deeper: ' + this.bandsRead().size + ' of 3 depths read';
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
      case 'npc': {
        const who = NPC.byId(t.npc);
        return who ? [who.name.toUpperCase(), who.doing + ', of ' + who.peopleName + '.']
                   : ['SOMEBODY', ''];
      }
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
    // a map that lags behind where you are standing is worse than none
    if (this.devMode && typeof Player !== 'undefined' && this.mapAt() !== this.mapKey) {
      this.uiDirty = true;
    }
    if (this.mode === 'myth') {
      this.mythT += dt;
      this.uiDirty = true;
      if (this.mythPart === 0) {
        const all = this.prologue();
        // once it has all been said, hold it a moment and then move on
        if (this.mythT > all.length * this.MYTH_LINE + this.MYTH_HOLD * 4) {
          this.mythNext();
        }
      } else if (this.mythT > this.tlLen()) {
        this.mythNext();
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

  // ---- devmode: getting to the thing you are looking at ----

  // Put the player down NEXT to something rather than on top of it. A
  // teleport that lands inside a building shows you the inside of a wall
  // and reads as the renderer being broken - which cost a real half hour
  // once already.
  standBy(x, y, clear, face) {
    const step = 0.6;
    let z = null;
    // walk outwards from the target until there is somewhere to stand
    for (let r = clear; r < clear + 14 && z === null; r += step) {
      for (let a = 0; a < Math.PI * 2 - 0.01; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (World.groundZ(px, py) < CFG.SEA_LEVEL) continue;   // not into the sea
        const fz = World.walkZ(px, py, World.groundZ(px, py));
        if (fz === null) continue;
        Player.x = px; Player.y = py; Player.z = fz;
        z = fz;
        break;
      }
    }
    if (z === null) { Player.x = x; Player.y = y; Player.z = World.groundZ(x, y); }
    Player.vz = 0; Player.onGround = true; Player.swimming = false;
    if (face) Player.angle = Math.atan2(y - Player.y, x - Player.x);
    Player.pitch = 0;
    // the resident set was packed somewhere else entirely
    if (typeof GPURenderer !== 'undefined') GPURenderer.steadAt = null;
    this.needSave = true;
    this.close();
  },

  tpBuilding() {
    if (typeof Steading === 'undefined' || typeof Lore === 'undefined' || !Lore.S) {
      this.cmdHistory.push('no chronicle loaded, so nothing has been built');
      return;
    }
    const S = Lore.S;
    let site = null, sd = Infinity;
    for (const st of S.sites) {
      const d = (st.x - Player.x) ** 2 + (st.y - Player.y) ** 2;
      if (d < sd) { sd = d; site = st; }
    }
    if (!site) { this.cmdHistory.push('no settlements in this world'); return; }
    // Sites sit at least a couple of hundred units apart, so the nearest
    // building is always in the nearest place - no need to open them all.
    let best = null, bd = Infinity;
    for (const b of Steading.plan(S, site, S.now)) {
      const d = (b.pos[0] - Player.x) ** 2 + (b.pos[1] - Player.y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) { this.cmdHistory.push('nothing stands at ' + site.name); return; }
    const away = Math.round(Math.sqrt(bd));
    this.standBy(best.pos[0], best.pos[1], 11, true);
    const p = S.peoples[site.people];
    this.toast(best.build + ' at ' + site.name +
      (site.abandoned < 0 ? ', still lived in' : ', lost ' + site.abandoned) +
      '  (' + away + 'u)');
    console.info('[teleport] ' + best.build + ' of ' + (p ? p.name : '?') +
                 ' at ' + site.name);
  },

  tpNpc() {
    const live = (typeof Entities !== 'undefined' && Entities.list) ? Entities.list : [];
    if (!live.length) {
      // Said plainly rather than failing silently: there is no creature
      // system yet, so this is not a bug in the command.
      this.cmdHistory.push('nobody is alive in this world yet - Entities.list is');
      this.cmdHistory.push('empty until the creature phase lands');
      return;
    }
    let best = null, bd = Infinity;
    for (const e of live) {
      const d = (e.x - Player.x) ** 2 + (e.y - Player.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    this.standBy(best.x, best.y, 3, true);
    this.toast('nearest ' + (best.kind === undefined ? 'creature' : 'kind ' + best.kind) +
               '  (' + Math.round(Math.sqrt(bd)) + 'u)');
  },

  // ---- the menu ----
  //
  // Escape opens it, and so does losing the mouse: a browser takes the
  // pointer back on Escape and eats the key that did it, so a menu bound
  // only to the key would sometimes not arrive. Coming up when you click
  // away is the right behaviour anyway.
  MENU: [
    ['save',    'save now'],
    ['load',    'go back to the last save'],
    ['restart', 'start this world over'],
    ['quit',    'save and stop'],
  ],
  menuAsk: false,     // restart throws away a world, so it is asked twice

  openMenu() {
    this.menuAsk = false;
    this.open('menu');
  },

  // Everything owed to disk, in one place: the three stores save on their
  // own clocks and a menu that only wrote one of them would be a lie.
  saveAll() {
    this.save();
    if (typeof Edits !== 'undefined') Edits.save();
    if (typeof Removed !== 'undefined') Removed.save();
  },

  menuDo(act) {
    if (act === 'save') {
      this.saveAll();
      this.close();
      this.toast('saved');
      return;
    }
    if (act === 'load') {
      // The save IS the file on disk, so going back to it is a reload -
      // half a dozen modules cache something derived from it and would
      // each need unpicking otherwise.
      if (typeof location !== 'undefined') location.reload();
      return;
    }
    if (act === 'restart') {
      if (!this.menuAsk) { this.menuAsk = true; this.uiDirty = true; return; }
      this.inv.clear(); this.read = []; this.done = false; this.used.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(saveKey('ascii-save-v1'));
        localStorage.removeItem(saveKey('ascii-caves-v1'));
        localStorage.removeItem(saveKey('ascii-removed-v1'));
      }
      if (typeof location !== 'undefined') location.reload();
      return;
    }
    if (act === 'quit') {
      this.saveAll();
      // A page cannot close a tab it did not open, so this stops rather
      // than pretending to exit: saved, back to the title, safe to close.
      this.close();
      this.mode = 'title';
      this.uiDirty = true;
    }
  },

  drawMenu() {
    const lines = ['ASCII WORLD', ''];
    const n = this.MENU.length;
    const cur = ((this.cursor % n) + n) % n;
    for (let i = 0; i < n; i++) {
      lines.push((i === cur ? '> ' : '  ') + this.MENU[i][1]);
    }
    lines.push('');
    if (this.menuAsk) {
      lines.push('This throws away this world\'s digs, items and');
      lines.push('record. [E] again to do it, [Q] to think better.');
    } else {
      lines.push('[W/S] choose  [E] do  [Q] back to the world');
    }
    this.panel(lines);
  },

  // ---- the minimap (devmode) ----
  //
  // Drawn into the glyph grid like everything else, because a DOM overlay
  // would be the one thing on screen that is not made of characters. North
  // is up: the chronicle calls -y north, and the map has to agree with the
  // bearings the inscriptions give.
  //
  // Cells are taller than they are wide, so a cell covers proportionally
  // more world vertically - otherwise the map is squashed and a circle of
  // ground reads as an ellipse.
  MAP: { w: 31, h: 15, u: 12 },
  MAP_ZOOM: [6, 12, 24, 48, 96],
  MAP_RAMP: '.,:;=+*#',      // land, low to high; water has its own mark
  MAP_KIND: { hold: 'H', farm: 'F', mine: 'M', fort: 'T' },
  mapRows: null, mapTint: null, mapKey: '',

  // What the map is centred on, as a key: rebuilding only when this changes
  // keeps 465 terrain samples off the frames where nothing moved.
  mapAt() {
    const uy = this.MAP.u * CFG.CELL_H / CFG.CELL_W;
    return Math.round(Player.x / this.MAP.u) + ',' +
           Math.round(Player.y / uy) + ',' + this.MAP.u;
  },

  buildMap() {
    const key = this.mapAt();
    if (this.mapRows && this.mapKey === key) return this.mapRows;
    this.mapKey = key;
    const M = this.MAP;
    const ux = M.u, uy = M.u * CFG.CELL_H / CFG.CELL_W;
    const cx = (M.w - 1) / 2, cy = (M.h - 1) / 2;
    const px = Player.x, py = Player.y;
    const g = [], t = [];
    for (let j = 0; j < M.h; j++) {
      const row = [], trow = [];
      for (let i = 0; i < M.w; i++) {
        const h = terrainH(px + (i - cx) * ux, py + (j - cy) * uy);
        const wet = h < CFG.SEA_LEVEL;
        row.push(wet ? '~' : this.MAP_RAMP[
          clamp(Math.floor(h / CFG.TERRAIN_MAX * this.MAP_RAMP.length),
                0, this.MAP_RAMP.length - 1)]);
        trow.push(wet ? Overlay.C.water : Overlay.C.land);
      }
      g.push(row);
      t.push(trow);
    }
    const put = (wx, wy, ch, tint) => {
      const i = Math.round((wx - px) / ux + cx);
      const j = Math.round((wy - py) / uy + cy);
      if (i >= 0 && i < M.w && j >= 0 && j < M.h) { g[j][i] = ch; t[j][i] = tint; }
    };
    // Cave mouths, which is most of what this is for: they are the one
    // thing in the world you have to find on foot and cannot see far.
    const SE = CAVES.SHAFT_E;
    for (let sy = Math.floor((py - cy * uy) / SE); sy <= Math.floor((py + cy * uy) / SE); sy++) {
      for (let sx = Math.floor((px - cx * ux) / SE); sx <= Math.floor((px + cx * ux) / SE); sx++) {
        const a = shaftAt(sx, sy, 0);
        if (a) put(a.ax, a.ay, '>', Overlay.C.cave);
      }
    }
    // Settlements: standing in capitals, gone in lower case, so a glance
    // says which of them there is anybody left in.
    if (typeof Lore !== 'undefined' && Lore.S) {
      for (const st of Lore.S.sites) {
        const ch = this.MAP_KIND[st.kind] || 'S';
        put(st.x, st.y, st.abandoned < 0 ? ch : ch.toLowerCase(), Overlay.C.site);
      }
    }
    g[Math.round(cy)][Math.round(cx)] = '@';
    t[Math.round(cy)][Math.round(cx)] = Overlay.C.self;
    this.mapRows = g.map(r => r.join(''));
    this.mapTint = t;
    return this.mapRows;
  },

  // ---- the compass (devmode) ----
  //
  // Placed where the direction actually is, not spaced evenly: a label sits
  // at the column its bearing projects to, using the same tangent the
  // camera does. So walking turns the strip at the rate the world turns,
  // and a word sits over the thing it names.
  //
  // East is +x and north is -y, which is what the chronicle's bearings and
  // the minimap already mean.
  //
  // Second row, not the first: the top one carries the frame statistics and
  // whatever has been asked of you, and a compass word sliding along it as
  // you turn would walk straight over both.
  COMPASS: [
    [0, 'east'], [1, 'south-east'], [2, 'south'], [3, 'south-west'],
    [4, 'west'], [5, 'north-west'], [6, 'north'], [7, 'north-east'],
  ],

  COMPASS_ROW: 1,

  drawCompass() {
    const half = Math.atan(CFG.PLANE_LEN);      // half the horizontal field
    for (const [oct, name] of this.COMPASS) {
      let d = oct * Math.PI / 4 - Player.angle;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (Math.abs(d) >= half - 0.02) continue;
      const ndc = Math.tan(d) / CFG.PLANE_LEN;
      const at = Math.round((ndc + 1) / 2 * Overlay.cols - name.length / 2);
      if (at < 0 || at + name.length > Overlay.cols) continue;
      Overlay.write(at, this.COMPASS_ROW, name);
    }
  },

  drawMap() {
    const M = this.MAP;
    const x0 = Overlay.cols - M.w - 1;
    // one row under the compass, which is itself one under the statistics
    const y0 = this.COMPASS_ROW + 1;
    if (x0 < 1 || Overlay.rows < M.h + y0 + 3) return;   // no room; say nothing
    const rows = this.buildMap();
    Overlay.write(x0, y0, ('map ' + M.u + 'u  ' +
      Math.round(Player.x) + ',' + Math.round(Player.y)).slice(0, M.w));
    // cell by cell, because every one carries its own colour
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < rows[j].length; i++) {
        Overlay.put(x0 + i, y0 + 1 + j, rows[j][i], this.mapTint[j][i]);
      }
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
    // The opening owns the whole screen. Blacking the field out first is
    // the point of it: the world behind a text that is meant to be read is
    // a distraction, and a map of the centuries drawn over a forest cannot
    // be read at all. Nothing else on the HUD belongs here either, so this
    // returns rather than falling through to it.
    if (this.mode === 'myth') {
      Overlay.blackout();
      if (this.mythPart === 0) this.drawMyth(); else this.drawTimelapse();
      return;
    }
    if (this.devMode && typeof Player !== 'undefined') { this.drawCompass(); this.drawMap(); }
    if (this.toastMsg) {
      Overlay.writeCentre(Overlay.rows - 3, ' ' + this.toastMsg + ' ');
    }
    if (this.mode === 'menu') this.drawMenu();
    if (this.mode === 'inventory') this.drawInventory();
    if (this.mode === 'examine') this.drawExamine();
    if (this.mode === 'craft') this.drawCraft();
    if (this.mode === 'console') this.drawConsole();
    if (this.mode === 'talk') this.drawTalk();
    if (this.mode === 'reading') this.drawReading();
    if (this.mode === 'journal') this.drawJournal();
    if (this.mode === 'title') this.drawTitle();
  },

  // One line of the myth at a time, laid out for the whole of it from the
  // first line, so the text does not walk up the screen as more arrives.
  drawMyth() {
    const all = this.prologue();
    if (!all.length) { this.mythNext(); return; }
    const shown = Math.min(all.length, Math.floor(this.mythT / this.MYTH_LINE));
    const w = Math.max(...all.map(l => l.length));
    const x0 = Math.max(1, (Overlay.cols - w) >> 1);
    const y0 = Math.max(1, (Overlay.rows - (all.length + 2)) >> 1);
    for (let i = 0; i < shown; i++) {
      if (all[i]) Overlay.write(x0, y0 + i, all[i], Overlay.C.white);
    }
    if (shown >= all.length) {
      Overlay.write(x0, y0 + all.length + 1, 'press any key', Overlay.C.white);
    }
  },


  // ---- the opening timelapse: the chronicle, drawn ----
  //
  // The map is the survey the simulation itself ran on - the same 64x64
  // grid of heights and water that decided where anybody could live - so
  // this is not an illustration of the history, it is the history, at one
  // character to a couple of hundred metres.
  //
  // The clock runs at a constant rate and the captions arrive when their
  // year does. History clusters, so sometimes two land together and the
  // oldest scrolls off quickly; that is what a timelapse is. The map is
  // the part you are meant to watch.
  TL_SPEED: 500,     // years per second: the whole span in about twelve
  TL_HOLD: 3.2,      // seconds the finished map stands before the title
  TL_LOG: 4,         // captions kept on screen at once
  TL_MAX_H: 30,      // rows the map may take, however big the window is
  tlBg: null, tlBgKey: '', tlWide: 0,

  // how long the whole thing takes, so tick() knows when it is over
  tlLen() { return Lore.init().now / this.TL_SPEED + this.TL_HOLD; },

  // The year on screen. Derived from elapsed time rather than integrated,
  // so a dropped frame loses no years and the run is the same length on
  // every machine.
  tlYear() {
    const S = Lore.init();
    return Math.min(S.now, Math.floor(this.mythT * this.TL_SPEED));
  },

  // Where the map goes. A square region wants cells as wide as they are
  // tall and character cells are not, so the column count is the row count
  // scaled by the cell aspect - otherwise the region reads as an ellipse.
  //
  // Counted from the bottom line up, not guessed: header, gap, map, gap,
  // the captions, gap, "press any key". Getting that budget wrong does not
  // look wrong, it just drops the last line off the screen, which is how
  // the footer went missing on every window under fifty rows.
  tlLayout() {
    const chrome = this.TL_LOG + 6;
    const h = Math.min(this.TL_MAX_H, Overlay.rows - chrome);
    if (h < 8) return null;                       // no room: skip the map
    const w = Math.min(Overlay.cols - 2,
                       Math.round(h * CFG.CELL_H / CFG.CELL_W));
    if (w < 12) return null;
    const y0 = Math.max(1, (Overlay.rows - (h + this.TL_LOG + 5)) >> 1);
    return { w, h, x: Math.max(0, (Overlay.cols - w) >> 1), y: y0 + 2 };
  },

  // Where the captions start. The map is narrower than a sentence, so the
  // band is pushed left until the longest line of the whole run fits -
  // measured once, over every beat, so it does not shuffle sideways as the
  // captions change.
  tlTextX(L) {
    if (!this.tlWide) {
      for (const b of Lore.timeline()) {
        this.tlWide = Math.max(this.tlWide, b.text.length + 6);
      }
    }
    return Math.max(1, Math.min(L.x, Overlay.cols - 1 - this.tlWide));
  },

  // Ground and water, once. This never changes - six thousand years of
  // people do not move a coastline - so it is built for a given size and
  // then copied every frame.
  //
  // Deliberately flat: no relief. The survey samples the ground every 128
  // units and this terrain varies at about forty, so neighbouring survey
  // cells are statistically independent - measured at r = 0.002 across the
  // whole region. A height ramp drawn from them is not hills, it is noise,
  // and it buries the settlements the map exists to show. Water is a fact
  // the simulation actually used, so that stays.
  TL_LAND: '.', TL_WATER: '~',

  tlBackground(L) {
    const key = L.w + 'x' + L.h;
    if (this.tlBg && this.tlBgKey === key) return this.tlBg;
    const g = Lore.init().grid, N = HIST.N;
    const ch = [], tint = [];
    for (let sy = 0; sy < L.h; sy++) {
      const row = [], trow = [];
      for (let sx = 0; sx < L.w; sx++) {
        // a screen cell can cover more than one survey cell; the majority
        // decides whether it is under water
        const i0 = Math.floor(sx * N / L.w), i1 = Math.max(i0 + 1, Math.floor((sx + 1) * N / L.w));
        const j0 = Math.floor(sy * N / L.h), j1 = Math.max(j0 + 1, Math.floor((sy + 1) * N / L.h));
        let n = 0, wet = 0;
        for (let j = j0; j < j1 && j < N; j++) {
          for (let i = i0; i < i1 && i < N; i++) { wet += g.water[j * N + i]; n++; }
        }
        const under = wet * 2 >= n;
        row.push(under ? this.TL_WATER : this.TL_LAND);
        trow.push(under ? Overlay.C.water : Overlay.C.land);
      }
      ch.push(row); tint.push(trow);
    }
    this.tlBg = { ch, tint };
    this.tlBgKey = key;
    return this.tlBg;
  },

  drawTimelapse() {
    const S = Lore.init();
    const y = this.tlYear();
    const L = this.tlLayout();
    // Too small a window to draw a map in: say the record in words rather
    // than showing nothing, and let it stand for the same length of time.
    if (!L) { this.panel(Lore.chronology()); return; }

    const bg = this.tlBackground(L);
    const ch = bg.ch.map(r => r.slice());
    const tint = bg.tint.map(r => r.slice());
    const N = HIST.N;
    const sxOf = i => Math.min(L.w - 1, Math.floor(i * L.w / N));
    const syOf = j => Math.min(L.h - 1, Math.floor(j * L.h / N));
    const standing = s => s.founded <= y && (s.abandoned < 0 || s.abandoned > y);

    // Roads, but only those with somebody at both ends. A road nobody
    // walks is gone inside a century, and letting six thousand years of
    // everybody's roads accumulate buries the map - so the network grows
    // and dies back with each people, which is what actually happened.
    for (const l of S.links) {
      if (l.built > y) continue;
      if (!standing(S.sites[l.a]) || !standing(S.sites[l.b])) continue;
      for (const k of l.path) {
        const sx = sxOf(k % N), sy = syOf((k / N) | 0);
        ch[sy][sx] = '-';
        tint[sy][sx] = Overlay.C.road;
      }
    }
    // Ruins before the living, so ground settled twice reads as settled:
    // a later people often builds on an older people's ruin field, and the
    // standing place is the news.
    for (const st of S.sites) {
      if (st.founded > y || standing(st)) continue;
      const sx = sxOf(st.i), sy = syOf(st.j);
      ch[sy][sx] = (this.MAP_KIND[st.kind] || 'S').toLowerCase();
      tint[sy][sx] = Overlay.C.ruin;
    }
    for (const st of S.sites) {
      if (!standing(st)) continue;
      const sx = sxOf(st.i), sy = syOf(st.j);
      ch[sy][sx] = this.MAP_KIND[st.kind] || 'S';
      tint[sy][sx] = Overlay.C.site;
    }
    for (let j = 0; j < L.h; j++) {
      for (let i = 0; i < L.w; i++) Overlay.put(L.x + i, L.y + j, ch[j][i], tint[j][i]);
    }

    // The clock, over the map's left shoulder, and what it is counting.
    const head = 'THE YEARS BEFORE YOU';
    Overlay.write(L.x, L.y - 2, head, Overlay.C.white);
    const yr = y >= S.now ? 'and then you' : 'year ' + y;
    Overlay.write(L.x + Math.max(head.length + 2, L.w - yr.length), L.y - 2,
                  yr, Overlay.C.white);

    // The captions stay up at the end too: the last of them is the last
    // people but one going out, which is what the empty map is saying.
    const beats = Lore.timeline();
    const shown = [];
    for (const b of beats) if (b.t <= y) shown.push(b);
    const last = shown.slice(-this.TL_LOG);
    const tx = this.tlTextX(L);
    const room = Overlay.cols - 1 - tx;
    for (let i = 0; i < last.length; i++) {
      const line = String(last[i].t).padStart(4) + '  ' + last[i].text;
      Overlay.write(tx, L.y + L.h + 1 + i, line.slice(0, room), Overlay.C.white);
    }

    if (y >= S.now) {
      // The map has filled with ruins. Say who they all were, on a plate
      // cleared out of the middle of it - padding a line with spaces
      // blanks those cells, so the table gets its own ground to sit on.
      const rows = Lore.chronology();
      const w = Math.min(Overlay.cols - 2,
                         Math.max(L.w, Math.max(...rows.map(r => r.length)) + 4));
      const bx = Math.max(0, L.x + ((L.w - w) >> 1));
      const by = Math.max(1, L.y + ((L.h - rows.length) >> 1));
      for (let i = 0; i < rows.length; i++) {
        Overlay.write(bx, by + i, ('  ' + rows[i]).padEnd(w), Overlay.C.white);
      }
    }
    Overlay.write(tx, L.y + L.h + 1 + this.TL_LOG + 1, 'press any key',
                  Overlay.C.white);
  },

  // The stop screen, and nothing else now. It used to be the panel that
  // came up after the prologue, explaining the game and setting a goal;
  // the timelapse says all of that better, and the keys are on the bottom
  // line of every frame anyway. This is what is left: the one thing a
  // player who picked "stop" from the menu actually needs to know.
  drawTitle() {
    this.panel([
      'A S C I I   W O R L D',
      '',
      'Saved. Safe to close the tab.',
      '',
      'press any key to carry on',
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
    const owed = this.questLines();
    if (owed.length) {
      lines.push('');
      lines.push('ASKED OF YOU');
      for (const l of owed) lines.push(l);
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
      inv, read: this.read, done: this.done, quests: this.quests,
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
    this.quests = (s.quests && typeof s.quests === 'object') ? s.quests : {};
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
