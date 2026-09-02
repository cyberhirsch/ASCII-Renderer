// First-person player over the infinite terrain: WASD move, arrows/mouse
// look, slope- and water-limited movement, trunk-circle tree collision.
const Player = {
  x: 0, y: 0, z: 0, angle: 0.6,
  pitch: 0, // radians; ±90° is straight up/down
  keys: {},
  // Vertical state. The camera used to ride the floor and nothing else, so
  // there was no way to leave the ground and no way to be in water.
  vz: 0,
  onGround: true,
  swimming: false,

  init() {
    // a saved game puts you back where you stopped, facing where you looked
    const at = Game.spawnAt;
    if (at) {
      this.x = at[0]; this.y = at[1];
      this.angle = at[2]; this.pitch = at[3];
      this.z = at[4];
    } else {
      const [sx, sy] = World.findSpawn();
      this.x = sx; this.y = sy;
      this.z = World.groundZ(sx, sy);
    }

    addEventListener('keydown', e => {
      // the console wants raw typed characters, not just key codes - route
      // it before the code-only panel dispatch below
      if (Game.mode === 'console') { Game.consoleInput(e); e.preventDefault(); return; }
      // the game's modal layer gets every key first; panels capture W/S/E/Q
      if (Game.key(e.code)) { e.preventDefault(); return; }
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();   // or the page scrolls
      if (e.code === 'Enter') { Game.openConsole(); return; }
      // view toggles are debug tools, locked behind the "devmode" command
      if (e.code === 'KeyM' && Game.devMode) CFG.MONO = !CFG.MONO;
      if (e.code === 'KeyX' && Game.devMode) CFG.RAW = !CFG.RAW;
      if (e.code === 'KeyV' && GPURenderer.ok) {
        const sets = Object.keys(GlyphAtlas.SETS);
        const next = sets[(sets.indexOf(CFG.GLYPH_SET) + 1) % sets.length];
        console.info('glyph set:', JSON.stringify(GPURenderer.setGlyphSet(next)));
      }
      if (e.code === 'KeyF') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
      // debug: hop into the cave system below, or back to the surface
      if (e.code === 'KeyG') {
        const h = World.groundZ(this.x, this.y);
        if (this.z < h - 1.5) {
          this.z = h;
        } else {
          let found = false;
          for (let z = -1.5; z > -35; z -= 0.3) {
            if (caveV(this.x, this.y, z, h) > 0) {
              const fz = World.walkZ(this.x, this.y, z);
              if (fz !== null) { this.z = fz; found = true; }
              break;
            }
          }
          if (!found) console.info('no cave below this spot');
        }
      }
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });

    const canvas = document.getElementById('screen');
    canvas.addEventListener('click', () => {
      if (Game.mode === 'myth') { Game.mode = 'title'; Game.uiDirty = true; return; }
      if (Game.mode === 'title') Game.close();
      canvas.requestPointerLock();
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    const locked = () => document.pointerLockElement === canvas;
    this.mouse = {};
    addEventListener('mousedown', e => { if (locked()) this.mouse[e.button] = true; });
    addEventListener('mouseup', e => { this.mouse[e.button] = false; });
    let skipEvents = 0;
    document.addEventListener('pointerlockchange', () => {
      skipEvents = 2;
      // The browser takes the pointer back on Escape and swallows the key
      // that did it, so the menu cannot rely on the keypress alone. Coming
      // up when the mouse is released is what a player expects regardless.
      if (!locked() && Game.mode === 'play') Game.openMenu();
    });
    addEventListener('mousemove', e => {
      if (!locked() || Game.mode !== 'play') return;
      if (skipEvents > 0) { skipEvents--; return; }
      const mx = clamp(e.movementX, -120, 120);
      const my = clamp(e.movementY, -120, 120);
      this.angle += mx * 0.0022;
      const LIM = Math.PI / 2 - 0.001;
      this.pitch = clamp(this.pitch - my * 0.0022, -LIM, LIM);
    });
  },

  // first solid point along the view ray within digging reach, or null
  aim() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.cos(this.angle) * cp, dy = Math.sin(this.angle) * cp;
    const ez = this.z + CFG.EYE;
    for (let t = 0.3; t <= CFG.DIG_REACH; t += 0.08) {
      const px = this.x + dx * t, py = this.y + dy * t, pz = ez + sp * t;
      if (solidD(px, py, pz) >= 0) return [px, py, pz, dx, dy, sp];
    }
    return null;
  },

  // What is under a point, and how much water is over it. The bed is the
  // density field's floor, so this reads the same on a hillside, a cave
  // floor and a lake bottom.
  footing(x, y, z) {
    const bed = World.walkZ(x, y, z);
    const gz = World.groundZ(x, y);
    const under = bed === null ? gz : bed;
    return { bed, gz, depth: gz < CFG.SEA_LEVEL ? CFG.SEA_LEVEL - under : 0 };
  },

  // Props stop you whatever you are doing: a trunk is a trunk whether you
  // are walking past it, swimming past it or falling past it.
  propsBlock(x, y) {
    const near = World.trunkNear(x, y, 1);
    if (near && near.dist < near.tree.trunkR + 0.22) return true;
    return !!World.rockNear(x, y);
  },

  blocked(x, y) {
    const h = World.groundZ(x, y);
    const underground = this.z < h - 1.5;

    // Afloat: the water is not an obstacle and there is no step to measure,
    // because you are not standing on anything. Only solid things stop you.
    if (this.swimming) {
      for (let dz = 0.1; dz <= 1.7; dz += 0.4) {
        if (solidD(x, y, this.z + dz) >= 0) return true;
      }
      return this.propsBlock(x, y);
    }

    // In the air: the drop is not an obstacle either, or you could not jump
    // a gap. Collide against solids at the height you are actually at.
    if (!this.onGround) {
      for (let dz = 0.1; dz <= 1.7; dz += 0.4) {
        if (solidD(x, y, this.z + dz) >= 0) return true;
      }
      return underground ? false : this.propsBlock(x, y);
    }

    // On foot: the old rules, minus the wall that water used to be. Water
    // you can stand up in is waded, and anything deeper is entered by
    // swimming rather than refused.
    const fz = World.walkZ(x, y, this.z);
    if (fz === null) return true;
    const deep = h < CFG.SEA_LEVEL && CFG.SEA_LEVEL - fz > CFG.WADE;
    if (!deep && Math.abs(fz - this.z) > CFG.STEP_UP) return true;
    // headroom: refuse pinched passages
    for (let dz = 0.5; dz <= 1.7; dz += 0.4) {
      if (solidD(x, y, fz + dz) >= 0) return true;
    }
    if (!underground && this.propsBlock(x, y)) return true;
    return false;
  },

  update(dt) {
    // frozen while a panel is open
    if (Game.mode !== 'play') { this.keys = {}; return; }
    const k = this.keys;
    const turn = 2.1 * dt;
    if (k['ArrowLeft']) this.angle -= turn;
    if (k['ArrowRight']) this.angle += turn;

    // where you are before anything moves: it decides how fast you go and
    // whether your feet are on anything
    const f0 = this.footing(this.x, this.y, this.z);
    this.swimming = f0.depth > CFG.WADE && this.z < CFG.SEA_LEVEL;

    const run = (k['ShiftLeft'] || k['ShiftRight']) ? 2.0 : 1.0;
    const drag = this.swimming ? CFG.SWIM_SPD
               : f0.depth > 0.25 ? CFG.WADE_SPD : 1.0;
    const spd = 4.2 * run * dt * drag;
    const dx = Math.cos(this.angle), dy = Math.sin(this.angle);

    let mx = 0, my = 0;
    if (k['KeyW'] || k['ArrowUp']) { mx += dx; my += dy; }
    if (k['KeyS'] || k['ArrowDown']) { mx -= dx; my -= dy; }
    if (k['KeyA']) { mx += dy; my -= dx; }
    if (k['KeyD']) { mx -= dy; my += dx; }

    const len = Math.hypot(mx, my);
    if (len > 0.001) {
      mx = mx / len * spd; my = my / len * spd;
      // axis-separated collision so we slide along obstacles
      if (!this.blocked(this.x + mx, this.y)) this.x += mx;
      if (!this.blocked(this.x, this.y + my)) this.y += my;
      Game.needSave = true;   // where you are is part of the save
    }
    // digging: LMB carves, RMB fills; fills never engulf the player
    this.digCd = Math.max(0, (this.digCd || 0) - dt);
    if ((this.mouse[0] || this.mouse[2]) && this.digCd <= 0) {
      const hit = this.aim();
      if (hit) {
        if (this.mouse[0]) {
          // what you are digging decides whether you can dig it at all
          const r = Game.digAt(hit[0], hit[1], hit[2]);
          if (r > 0) Edits.splat(hit[0], hit[1], hit[2], r, -100);
        } else {
          const digR = CFG.DIG_R;
          const fx = hit[0] - hit[3] * 0.6;
          const fy = hit[1] - hit[4] * 0.6;
          const fz = hit[2] - hit[5] * 0.6;
          const hd = Math.hypot(fx - this.x, fy - this.y);
          const overlap = hd < digR + 0.35 &&
            fz > this.z - digR && fz < this.z + 1.8 + digR;
          if (!overlap) Edits.splat(fx, fy, fz, digR, 100);
        }
        this.digCd = 0.15;
      }
    }

    this.vertical(dt, k);
  },

  // Up and down. Three regimes that never overlap: afloat, in the air, and
  // on foot. Only the last of them rides the floor, which is all the game
  // used to do.
  vertical(dt, k) {
    const f = this.footing(this.x, this.y, this.z);
    this.swimming = f.depth > CFG.WADE && this.z < CFG.SEA_LEVEL;

    if (this.swimming) {
      // You float. The body rides so the eye sits just clear of the
      // surface, which is also why there is no diving: below the water
      // plane the renderer has nothing to show you but sky.
      const ride = CFG.SEA_LEVEL + CFG.SWIM_EYE - CFG.EYE;
      this.z += (ride - this.z) * Math.min(1, dt * CFG.SWIM_RISE);
      this.vz = 0;
      this.onGround = false;
      return;
    }

    // A jump only leaves ground you are standing on. Treading water gives
    // nothing to push against.
    if (k['Space'] && this.onGround) {
      this.vz = CFG.JUMP;
      this.onGround = false;
    }

    if (this.onGround) {
      if (f.bed === null) { this.onGround = false; return; }
      this.z += (f.bed - this.z) * Math.min(1, dt * 10);
      // walked off the edge of something
      if (this.z - f.bed > 0.3) { this.onGround = false; this.vz = 0; }
      return;
    }

    this.vz -= CFG.GRAV * dt;
    this.z += this.vz * dt;
    // a ceiling stops a jump dead rather than letting it climb through
    if (this.vz > 0 && solidD(this.x, this.y, this.z + 1.7) >= 0) this.vz = 0;
    if (f.bed !== null && this.z <= f.bed) {
      this.z = f.bed;
      this.vz = 0;
      this.onGround = true;
    }
    // came down in deep water: the fall ends in a splash, not a landing
    if (!this.onGround && this.z < CFG.SEA_LEVEL && f.depth > CFG.WADE) {
      this.swimming = true;
      this.vz = 0;
    }
  },
};
