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
        if (typeof Removed !== 'undefined' && Removed.has(cx + ox, cy + oy)) continue;
        const d = Math.hypot(tr.cx - x, tr.cy - y);
        if (d < bestD) { bestD = d; best = tr; }
      }
    }
    return best && { tree: best, dist: bestD };
  },

  // Classify what the view ray meets within examine reach. Returns
  // { kind, point, ... } or null. Trees are tested analytically against the
  // hash-placed set; everything solid is classified by asking the same
  // field functions the renderer draws with.
  examineRay(ex, ey, ez, dx, dy, dz) {
    for (let t = 0.4; t < 4.5; t += 0.07) {
      const px = ex + dx * t, py = ey + dy * t, pz = ez + dz * t;
      // trees: trunk cylinder or canopy sphere in nearby cells
      const cx = Math.floor(px), cy = Math.floor(py);
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const tr = treeAt(cx + ox, cy + oy);
          if (!tr) continue;
          if (typeof Removed !== 'undefined' && Removed.has(cx + ox, cy + oy)) continue;
          const g = terrainH(tr.cx, tr.cy);
          const d2 = (px - tr.cx) ** 2 + (py - tr.cy) ** 2;
          const canZ = g + tr.trunkH + tr.r * 0.55;
          const inTrunk = d2 < (tr.trunkR + 0.15) ** 2 &&
                          pz > g && pz < g + tr.trunkH;
          const inCanopy = d2 + (pz - canZ) ** 2 < tr.r * tr.r;
          if (inTrunk || inCanopy) {
            return { kind: 'tree', ix: cx + ox, iy: cy + oy, tree: tr,
                     point: [px, py, pz] };
          }
        }
      }
      // open water
      if (pz < CFG.SEA_LEVEL && terrainH(px, py) < CFG.SEA_LEVEL) {
        return { kind: 'water', point: [px, py, pz] };
      }
      if (solidD(px, py, pz) >= 0) return this.classifySolid(px, py, pz);
    }
    return null;
  },

  classifySolid(px, py, pz) {
    const gz = terrainH(px, py);
    const p = [px, py, pz];
    // every solid carries its material: it decides the tool, the yield,
    // and what the examine panel is allowed to offer
    const mat = matAt(px, py, pz, gz);
    if (typeof Edits !== 'undefined' && Edits.bounds &&
        Math.abs(Edits.sample(px, py, pz)) > 0.05) {
      return { kind: 'dug', point: p, mat };
    }
    const hv = hallV(px, py, pz, gz);
    if (hv[1] > -0.3) {
      // inside a hall's protected solids; a pillar is still solid overhead
      const up = hallV(px, py, pz + 0.8, gz);
      return { kind: up[1] > -0.3 ? 'pillar' : 'hallfloor', point: p, mat };
    }
    const sv = shaftV(px, py, pz, gz);
    if (sv[0] > -0.5 || sv[1] > -0.3) return { kind: 'stair', point: p, mat };
    if (pz < gz - 1.0) {
      // ore and gems outrank the lichen growing over them
      if (mat === MATS.GEM) return { kind: 'gem', point: p, mat };
      if (mat === MATS.ORE) return { kind: 'ore', point: p, mat };
      if (vnoise(px * 1.9, py * 1.9, pz * 1.9) > 0.8) {
        return { kind: 'lichen', point: p, mat };
      }
      return { kind: 'cavewall', point: p, mat };
    }
    if (gz < CFG.SEA_LEVEL + 0.55) return { kind: 'sand', point: p, mat };
    // soil depth decides meadow vs bare rock - the same function the shader
    // shades with and the shovel checks, so all three agree
    return { kind: mat === MATS.DIRT ? 'grass' : 'rock', point: p, mat };
  },

  // Spawn beside a cave entrance when one exists nearby: scan shaft
  // placement cells ring by ring from the origin, then stand on dry, gentle
  // ground at the rim of the first entrance found.
  findSpawn() {
    for (let ring = 0; ring < 40; ring++) {
      for (let cy = -ring; cy <= ring; cy++) {
        for (let cx = -ring; cx <= ring; cx++) {
          if (Math.max(Math.abs(cx), Math.abs(cy)) !== ring) continue;
          const a = shaftAt(cx, cy, 0);
          if (!a) continue;
          for (let ang = 0; ang < Math.PI * 2; ang += 0.4) {
            const x = a.ax + Math.cos(ang) * (CAVES.SHAFT_R + 2.0);
            const y = a.ay + Math.sin(ang) * (CAVES.SHAFT_R + 2.0);
            const h = terrainH(x, y);
            if (h < CFG.SEA_LEVEL + 0.6) continue;
            // the entry apron ledge sits 0.45 below the mouth; spawn where
            // stepping onto it is a legal move
            if (Math.abs(h - (a.zTop - 0.45)) > 1.0) continue;
            // gentle ground: sample slope
            const s = Math.abs(terrainH(x + 1, y) - h) +
                      Math.abs(terrainH(x, y + 1) - h);
            if (s < 0.8) return [x, y];
          }
        }
      }
    }
    // fallback: any dry, gentle ground, spiralling out from the origin
    for (let r = 0; r < 400; r += 3) {
      for (let a = 0; a < Math.PI * 2; a += 0.7) {
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        const h = terrainH(x, y);
        if (h < CFG.SEA_LEVEL + 0.6) continue;
        const s = Math.abs(terrainH(x + 1, y) - h) + Math.abs(terrainH(x, y + 1) - h);
        if (s < 0.8) return [x, y];
      }
    }
    return [0, 0];
  },
};
