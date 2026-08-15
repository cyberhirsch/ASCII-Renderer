// Ambient traffic: cars follow the road lattice, pedestrians wander sidewalks.
const Entities = {
  cars: [], peds: [],

  init(seed) {
    const rng = mulberry32(seed ^ 0xC0FFEE);
    this.cars = []; this.peds = [];

    const roadCells = [], walkCells = [];
    for (let y = 0; y < CFG.WORLD; y++) for (let x = 0; x < CFG.WORLD; x++) {
      const t = World.type[World.idx(x, y)];
      if (t === T_ROAD) roadCells.push([x, y]);
      else if (t === T_WALK) walkCells.push([x, y]);
    }

    for (let i = 0; i < CFG.CAR_COUNT && roadCells.length; i++) {
      const [x, y] = roadCells[(rng() * roadCells.length) | 0];
      const f = World.flags[World.idx(x, y)];
      let dx = 0, dy = 0;
      if (f & F_ROAD_V) { dy = rng() < 0.5 ? 1 : -1; }
      else { dx = rng() < 0.5 ? 1 : -1; }
      this.cars.push({
        x: x + 0.5, y: y + 0.5, dx, dy,
        speed: 2.2 + rng() * 1.8,
        col: (rng() * 5) | 0,
      });
    }

    for (let i = 0; i < CFG.PED_COUNT && walkCells.length; i++) {
      const [x, y] = walkCells[(rng() * walkCells.length) | 0];
      this.peds.push({
        x: x + 0.5, y: y + 0.5, tx: x + 0.5, ty: y + 0.5,
        speed: 0.6 + rng() * 0.6,
        shade: 0.55 + rng() * 0.45,
      });
    }
  },

  update(dt, time) {
    for (const c of this.cars) {
      const nx = c.x + c.dx * c.speed * dt;
      const ny = c.y + c.dy * c.speed * dt;
      const cellAhead = World.cellType(
        Math.floor(nx + c.dx * 0.6), Math.floor(ny + c.dy * 0.6));
      if (cellAhead === T_ROAD) { c.x = nx; c.y = ny; }
      else {
        // pick a new road direction from the current cell
        const cx = Math.floor(c.x), cy = Math.floor(c.y);
        const opts = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (dx === -c.dx && dy === -c.dy) continue; // no U-turn unless stuck
          if (World.cellType(cx + dx * 2, cy + dy * 2) === T_ROAD) opts.push([dx, dy]);
        }
        if (opts.length === 0) { c.dx = -c.dx; c.dy = -c.dy; }
        else {
          const pick = opts[(hash3(cx, cy, (time * 997) | 0) * opts.length) | 0];
          c.dx = pick[0]; c.dy = pick[1];
          c.x = cx + 0.5; c.y = cy + 0.5;
        }
      }
    }

    for (const p of this.peds) {
      const ddx = p.tx - p.x, ddy = p.ty - p.y;
      const d = Math.hypot(ddx, ddy);
      if (d < 0.08) {
        // choose a new adjacent sidewalk cell
        const cx = Math.floor(p.x), cy = Math.floor(p.y);
        const opts = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (World.cellType(cx + dx, cy + dy) === T_WALK) opts.push([dx, dy]);
        if (opts.length) {
          const pick = opts[(hash3(cx, cy, ((time * 613) | 0) ^ 0x99) * opts.length) | 0];
          p.tx = cx + pick[0] + 0.5; p.ty = cy + pick[1] + 0.5;
        }
      } else {
        p.x += (ddx / d) * p.speed * dt;
        p.y += (ddy / d) * p.speed * dt;
      }
    }
  },
};
