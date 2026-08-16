// First-person player: WASD move, arrows/mouse turn, collision vs solid cells.
const Player = {
  x: 0, y: 0, angle: 0.6,
  pitch: 0, // vertical look, radians; ±90° is straight up/down
  keys: {},

  init() {
    const [sx, sy] = World.findSpawn();
    this.x = sx; this.y = sy;

    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyM') CFG.MONO = !CFG.MONO;
      if (e.code === 'KeyF') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });

    const canvas = document.getElementById('screen');
    canvas.addEventListener('click', () => canvas.requestPointerLock());
    const locked = () => document.pointerLockElement === canvas;
    // browsers can fire one huge bogus movement delta when pointer lock
    // engages or the cursor re-syncs; skip the first events and clamp the rest
    let skipEvents = 0;
    document.addEventListener('pointerlockchange', () => { skipEvents = 2; });
    addEventListener('mousemove', e => {
      if (!locked()) return;
      if (skipEvents > 0) { skipEvents--; return; }
      const mx = clamp(e.movementX, -120, 120);
      const my = clamp(e.movementY, -120, 120);
      this.angle += mx * 0.0022;
      // real camera pitch. Full range: straight up to straight down. It stops
      // a hair short of the poles, where the camera basis would degenerate.
      const LIM = Math.PI / 2 - 0.001;
      this.pitch = clamp(this.pitch - my * 0.0022, -LIM, LIM);
    });
  },

  blocked(x, y) {
    const R = 0.22;
    for (const [ox, oy] of [[-R, -R], [R, -R], [-R, R], [R, R]])
      if (World.isSolid(Math.floor(x + ox), Math.floor(y + oy))) return true;
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
      // axis-separated collision so we slide along walls
      if (!this.blocked(this.x + mx, this.y)) this.x += mx;
      if (!this.blocked(this.x, this.y + my)) this.y += my;
    }
  },
};
