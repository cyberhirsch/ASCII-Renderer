// ASCII raycast renderer.
// Every visible sample reduces to (glyph, colorId, depth) in a character-cell
// framebuffer; one batched fillText pass per color-run draws the frame.
//
// Brightness pipeline (PRD 10b): shade() is the single composable stage —
// base * distanceFade today; sunlight and AO multiply in here later.
const Renderer = {
  ctx: null, cw: 0, chh: 0,
  chars: null, color: null, depth: null,
  palette: [], // colorId -> css string
  PAL_LEVELS: 8,

  // hue families: [r,g,b] at full brightness
  HUES: [
    [120, 235, 255],  // 0 neon cyan
    [255, 120, 235],  // 1 neon magenta
    [140, 150, 255],  // 2 blue
    [200, 130, 255],  // 3 purple
    [255, 190, 110],  // 4 amber
    [110, 230, 140],  // 5 green (trees)
    [190, 195, 205],  // 6 gray (streets, peds)
    [255, 225, 120],  // 7 yellow (lane marks)
    [255, 255, 255],  // 8 white
    [255, 110, 110],  // 9 red
    [150, 195, 255],  // 10 sky blue
  ],

  init() {
    const canvas = document.getElementById('screen');
    this.ctx = canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());

    // palette: hue x brightness level
    this.palette = [];
    for (let h = 0; h < this.HUES.length; h++) {
      const [r, g, b] = this.HUES[h];
      for (let l = 0; l < this.PAL_LEVELS; l++) {
        const f = (l + 1) / this.PAL_LEVELS;
        this.palette.push(`rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`);
      }
    }
    // dedicated sky gradient row: white at horizon -> blue at zenith.
    // written directly (not via colId) so it stays colored in mono mode.
    this.skyBase = this.palette.length;
    for (let l = 0; l < this.PAL_LEVELS; l++) {
      const f = l / (this.PAL_LEVELS - 1);
      const r = (245 + (80 - 245) * f) | 0;
      const g = (248 + (140 - 248) * f) | 0;
      const b = (255 + (235 - 255) * f) | 0;
      this.palette.push(`rgb(${r},${g},${b})`);
    }
  },

  // sky color by elevation 0 (horizon, white) .. 1 (zenith, blue)
  skyId(t) {
    return this.skyBase + clamp((t * this.PAL_LEVELS) | 0, 0, this.PAL_LEVELS - 1);
  },

  // fullscreen: derive the character grid from the window size
  resize() {
    const canvas = this.ctx.canvas;
    const font = `bold ${CFG.FONT_SIZE}px "Consolas", "Courier New", monospace`;
    this.ctx.font = font;
    this.cw = this.ctx.measureText('M').width;
    this.chh = CFG.FONT_SIZE + 1;
    CFG.COLS = Math.max(40, Math.floor(innerWidth / this.cw));
    CFG.ROWS = Math.max(24, Math.floor(innerHeight / this.chh));
    canvas.width = Math.ceil(CFG.COLS * this.cw);
    canvas.height = CFG.ROWS * this.chh;
    this.ctx.font = font; // size reset clears state
    this.ctx.textBaseline = 'top';
    const N = CFG.COLS * CFG.ROWS;
    this.chars = new Uint16Array(N);
    this.color = new Uint8Array(N);
    this.depth = new Float32Array(N);
  },

  colId(hue, brightness) {
    if (CFG.MONO) hue = 6; // uniform grayscale: brightness is the only signal
    const l = clamp((brightness * this.PAL_LEVELS) | 0, 0, this.PAL_LEVELS - 1);
    return hue * this.PAL_LEVELS + l;
  },

  // The composable brightness stage: base * lighting * distance fade.
  // Day fades toward haze (floor 0.22) instead of black.
  shade(base, dist) {
    const t = clamp(1 - dist / CFG.MAX_DIST, 0, 1);
    if (CFG.DAY) {
      // aerial perspective: blend toward bright haze with distance
      const hz = Math.pow(1 - t, 1.4);
      return base * (1 - hz) + 0.58 * hz;
    }
    return base * Math.pow(t, 1.5);
  },

  put(col, row, ch, colorId, d) {
    if (col < 0 || row < 0 || col >= CFG.COLS || row >= CFG.ROWS) return;
    const i = row * CFG.COLS + col;
    // write if empty, or strictly closer than what's there (lets content
    // show through the dither holes of transparent trees)
    if (this.depth[i] === Infinity || d < this.depth[i]) {
      this.chars[i] = ch.charCodeAt(0);
      this.color[i] = colorId;
      this.depth[i] = d;
    }
  },

  render(time) {
    const COLS = CFG.COLS, ROWS = CFG.ROWS;
    this.time = time;
    this.chars.fill(32);
    this.color.fill(0);
    this.depth.fill(Infinity);

    const horizon = (ROWS * 0.5 + Player.pitch) | 0; // may leave the screen: full freelook
    const dirX = Math.cos(Player.angle), dirY = Math.sin(Player.angle);
    const planeX = -dirY * CFG.PLANE_LEN, planeY = dirX * CFG.PLANE_LEN;
    const px = Player.x, py = Player.y;

    const WALL_LIT = '@#8&0%';           // lit window glyphs
    const WALL_DIM = ':;.|';             // unlit structure glyphs
    const TREE_CH = '%&#*oe';
    const GROUND_RAMP = ' ..,:;';

    for (let c = 0; c < COLS; c++) {
      const camX = 2 * c / COLS - 1;
      const rdx = dirX + planeX * camX;
      const rdy = dirY + planeY * camX;

      let mapX = Math.floor(px), mapY = Math.floor(py);
      const dDx = Math.abs(1 / (rdx || 1e-9)), dDy = Math.abs(1 / (rdy || 1e-9));
      let stepX, stepY, sideX, sideY;
      if (rdx < 0) { stepX = -1; sideX = (px - mapX) * dDx; }
      else { stepX = 1; sideX = (mapX + 1 - px) * dDx; }
      if (rdy < 0) { stepY = -1; sideY = (py - mapY) * dDy; }
      else { stepY = 1; sideY = (mapY + 1 - py) * dDy; }

      let clipTop = ROWS;       // rows >= this are already covered by nearer walls
      let firstSolid = Infinity;
      let side = 0;

      while (true) {
        if (sideX < sideY) { sideX += dDx; mapX += stepX; side = 0; }
        else { sideY += dDy; mapY += stepY; side = 1; }

        const dist = side === 0
          ? sideX - dDx
          : sideY - dDy;
        if (dist > CFG.MAX_DIST) break;
        if (!World.inBounds(mapX, mapY)) break;

        const i = World.idx(mapX, mapY);
        const t = World.type[i];
        if (t !== T_BLDG && t !== T_TREE) continue;

        const d = Math.max(dist, 0.05);
        const h = World.height[i];
        const yBot = horizon + CFG.Y_SCALE * CFG.EYE / d;
        const yTop = horizon - CFG.Y_SCALE * (h - CFG.EYE) / d;

        // fractional hit position along the wall face (window u-coordinate)
        let wallU = side === 0 ? py + d * rdy : px + d * rdx;
        wallU -= Math.floor(wallU);

        if (t === T_TREE) {
          // transparent foliage: dithered, does not advance the clip
          const r0 = Math.max(Math.ceil(yTop), 0);
          const r1 = Math.min(Math.floor(yBot), clipTop - 1, ROWS - 1);
          for (let r = r0; r <= r1; r++) {
            const wz = (yBot - r) / (yBot - yTop) * h; // world height at this row
            const isTrunk = wz < 0.7;
            const cover = isTrunk ? (wallU > 0.35 && wallU < 0.65 ? 1 : 0)
              : hash3(mapX * 7 + c, r, 991) < 0.52 ? 1 : 0;
            if (!cover) continue;
            let base = isTrunk ? 0.35 : 0.5 + hash3(c, r, 5) * 0.4;
            if (CFG.DAY) base = (isTrunk ? 0.45 : 0.75 + hash3(c, r, 5) * 0.25)
              * Light.traceSun(px + d * rdx, py + d * rdy, wz);
            const b = this.shade(base, d);
            const ch = isTrunk ? '|' : TREE_CH[(hash3(mapX, r, mapY) * TREE_CH.length) | 0];
            this.put(c, r, ch, this.colId(isTrunk ? 4 : 5, b), d);
          }
          continue;
        }

        // building wall
        if (firstSolid === Infinity) firstSolid = d;
        const r0 = Math.max(Math.ceil(yTop), 0);
        const r1 = Math.min(Math.floor(yBot), clipTop - 1, ROWS - 1);
        const hue = World.bcol[i] % 5;
        const bs = World.bseed[i];
        const sideDim = side === 1 ? 0.75 : 1.0;
        // face normal + the air cell in front of the face (sun/AO sample point)
        const nX = side === 0 ? -stepX : 0, nY = side === 1 ? -stepY : 0;
        const airX = side === 0 ? mapX - stepX : mapX;
        const airY = side === 1 ? mapY - stepY : mapY;
        // exact wall hit point, nudged into the air cell so the shadow ray
        // doesn't immediately hit the wall's own building
        const hitX = px + d * rdx + nX * 0.02, hitY = py + d * rdy + nY * 0.02;
        const faceLight = CFG.DAY
          ? 0.7 + 0.3 * Math.max(0, nX * Light.sunX + nY * Light.sunY) : 1;
        const litP = CFG.DAY ? 0.05 : 0.30; // few lit windows in daylight

        for (let r = r0; r <= r1; r++) {
          const wz = (yBot - r) / (yBot - yTop) * h;
          const winX = (wallU * 2) | 0;               // 2 window columns per face
          const winY = wz | 0;                        // 1 window row per world unit
          const edge = wallU < 0.06 || wallU > 0.94;
          const topEdge = r === r0 && yTop >= 0;
          const lit = hash3(mapX * 2 + winX, winY, bs) < litP;

          let ch, base;
          if (topEdge) { ch = '='; base = CFG.DAY ? 0.85 : 0.55; }
          else if (edge) { ch = '|'; base = CFG.DAY ? 0.50 : 0.30; }
          else if (CFG.FLAT) { ch = '#'; base = CFG.DAY ? 0.75 : 0.30; }
          else if (lit) {
            ch = WALL_LIT[(hash3(mapX + winX, winY, bs ^ 3) * WALL_LIT.length) | 0];
            // subtle per-window flicker, stepped at ~3Hz so it reads as data noise
            const flick = 0.8 + 0.25 * hash3(mapX + winX, winY, ((this.time * 3) | 0) ^ bs);
            base = 0.85 * flick;
          } else {
            ch = WALL_DIM[(hash3(mapX + winX, winY + 7, bs) * WALL_DIM.length) | 0];
            base = CFG.DAY ? 0.80 : 0.22;
          }
          let b;
          if (CFG.DAY && !lit) {
            const sunV = Light.traceSun(hitX, hitY, wz);
            b = this.shade(base * faceLight * sunV
              * Light.aoLerp(airX, airY, wz), d) * sideDim;
            if (sunV === 1) {
              // specular: reflect sun about the wall normal, dot with view dir
              const ndl = nX * Light.lx + nY * Light.ly;
              const rx = 2 * ndl * nX - Light.lx, ry = 2 * ndl * nY - Light.ly, rz = -Light.lz;
              let vx = -rdx * d, vy = -rdy * d, vz = CFG.EYE - wz;
              const iv = 1 / Math.hypot(vx, vy, vz);
              const spec = Math.max(0, (rx * vx + ry * vy + rz * vz) * iv);
              b += Math.pow(spec, 12) * 0.55;
            }
          } else {
            b = this.shade(base, d) * sideDim;
          }
          // daylight desaturates buildings to concrete gray; neon is for night.
          // far surfaces tint toward the sky for aerial perspective.
          const hz = CFG.DAY && d / CFG.MAX_DIST > 0.62;
          this.put(c, r, ch, this.colId(hz ? 10 : CFG.DAY ? 6 : hue, b), d);
        }

        clipTop = Math.min(clipTop, Math.max(r0, 0));
        if (clipTop <= 0) break;
      }

      // floor: from screen bottom up until the first solid wall starts
      for (let r = ROWS - 1; r > horizon; r--) {
        const rowDist = CFG.Y_SCALE * CFG.EYE / (r - horizon);
        if (rowDist >= firstSolid || rowDist > CFG.MAX_DIST) break;
        const i = r * COLS + c;
        if (this.depth[i] !== Infinity && this.depth[i] < rowDist) continue;
        const fx = px + rdx * rowDist, fy = py + rdy * rowDist;
        const cxi = Math.floor(fx), cyi = Math.floor(fy);
        if (!World.inBounds(cxi, cyi)) continue;
        const wi = World.idx(cxi, cyi);
        const t = World.type[wi], f = World.flags[wi];

        let ch, hue, base;
        if (t === T_ROAD) {
          if (f & F_LANE) {
            ch = (f & F_ROAD_H) && !(f & F_ROAD_V) ? '-' : '|';
            hue = 7; base = CFG.DAY ? 0.75 : 0.6;
          } else {
            ch = GROUND_RAMP[(hash3(cxi * 3, cyi * 3, 17) * GROUND_RAMP.length) | 0];
            hue = 6; base = CFG.DAY ? 0.55 : 0.20;
          }
        } else if (t === T_WALK) {
          ch = hash3(cxi, cyi, 31) < 0.5 ? '.' : ',';
          hue = 6; base = CFG.DAY ? 0.72 : 0.34;
        } else { // grass / plaza
          ch = hash3(cxi, cyi, 41) < 0.5 ? '"' : ',';
          hue = 5; base = CFG.DAY ? 0.68 : 0.25;
        }
        let b;
        if (CFG.DAY) {
          const sunV = Light.traceSun(fx, fy, 0.05);
          b = this.shade(base * sunV * Light.ao[wi], rowDist);
          if (sunV === 1) {
            // ground specular: sun mirrored about the up normal
            let vx = -rdx * rowDist, vy = -rdy * rowDist, vz = CFG.EYE;
            const iv = 1 / Math.hypot(vx, vy, vz);
            const spec = Math.max(0,
              (-Light.lx * vx - Light.ly * vy + Light.lz * vz) * iv);
            b += Math.pow(spec, 24) * 0.5;
          }
        } else {
          b = this.shade(base, rowDist);
        }
        this.put(c, r, ch, this.colId(hue, b), rowDist);
      }
    }

    this.renderSprites(dirX, dirY, planeX, planeY, horizon);
    this.renderSky(horizon);
    this.blit();
  },

  renderSprites(dirX, dirY, planeX, planeY, horizon) {
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const all = [];
    for (const c of Entities.cars) all.push({ e: c, kind: 0 });
    for (const p of Entities.peds) all.push({ e: p, kind: 1 });

    // camera-space transform + far-to-near sort
    for (const s of all) {
      const relX = s.e.x - Player.x, relY = s.e.y - Player.y;
      s.tx = invDet * (dirY * relX - dirX * relY);
      s.tz = invDet * (-planeY * relX + planeX * relY);
    }
    all.sort((a, b) => b.tz - a.tz);

    for (const s of all) {
      if (s.tz < 0.3 || s.tz > CFG.MAX_DIST) continue;
      const screenC = (CFG.COLS / 2) * (1 + s.tx / s.tz);
      const colsPerUnit = (CFG.COLS / 2) / (s.tz * CFG.PLANE_LEN);
      const rowsPerUnit = CFG.Y_SCALE / s.tz;
      const yBot = horizon + rowsPerUnit * CFG.EYE;
      const gl = CFG.DAY ? Light.groundLight(s.e.x, s.e.y) : 1;

      if (s.kind === 0) { // car
        const wC = Math.max(1, (1.5 * colsPerUnit) | 0);
        const hR = Math.max(1, (0.9 * rowsPerUnit) | 0);
        const hue = s.e.col % 5;
        for (let rr = 0; rr < hR; rr++) for (let cc = 0; cc < wC; cc++) {
          const col = (screenC - wC / 2 + cc) | 0;
          const row = (yBot - rr) | 0;
          const topRow = rr === hR - 1 && hR > 1;
          const b = this.shade((topRow ? 0.5 : 0.8) * gl, s.tz);
          this.put(col, row, topRow ? 'o' : '#', this.colId(hue, b), s.tz);
        }
      } else { // pedestrian
        const hR = Math.max(1, (1.7 * rowsPerUnit) | 0);
        const col = screenC | 0;
        for (let rr = 0; rr < hR; rr++) {
          const row = (yBot - rr) | 0;
          const head = rr === hR - 1 && hR > 1;
          const b = this.shade((CFG.DAY ? 0.85 : 0.6) * s.e.shade * gl, s.tz);
          this.put(col, row, head ? 'o' : 'i', this.colId(6, b), s.tz);
        }
      }
    }
  },

  renderSky(horizon) {
    if (CFG.DAY) {
      // dithered blue gradient, sun disc at the sun azimuth, haze below horizon
      let aDiff = CFG.SUN_AZ - Player.angle;
      aDiff = ((aDiff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const sunCol = Math.abs(aDiff) < 1.1
        ? ((CFG.COLS / 2) * (1 + Math.tan(aDiff) / CFG.PLANE_LEN)) | 0 : -9999;
      // sun sits above the neutral horizon by ~half a screen: hidden at level
      // view, revealed by a modest look-up regardless of window size
      const sunRow = (horizon - CFG.ROWS * 0.55) | 0;
      const SKY_RAMP = '=::;;';
      for (let r = 0; r < CFG.ROWS; r++) {
        for (let c = 0; c < CFG.COLS; c++) {
          const i = r * CFG.COLS + c;
          if (this.depth[i] !== Infinity) continue;
          if (r < horizon) {
            // spherical gradient: elevation angle above the horizon drives
            // the white->blue blend (atan compresses a white band at horizon)
            const elev = Math.atan2(horizon - r, CFG.Y_SCALE) / (Math.PI / 2);
            const dSun = Math.hypot(c - sunCol, (r - sunRow) * 1.9);
            if (dSun < 3.2) { this.chars[i] = 64; this.color[i] = this.skyId(0); }   // '@' sun disc
            else if (dSun < 6.0) { this.chars[i] = 111; this.color[i] = this.skyId(0.1); } // 'o' halo
            else {
              const ch = SKY_RAMP[clamp((elev * 1.6 * SKY_RAMP.length) | 0, 0, SKY_RAMP.length - 1)];
              const dither = hash3(c, r, 555) * 0.08;
              // sun glare whitens the gradient locally
              const glow = clamp(1 - dSun / 18, 0, 1) * 0.6;
              this.chars[i] = ch.charCodeAt(0);
              this.color[i] = this.skyId(clamp(elev * 1.35 + dither - glow, 0, 1));
            }
          } else { // below horizon, beyond MAX_DIST: haze matches the horizon white
            this.chars[i] = 44; this.color[i] = this.skyId(0.05);                     // ','
          }
        }
      }
      return;
    }
    // night: sparse starfield with parallax on camera angle
    const angOff = (Player.angle * CFG.COLS / (2 * Math.PI) * 3) | 0;
    const skyEnd = Math.min(horizon + 2, CFG.ROWS);
    for (let r = 0; r < skyEnd; r++) {
      for (let c = 0; c < CFG.COLS; c++) {
        const i = r * CFG.COLS + c;
        if (this.depth[i] !== Infinity) continue;
        const h = hash3(((c + angOff) % 1024 + 1024) % 1024, r, 777);
        if (h < 0.012) { this.chars[i] = 46; this.color[i] = this.colId(2, 0.3); }       // '.'
        else if (h < 0.016) { this.chars[i] = 42; this.color[i] = this.colId(8, 0.25); } // '*'
      }
    }
  },

  blit() {
    const ctx = this.ctx, COLS = CFG.COLS, ROWS = CFG.ROWS;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // draw runs of same color per row as single strings (monospace advance)
    for (let r = 0; r < ROWS; r++) {
      let runStart = 0, runColor = -1, runStr = '';
      const base = r * COLS;
      for (let c = 0; c <= COLS; c++) {
        const ch = c < COLS ? this.chars[base + c] : 32;
        const col = c < COLS ? this.color[base + c] : -1;
        const isSpace = ch === 32;
        const cur = isSpace ? -2 : col;
        if (cur !== runColor) {
          if (runColor >= 0 && runStr.length) {
            const color = this.palette[runColor];
            ctx.fillStyle = color;
            // bloom: bright palette levels glow
            if (runColor < this.skyBase && (runColor % this.PAL_LEVELS) >= 6) {
              ctx.shadowColor = color;
              ctx.shadowBlur = 7;
            } else {
              ctx.shadowBlur = 0;
            }
            ctx.fillText(runStr, runStart * this.cw, r * this.chh);
          }
          runColor = cur; runStart = c; runStr = '';
        }
        if (!isSpace && c < COLS) runStr += String.fromCharCode(ch);
        else if (runColor >= 0) runStr += ' ';
      }
    }
    ctx.shadowBlur = 0;
  },
};
