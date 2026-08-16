// First-person player over the infinite terrain: WASD move, arrows/mouse
// look, slope- and water-limited movement, trunk-circle tree collision.
const Player = {
  x: 0, y: 0, z: 0, angle: 0.6,
  pitch: 0, // radians; ±90° is straight up/down
  keys: {},

  init() {
    const [sx, sy] = World.findSpawn();
    this.x = sx; this.y = sy;
    this.z = World.groundZ(sx, sy);

    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyM') CFG.MONO = !CFG.MONO;
      if (e.code === 'KeyX') CFG.RAW = !CFG.RAW;
      if (e.code === 'KeyC' && GPURenderer.ok) {
        const sets = Object.keys(GlyphAtlas.SETS);
        const next = sets[(sets.indexOf(CFG.GLYPH_SET) + 1) % sets.length];
        console.info('glyph set:', JSON.stringify(GPURenderer.setGlyphSet(next)));
      }
      if (e.code === 'KeyF') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });

    const canvas = document.getElementById('screen');
    canvas.addEventListener('click', () => canvas.requestPointerLock());
    const locked = () => document.pointerLockElement === canvas;
    let skipEvents = 0;
    document.addEventListener('pointerlockchange', () => { skipEvents = 2; });
    addEventListener('mousemove', e => {
      if (!locked()) return;
      if (skipEvents > 0) { skipEvents--; return; }
      const mx = clamp(e.movementX, -120, 120);
      const my = clamp(e.movementY, -120, 120);
      this.angle += mx * 0.0022;
      const LIM = Math.PI / 2 - 0.001;
      this.pitch = clamp(this.pitch - my * 0.0022, -LIM, LIM);
    });
  },

  blocked(x, y) {
    // water and steep terrain
    const h = World.groundZ(x, y);
    if (h < CFG.SEA_LEVEL + 0.05) return true;
    if (Math.abs(h - this.z) > 1.0) return true;
    // tree trunks: circle test against nearby hash-placed trees
    const near = World.trunkNear(x, y, 1);
    if (near && near.dist < near.tree.trunkR + 0.22) return true;
    return false;
  },

  update(dt) {
    const k = this.keys;
    const turn = 2.1 * dt;
    if (k['ArrowLeft']) this.angle -= turn;
    if (k['ArrowRight']) this.angle += turn;

    const run = (k['ShiftLeft'] || k['ShiftRight']) ? 2.0 : 1.0;
    const spd = 4.2 * run * dt;
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
    }
    // ride the terrain, smoothed
    const gz = World.groundZ(this.x, this.y);
    this.z += (gz - this.z) * Math.min(1, dt * 10);
  },
};
