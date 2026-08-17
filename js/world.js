// World queries over the infinite procedural terrain. The heavy lifting —
// heightfield and tree placement — lives in js/util.js as bit-compatible
// mirrors of the shader; this module is the gameplay-facing API on top.
// Authored sites (ruins, lore) will register here in a later phase.
const World = {
  groundZ(x, y) { return terrainH(x, y); },

  isWater(x, y) { return terrainH(x, y) < CFG.SEA_LEVEL; },

  // Walkable floor at (x, y) near zRef: march the density field down from
  // just above head height to the first solid, then refine the boundary.
  // One code path covers open terrain, cave floors, entrance ramps, and
  // (later) dug pits. Returns null when there is no standable floor within
  // a step of zRef - callers treat that as blocked.
  walkZ(x, y, zRef) {
    let z = zRef + 1.4;
    // a start inside rock means a wall taller than a legal step: descend to
    // air first, give up quickly if there is none
    let guard = 0;
    while (solidD(x, y, z) >= 0) {
      z -= 0.15;
      if (++guard > 12) return null;
    }
    const zMin = zRef - 4.0;
    let prev = z;
    while (z > zMin) {
      z -= 0.15;
      if (solidD(x, y, z) >= 0) {
        let a = z, b = prev;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          if (solidD(x, y, m) >= 0) a = m; else b = m;
        }
        return (a + b) / 2;
      }
      prev = z;
    }
    return null;
  },

  // nearest tree trunk within `reach` cells of (x, y), or null
  trunkNear(x, y, reach) {
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = null, bestD = Infinity;
    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const tr = treeAt(cx + ox, cy + oy);
        if (!tr) continue;
        const d = Math.hypot(tr.cx - x, tr.cy - y);
        if (d < bestD) { bestD = d; best = tr; }
      }
    }
    return best && { tree: best, dist: bestD };
  },

  // spiral out from the origin for dry, walkable ground
  findSpawn() {
    for (let r = 0; r < 400; r += 3) {
      for (let a = 0; a < Math.PI * 2; a += 0.7) {
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        const h = terrainH(x, y);
        if (h < CFG.SEA_LEVEL + 0.6) continue;
        // gentle ground: sample slope
        const s = Math.abs(terrainH(x + 1, y) - h) + Math.abs(terrainH(x, y + 1) - h);
        if (s < 0.8) return [x, y];
      }
    }
    return [0, 0];
  },
};
