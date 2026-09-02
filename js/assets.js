// The asset catalogue: everything that stands on this ground, written as
// geometry rather than stored as one.
//
// Nothing here is a mesh. A building is a function of (kind, seed, decay)
// that returns a list of analytic primitives - boxes, cylinders, cones,
// convex bodies, faceted stones - which are exactly the shapes the shader
// already knows how to intersect. That is the whole point: what the viewer
// draws is not a preview of an asset, it IS the asset, and the same parts
// list can be handed to the renderer without anything being baked.
//
// The decay model and the vocabulary are the chronicle's, not new ones. A
// site has a kind (hold, farm, mine), a people with a material (timber or
// stone) and a metal, an abandonment year and a cause. Those five facts
// decide what stands here and how much of it is left, so a ruin in the
// world is the residue of something the sim actually did.
//
// Pure CPU, no DOM, no storage. Deterministic in (kind, seed): two runs
// agree part for part.

const ASSET = {
  // Decay runs 0 (as built) to 1 (a rectangle of stones in the grass).
  // The stage boundaries are named the way the chronicle names an
  // artifact's condition, because a reader should not have to learn two
  // vocabularies for the same idea.
  STAGES: [
    [0.00, 'standing'],   // roofed, whole, somebody lives here
    [0.18, 'weathered'],  // thatch thin, timber silvered, nobody sweeping
    [0.38, 'roofless'],   // the roof is the first thing to go, always
    [0.62, 'ruined'],     // walls broken to knee and shoulder, rubble skirt
    [0.86, 'footings'],   // a plan in the grass; a tell if the soil took it
  ],
  // Years for a material to lose roughly two thirds of itself once nobody
  // is maintaining it. Thatch goes in a decade, drystone essentially never
  // does - which is why a ruined timber farm is a scatter of postholes and
  // a ruined stone hold is still a wall you can lean on. Same shape as the
  // chronicle's KEEPS table, applied to buildings instead of objects.
  LASTS: {
    thatch: 30, turf: 60, timber: 120, daub: 90, char: 400,
    drystone: 2600, stone: 2000, cutstone: 3000, soil: 1e9,
    iron: 700, bronze: 2400, copper: 1900, gold: 1e9, bone: 800,
    ash: 1e9, water: 1e9, moss: 1e9, brick: 1400,
  },
  // What a cause does to a place, beyond ageing it. `burn` chars the
  // timber and takes the roof early; `spill` is how much of what they
  // owned is still lying about, because people who ran left more behind
  // than people who packed; `throw` is how far the rubble travels.
  CAUSES: {
    left:    { burn: 0.0, spill: 0.10, throw: 1.0, note: 'walked away from' },
    sacked:  { burn: 0.9, spill: 0.75, throw: 1.9, note: 'taken and burnt' },
    plague:  { burn: 0.2, spill: 0.60, throw: 1.0, note: 'emptied by sickness' },
    flood:   { burn: 0.0, spill: 0.45, throw: 1.3, note: 'drowned and silted' },
    famine:  { burn: 0.0, spill: 0.30, throw: 1.0, note: 'starved out' },
    'the deep': { burn: 0.1, spill: 0.80, throw: 1.2, note: 'lost to the deep' },
  },
  // Growth reclaiming the plan. Nothing grows on a floor somebody sweeps,
  // and by the time the walls are knee-high the place is a thicket.
  GREEN_FROM: 0.30,
  GREEN_MAX: 14,      // saplings and tussocks at full abandonment
  RUBBLE_MAX: 26,     // fallen stones a big ruin sheds
  // Where the centre of a faceted stone sits above the ground, as a share of
  // its radius. A facet is a bounding sphere with cuts taken out of it, and
  // every cut is at least PROPS.CUT_MIN of the radius out - so a stone whose
  // centre sits higher than CUT_MIN can have its whole underside cut away
  // and hang in the air. Below that it always makes contact, and a little
  // below reads as bedded, which is what the boulders in the game already do.
  SIT: 0.34,
  // How far a building goes into the ground as it is left. Soil does not
  // stay still: it washes off the slope above and blows in off the field,
  // and a floor swept level with the yard ends up a foot under it. This is
  // why a ruin is dug rather than walked into, and it is most of what makes
  // an old site read as old rather than as a broken new one.
  //
  // Deep enough to read as burial rather than as settling. A site out of
  // use for a thousand years is not a step down, it is a dig - and that
  // number can be honest now the section view exists to show the result.
  // What keeps the plan legible under it is not a shallow sink but a
  // footing course that does not decay; see the drystone curve in wallRun.
  SINK_MAX: 1.65,
};

// Albedo per material, in the same register as the shader's ground colours -
// nothing saturated, because the glyph ramp has 24 steps and colour has to
// survive being one of them.
const AMAT = {
  timber:   { c: [0.42, 0.31, 0.20], name: 'timber' },
  char:     { c: [0.13, 0.11, 0.10], name: 'burnt timber' },
  thatch:   { c: [0.56, 0.47, 0.28], name: 'thatch' },
  turf:     { c: [0.34, 0.46, 0.26], name: 'turf' },
  daub:     { c: [0.62, 0.57, 0.47], name: 'daub' },
  drystone: { c: [0.47, 0.46, 0.43], name: 'drystone' },
  stone:    { c: [0.44, 0.41, 0.38], name: 'stone' },
  cutstone: { c: [0.54, 0.52, 0.48], name: 'cut stone' },
  brick:    { c: [0.51, 0.34, 0.27], name: 'fired brick' },
  soil:     { c: [0.34, 0.28, 0.22], name: 'soil' },
  ash:      { c: [0.28, 0.27, 0.26], name: 'ash' },
  moss:     { c: [0.30, 0.42, 0.28], name: 'moss' },
  leaf:     { c: [0.40, 0.60, 0.32], name: 'leaf' },
  water:    { c: [0.18, 0.30, 0.40], name: 'water' },
  iron:     { c: [0.40, 0.40, 0.42], name: 'iron' },
  rust:     { c: [0.45, 0.28, 0.18], name: 'rusted iron' },
  bronze:   { c: [0.62, 0.46, 0.24], name: 'bronze' },
  copper:   { c: [0.40, 0.58, 0.48], name: 'weathered copper' },
  steel:    { c: [0.56, 0.58, 0.62], name: 'steel' },
  gold:     { c: [0.78, 0.65, 0.28], name: 'gold' },
  silver:   { c: [0.70, 0.72, 0.74], name: 'silver' },
  bone:     { c: [0.72, 0.70, 0.62], name: 'bone' },
  amber:    { c: [0.72, 0.48, 0.18], name: 'amber' },
  jet:      { c: [0.14, 0.13, 0.15], name: 'jet' },
  greenstone: { c: [0.36, 0.52, 0.40], name: 'greenstone' },
  shell:    { c: [0.76, 0.72, 0.66], name: 'shell' },
  gem:      { c: [0.55, 0.80, 0.95], name: 'gem', emit: 0.35 },
  ore:      { c: [0.62, 0.42, 0.30], name: 'ore' },
  lichen:   { c: [0.55, 0.75, 0.70], name: 'glow lichen', emit: 0.5 },
  glass:    { c: [0.60, 0.68, 0.70], name: 'glass' },
  // Not a material anything is made of: the figure that gives scale. Cool
  // and mid-bright, so it separates from every warm earth tone in the list
  // and reads as an instrument rather than as part of the building.
  mark:     { c: [0.44, 0.52, 0.62], name: 'scale figure' },
  // Not a material either: the discolouration a rotted object leaves in the
  // soil. Warm and pale against the ground, because on a dark field the
  // readable stain is the light one - a real one is usually darker than the
  // matrix around it, and here that would be a hole rather than a find.
  stain:    { c: [0.40, 0.33, 0.24], name: 'a stain in the soil' },
};

// -------- primitives --------
// Six shapes, chosen because the shader already traces five of them and the
// sixth (a convex body cut by planes) is the slab loop hitFaceted already
// runs, with the plane normals given instead of hashed. Adding geometry here
// costs the renderer a branch, not an intersector.

const Prim = {
  box(c, he, mat, q) { return { k: 'box', c, he, mat, q: q || null }; },
  cyl(c, r, z0, z1, mat, q) { return { k: 'cyl', c, r, z0, z1, mat, q: q || null }; },
  sph(c, r, mat) { return { k: 'sph', c, r, mat }; },
  // truncated cone: r0 at z0, r1 at z1. A spoil heap, a conical roof, a
  // tapering post and a kiln are all this shape with different numbers.
  cone(c, z0, z1, r0, r1, mat, q) {
    return { k: 'cone', c, z0, z1, r0, r1, mat, q: q || null };
  },
  // convex body as an intersection of half-spaces dot(n,p) <= d, in local
  // space about `c`. Gable roofs, wedges, revetments, broken wall stubs.
  conv(c, planes, mat, q) { return { k: 'conv', c, planes, mat, q: q || null }; },
  // a faceted stone: the boulder shape the game already draws, reused for
  // every piece of rubble so a ruin is made of the same rock as the hill
  facet(c, r, seed, mat) { return { k: 'facet', c, r, seed, mat: mat || 'drystone' }; },
};

// A beam from one point to another. Worth a function because the other way
// round - working out a centre, a length and two angles at every call site -
// is exactly how a rafter ends up horizontal and nobody notices until it is
// hanging in the air over a roof that has gone.
function beamDir(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  return { L, yaw: Math.atan2(d[1], d[0]),
           pitch: Math.atan2(Math.hypot(d[0], d[1]), d[2]) };
}

// square section
function beam(a, b, r, mat) {
  const d = beamDir(a, b);
  if (d.L < 1e-6) return null;
  return Prim.box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
                  [r, r, d.L / 2], mat, [d.yaw, d.pitch]);
}

// round section, anchored at the first point the way a cylinder is
function strut(a, b, r, mat) {
  const d = beamDir(a, b);
  if (d.L < 1e-6) return null;
  return Prim.cyl([a[0], a[1]], r, a[2], a[2] + d.L, mat, [d.yaw, d.pitch]);
}

// A gable roof over a rectangle: two slopes, two ends, a soffit. Written as
// planes so a half-collapsed roof is the same body with one slope removed.
function gable(cx, cy, cz, hx, hy, rise, mat, half) {
  // The pitch plane contains the ridge (0, 0, rise) and the eave (0, hy, 0),
  // so its normal is perpendicular to the edge between them - (0, rise, hy),
  // not (0, hy, rise). Getting that pair the wrong way round builds a roof
  // that is still convex, still closed, and the wrong shape.
  const s = Math.hypot(hy, rise);
  const planes = [
    { n: [0, 0, -1], d: 0 },              // the soffit
    { n: [1, 0, 0], d: hx }, { n: [-1, 0, 0], d: hx },
    { n: [0, rise / s, hy / s], d: hy * rise / s },
  ];
  // a roof that has lost one pitch keeps the other, which is what a
  // half-fallen house actually looks like from the gable end
  if (!half) planes.push({ n: [0, -rise / s, hy / s], d: hy * rise / s });
  else planes.push({ n: [0, -1, 0], d: 0 });
  return Prim.conv([cx, cy, cz], planes, mat);
}

// -------- decay --------

// Deterministic per-asset randomness. Every draw is keyed by the asset's
// name and an index, so adding a part to one building cannot shuffle the
// stones of another - which is what makes a viewer worth reviewing twice.
function arnd(key, i) {
  let h = (CFG.SEED ^ 0x9E37) >>> 0;
  for (let k = 0; k < key.length; k++) h = jsUhash(h, key.charCodeAt(k));
  return jsUhash(h, (i * 2654435761) >>> 0) / 4294967296;
}

// What fraction of a material is left after `years` untended. Exponential,
// same law the chronicle uses for what is in the ground, because it is the
// same physics: something is lost at a rate proportional to what is left.
function wear(mat, years) {
  return Math.exp(-years / (ASSET.LASTS[mat] || 1000));
}

// The word for a decay value, and the value for a word.
function stageOf(d) {
  let w = ASSET.STAGES[0][1];
  for (const [t, n] of ASSET.STAGES) if (d >= t) w = n;
  return w;
}

// A building's context: everything it needs to know about who built it and
// what happened to them. Defaults describe a timber farm nobody burnt.
function assetCtx(o) {
  o = o || {};
  const cause = o.cause && ASSET.CAUSES[o.cause] ? o.cause : 'left';
  const d = clamp(o.decay === undefined ? 0 : o.decay, 0, 1);
  return {
    key: o.key || 'asset',
    decay: d,
    stage: stageOf(d),
    cause,
    fx: ASSET.CAUSES[cause],
    // burnt timber is timber that has already had its fire; it survives
    // being weather far better than the wood it was, which is why a burnt
    // post is often the only post left standing
    wood: (d > 0.12 && ASSET.CAUSES[cause].burn > 0.5) ? 'char' : 'timber',
    mat: o.mat === 'stone' ? 'stone' : 'timber',
    metal: o.metal || 'copper',
    rnd(i) { return arnd(this.key, i); },
  };
}

// -------- ruin helpers --------
// The two shapes that carry every ruin: a wall that breaks unevenly, and a
// row of posts that rots to stumps. Everything else is detail on top.

// A wall run from (x0,y0) to (x1,y1), broken into segments whose surviving
// height is hashed per segment. A ragged top line is the whole read of a
// ruin - an evenly-lowered wall looks like a design decision, and a wall
// with one gap looks like a doorway.
function wallRun(P, ctx, tag, x0, y0, x1, y1, h, th, mat, seg, base) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  const n = seg || Math.max(2, Math.round(len / 1.1));
  const z0 = base || 0;
  const yaw = Math.atan2(dy, dx);
  const d = ctx.decay;
  // stone stands; timber walls are gone by the time the stone is knee-high
  // Timber goes to nothing; stone does not. A footing course is the last
  // thing on a site and the reason a plan is still readable a thousand
  // years on, so the stone curve bottoms out at a course rather than at
  // zero - and the site keeps a shape instead of becoming a bare field.
  // Tuned so the stage names mean what they say: a wall is whole through
  // `weathered`, still standing through `roofless` (the roof is what has
  // gone, not the room), broken through `ruined`, and a course in the grass
  // at `footings`. The earlier curves had timber gone by the middle of
  // `roofless`, which made the two middle stages the same picture.
  const soft = mat === 'timber' || mat === 'char';
  // Drystone gets its own curve and barely moves on it. A footing course is
  // not something time takes away - it is what time leaves, and it is the
  // reason a plan is still readable when everything above it has gone. Held
  // to the same curve as walling stone it vanished under the turf, and the
  // last two stages had nothing in them to look at.
  const keep = soft ? 1 - smoothstep(0.45, 0.92, d)
    : mat === 'drystone' ? 1 - smoothstep(0.40, 1.0, d) * 0.30
    : 1 - smoothstep(0.35, 1.0, d) * 0.72;
  // A wall somebody is still living behind has a straight top. The ragged
  // line is what decay DOES to it, so the variation has to come in with the
  // decay rather than being there from the day it was built - at zero this
  // has to be a wall, or nothing below it means anything.
  const rough = smoothstep(0.02, 0.45, d);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const r = ctx.rnd(hashTag(tag, i));
    // Each segment takes its own share off the top, so the break line is
    // jagged. The variation only ever removes, and only in proportion to
    // what the material has already lost - stacking a second reduction on
    // top of `keep` is how a wall ends up gone at half the decay it should.
    let sh = h * keep * (1 - rough * 0.55 * r);
    // and a length of it is simply gone, more of it as the years run
    if (r < d * (soft ? 0.52 : 0.30)) sh = 0;
    sh = Math.max(0, Math.min(sh, h));
    if (sh < 0.06) { rubbleAt(P, ctx, tag + 'r' + i,
      x0 + dx * (t0 + t1) / 2, y0 + dy * (t0 + t1) / 2, th, mat); continue; }
    const cx = x0 + dx * (t0 + t1) / 2, cy = y0 + dy * (t0 + t1) / 2;
    P.push(Prim.box([cx, cy, z0 + sh / 2], [len / (2 * n), th / 2, sh / 2], mat,
      [yaw, 0]));
    // a wall that has lost its top has the top lying at its foot
    if (sh < h * 0.75 && d > 0.05) {
      rubbleAt(P, ctx, tag + 'f' + i, cx, cy, th, mat);
    }
  }
}

// small hash of a tag and an index into one integer, so every call site
// gets its own stream without anybody having to allocate one
function hashTag(tag, i) {
  let h = 0;
  for (let k = 0; k < tag.length; k++) h = (h * 31 + tag.charCodeAt(k)) | 0;
  return ((h ^ (i * 7919)) >>> 0) % 100000;
}

// The stones a wall sheds, thrown further when somebody knocked it down
// than when it fell over on its own.
function rubbleAt(P, ctx, tag, x, y, th, mat) {
  const stone = mat === 'timber' || mat === 'char' ? mat : 'drystone';
  const n = 1 + Math.floor(ctx.rnd(hashTag(tag, 1)) * 3 * (0.4 + ctx.decay));
  for (let i = 0; i < n; i++) {
    const a = ctx.rnd(hashTag(tag, 10 + i)) * 6.2832;
    const s = (0.3 + ctx.rnd(hashTag(tag, 20 + i))) * th * 2.2 * ctx.fx.throw;
    const r = th * (0.22 + 0.30 * ctx.rnd(hashTag(tag, 30 + i)));
    if (stone === 'timber' || stone === 'char') {
      // a fallen timber lies down; it does not turn into gravel
      P.push(Prim.box([x + Math.cos(a) * s, y + Math.sin(a) * s, r * 0.7],
        [r * 3.0, r * 0.7, r * 0.7], stone, [a, 0]));
    } else {
      P.push(Prim.facet([x + Math.cos(a) * s, y + Math.sin(a) * s, r * ASSET.SIT],
        r, hashTag(tag, 40 + i), stone));
    }
  }
}

// A row of posts. Timber rots from the ground up but breaks at the top, so
// what is left of a post ring is stumps of uneven height - and, once the
// place is truly old, holes in the soil the grass grows differently over.
function postRow(P, ctx, tag, x0, y0, x1, y1, n, h, r, mat, base) {
  const d = ctx.decay;
  const z0 = base || 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    const q = ctx.rnd(hashTag(tag, i));
    const keep = clamp(1 - smoothstep(0.12, 0.80, d) * (0.55 + q * 0.9), 0, 1);
    const ph = h * keep;
    if (ph > 0.10) {
      // a standing post leans a little once the ground around it goes soft
      const lean = (q - 0.5) * d * 0.32;
      P.push(Prim.cyl([x, y], r, z0, z0 + ph, mat, [q * 6.2832, lean]));
    } else if (d < 0.92) {
      // the stump, and beside it the length of it that came down
      P.push(Prim.cyl([x, y], r * 1.1, z0, z0 + 0.09, mat));
      if (q > 0.45) {
        const a = q * 6.2832;
        P.push(Prim.box([x + Math.cos(a) * h * 0.35, y + Math.sin(a) * h * 0.35,
          z0 + r], [h * 0.35, r, r], mat, [a, 0]));
      }
    } else {
      // the posthole: dark soil where the post stood, and nothing else
      P.push(Prim.cyl([x, y], r * 1.6, z0 - 0.02, z0 + 0.015, 'soil'));
    }
  }
}

// What grows back, in the order it actually arrives.
//
// Nothing at all while somebody is still sweeping the floor. Then moss and
// tussocks in the corners where the wet sits. Then a creeper up whatever is
// still standing - which is the stage that reads best, because it puts
// something living against something built and dates the ruin at a glance.
// Then a sapling in the middle of the room, and last a young tree.
//
// `wallH` is how high the standing masonry is, if the caller has any. A
// creeper has to climb something, and a building that has none skips
// straight from tussocks to the sapling.
function greenery(P, ctx, tag, hx, hy, wallH) {
  const d = ctx.decay;
  if (d < ASSET.GREEN_FROM) return;
  const amt = smoothstep(ASSET.GREEN_FROM, 1.0, d);
  const n = Math.round(amt * ASSET.GREEN_MAX);
  for (let i = 0; i < n; i++) {
    const x = (ctx.rnd(hashTag(tag, 100 + i)) * 2 - 1) * hx;
    const y = (ctx.rnd(hashTag(tag, 200 + i)) * 2 - 1) * hy;
    const s = 0.10 + ctx.rnd(hashTag(tag, 300 + i)) * 0.22;
    P.push(Prim.sph([x, y, s * 0.66], s, 'moss'));
  }
  // the creeper: up a corner and along the top of what it finds
  if (wallH > 0.5 && d > 0.40) {
    const climb = smoothstep(0.40, 0.85, d);
    for (let c = 0; c < 2; c++) {
      const sx = c ? 1 : -1;
      const cx = sx * hx * (0.72 + ctx.rnd(hashTag(tag, 400 + c)) * 0.2);
      const cy = hy * (ctx.rnd(hashTag(tag, 410 + c)) * 1.5 - 0.75);
      const up = wallH * climb;
      const steps = Math.max(2, Math.round(up / 0.26));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const w = ctx.rnd(hashTag(tag + 'v' + c, i));
        P.push(Prim.sph([cx + (w - 0.5) * 0.34, cy + (t * 2 - 1) * 0.30 * w,
          t * up], 0.11 + w * 0.09, 'leaf'));
      }
    }
  }
  // and the thing growing out of the hearth, which gets a year older with
  // every notch of decay. Kept small: the camera frames the tallest thing
  // on the site, and a full birch would push the ruin into the distance.
  if (d > 0.60) {
    const age = smoothstep(0.60, 1.0, d);
    const th = 0.55 + age * 0.85;
    const x = (ctx.rnd(hashTag(tag, 100)) * 2 - 1) * hx * 0.5;
    const y = (ctx.rnd(hashTag(tag, 200)) * 2 - 1) * hy * 0.5;
    P.push(Prim.cyl([x, y], 0.035 + age * 0.03, 0, th, 'timber',
      [ctx.rnd(hashTag(tag, 500)) * 6.2832, 0.06]));
    const cr = 0.26 + age * 0.30;
    P.push(Prim.sph([x, y, th + cr * 0.45], cr, 'leaf'));
    if (age > 0.5) {
      P.push(Prim.sph([x + cr * 0.6, y - cr * 0.3, th + cr * 0.2], cr * 0.66, 'leaf'));
    }
  }
}

// -------- what a people builds --------
// One generator per building. Each is authored about the origin with +z up
// and the long axis on x, so the viewer can frame anything without knowing
// what it is. Every one of them takes the same context, so decay and cause
// are properties of the world rather than arguments a caller has to invent.

const Build = {

  // The house. A sill of drystone keeps the timber out of the wet, the
  // walls are split planks, and the roof is thatch on a gable - which is
  // also the order those three things leave in, and therefore the order a
  // reader sees the centuries in.
  longhouse(ctx) {
    const P = [];
    const hx = 4.0, hy = 2.0, sill = 0.7, wall = 1.9, rise = 1.8;
    const d = ctx.decay;
    const roof = 1 - smoothstep(0.14, 0.42 + ctx.fx.burn * -0.14, d);
    // the sill: drystone, and the last thing here in a thousand years
    wallRun(P, ctx, 'lhA', -hx, -hy, hx, -hy, sill, 0.42, 'drystone');
    wallRun(P, ctx, 'lhB', -hx, hy, hx, hy, sill, 0.42, 'drystone');
    wallRun(P, ctx, 'lhC', -hx, -hy, -hx, hy, sill, 0.42, 'drystone');
    wallRun(P, ctx, 'lhD', hx, -hy, hx, hy, sill, 0.42, 'drystone');
    P.push(Prim.box([0, 0, 0.02], [hx, hy, 0.04], 'soil'));   // the floor
    // the timber wall, one plank run per side, with the door left out
    if (d < 0.72) {
      wallRun(P, ctx, 'lhW1', -hx, -hy, -0.9, -hy, wall, 0.22, ctx.wood, 4);
      wallRun(P, ctx, 'lhW2', 0.9, -hy, hx, -hy, wall, 0.22, ctx.wood, 4);
      wallRun(P, ctx, 'lhW3', -hx, hy, hx, hy, wall, 0.22, ctx.wood, 8);
      wallRun(P, ctx, 'lhW4', -hx, -hy, -hx, hy, wall, 0.22, ctx.wood, 4);
      wallRun(P, ctx, 'lhW5', hx, -hy, hx, hy, wall, 0.22, ctx.wood, 4);
      // the doorposts and lintel: the last part of a wall to fall, because
      // it is the only part of it anybody framed
      const dh = wall * (1 - smoothstep(0.30, 0.85, d));
      if (dh > 0.3) {
        P.push(Prim.box([-0.9, -hy, dh / 2], [0.12, 0.20, dh / 2], ctx.wood));
        P.push(Prim.box([0.9, -hy, dh / 2], [0.12, 0.20, dh / 2], ctx.wood));
        if (d < 0.55) P.push(Prim.box([0, -hy, dh + 0.1], [1.0, 0.20, 0.12], ctx.wood));
      }
    }
    if (roof > 0.02) {
      // the ridge beam, and the rafters that are all that is left of the
      // roof once the thatch has blown off it
      P.push(Prim.box([0, 0, sill + wall + rise * roof * 0.5],
        [hx + 0.2, 0.11, 0.11], ctx.wood, [0, 0]));
      if (roof > 0.45) {
        for (const sy of [-1, 1]) {
          P.push(Prim.box([0, sy * hy, sill + wall - 0.06],
            [hx + 0.08, 0.12, 0.10], ctx.wood));       // the wall plate
        }
        P.push(gable(0, 0, sill + wall, hx + 0.35, hy + 0.35, rise * roof,
          ctx.fx.burn > 0.5 && d > 0.2 ? 'char' : 'thatch', roof < 0.75));
      } else {
        // the bare rafters, eave to ridge, once the thatch has blown off
        const zE = sill + wall, zR = sill + wall + rise;
        for (let i = 0; i < 7; i++) {
          const rx = -hx + (i / 6) * hx * 2;
          if (ctx.rnd(hashTag('lhR', i)) > roof * 1.6) continue;
          for (const sy of [-1, 1]) {
            P.push(beam([rx, sy * hy, zE], [rx, 0, zR], 0.07, ctx.wood));
          }
        }
      }
    }
    // the hearth, in the middle of the floor where it always was
    P.push(Prim.cyl([0, 0], 0.62, 0, 0.10, 'drystone'));
    P.push(Prim.cyl([0, 0], 0.45, 0.03, 0.09, d > 0.3 ? 'soil' : 'ash'));
    greenery(P, ctx, 'lh', hx, hy, (sill + wall) * (1 - smoothstep(0.45, 0.92, d)));
    return P;
  },

  // Grain up off the ground on staddle stones, so the rats cannot climb and
  // the damp cannot rise. It is the one farm building that survives being
  // abandoned as a legible shape, because the stones stay in their square.
  granary(ctx) {
    const P = [];
    const hx = 1.6, hy = 1.4, lift = 0.85, wall = 1.5;
    const d = ctx.decay;
    const stand = 1 - smoothstep(0.30, 0.70, d);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = sx * (hx - 0.3), y = sy * (hy - 0.3);
      // the staddle: a mushroom of stone, and the reason the rats fail
      P.push(Prim.cone([x, y], 0, lift * 0.7, 0.22, 0.14, 'drystone'));
      P.push(Prim.cone([x, y], lift * 0.7, lift, 0.34, 0.30, 'drystone'));
    }
    if (stand > 0.05) {
      const h = wall * stand;
      const dw = 0.42;                    // half-width of the door
      P.push(Prim.box([0, 0, lift + 0.08], [hx, hy, 0.09], ctx.wood));
      // the door, in the gable end, with the wall run either side of it -
      // a grain store nobody can get into is a box, and the ladder up to
      // it is the whole reason the floor is off the ground in the first
      // place
      wallRun(P, ctx, 'gnA1', -hx, -hy, -dw, -hy, h, 0.16, ctx.wood, 2, lift + 0.17);
      wallRun(P, ctx, 'gnA2', dw, -hy, hx, -hy, h, 0.16, ctx.wood, 2, lift + 0.17);
      wallRun(P, ctx, 'gnB', -hx, hy, hx, hy, h, 0.16, ctx.wood, 4, lift + 0.17);
      wallRun(P, ctx, 'gnC', -hx, -hy, -hx, hy, h, 0.16, ctx.wood, 3, lift + 0.17);
      wallRun(P, ctx, 'gnD', hx, -hy, hx, hy, h, 0.16, ctx.wood, 3, lift + 0.17);
      // the head of the door: a lintel across, and the threshold under it
      if (stand > 0.62) {
        const dh = Math.min(h, 1.15);
        // jambs first: a lintel rests on its posts, and without them it is
        // spanning whichever bits of wall happen to have survived
        for (const sx of [-1, 1]) {
          P.push(Prim.box([sx * (dw + 0.08), -hy, lift + 0.17 + dh / 2],
            [0.08, 0.18, dh / 2], ctx.wood));
        }
        P.push(Prim.box([0, -hy, lift + 0.17 + dh + 0.08], [dw + 0.16, 0.16, 0.08],
          ctx.wood));
        P.push(Prim.box([0, -hy, lift + 0.19], [dw, 0.20, 0.06], ctx.wood));
        if (h > dh + 0.2) {
          P.push(Prim.box([0, -hy, lift + 0.17 + (dh + h) / 2 + 0.08],
            [dw, 0.16, (h - dh) / 2 - 0.08], ctx.wood));
        }
      }
      // the ladder, leaning on the threshold, taken away at harvest and
      // never put back once nobody is storing anything
      if (stand > 0.62) {
        const foot = [0, -hy - 0.95, 0], head = [0, -hy - 0.10, lift + 0.30];
        for (const sx of [-1, 1]) {
          P.push(strut([foot[0] + sx * 0.20, foot[1], foot[2]],
                       [head[0] + sx * 0.20, head[1], head[2]], 0.045, ctx.wood));
        }
        for (let i = 1; i < 4; i++) {
          const t = i / 4;
          P.push(Prim.box([0, foot[1] + (head[1] - foot[1]) * t,
            foot[2] + (head[2] - foot[2]) * t], [0.22, 0.035, 0.035], ctx.wood));
        }
      }
      if (stand > 0.62) {
        // the wall plate: the continuous timber a roof actually sits on. A
        // gable laid straight onto the wall is resting on whichever courses
        // survived, which for a ragged wall is nothing at all.
        for (const sy of [-1, 1]) {
          P.push(Prim.box([0, sy * hy, lift + 0.17 + h - 0.05],
            [hx + 0.06, 0.10, 0.09], ctx.wood));
        }
        P.push(gable(0, 0, lift + 0.17 + h + 0.02, hx + 0.25, hy + 0.25,
          0.9, 'thatch', stand < 0.82));
      }
    } else if (d < 0.95) {
      // the floor came down whole and is lying across its own staddles
      P.push(Prim.box([0.2, 0.1, lift * 0.35], [hx, hy, 0.09], ctx.wood, [0.3, 0.22]));
    }
    greenery(P, ctx, 'gn', hx + 0.5, hy + 0.5);
    return P;
  },

  // A pen: posts, rails, and a scrape of mud. Nothing here is built to
  // outlast anybody, which is exactly why it is worth drawing - it is the
  // building that proves how fast timber goes.
  byre(ctx) {
    const P = [];
    const R = 3.2, n = 14;
    const d = ctx.decay;
    P.push(Prim.cyl([0, 0], R * 0.92, 0, 0.03, 'soil'));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2832;
      if (a > 5.6) continue;                    // the gap where the gate was
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      const q = ctx.rnd(hashTag('by', i));
      const keep = clamp(1 - smoothstep(0.08, 0.62, d) * (0.6 + q), 0, 1);
      if (keep * 1.25 > 0.12) {
        P.push(Prim.cyl([x, y], 0.09, 0, 1.25 * keep, ctx.wood, [0, (q - 0.5) * d]));
      } else if (d < 0.9) {
        P.push(Prim.cyl([x, y], 0.11, 0, 0.07, ctx.wood));
      }
      // the rail to the next post, which is gone long before the posts are
      if (keep > 0.55 && i < n - 1) {
        const a2 = ((i + 1) / n) * 6.2832;
        if (a2 <= 5.6) {
          const x2 = Math.cos(a2) * R, y2 = Math.sin(a2) * R;
          P.push(Prim.box([(x + x2) / 2, (y + y2) / 2, 0.85],
            [Math.hypot(x2 - x, y2 - y) / 2, 0.05, 0.05], ctx.wood,
            [Math.atan2(y2 - y, x2 - x), 0]));
        }
      }
    }
    greenery(P, ctx, 'by', R, R);
    return P;
  },

  // A field boundary, which is the most common piece of building on any
  // ground people farmed and the last one to stop being visible. Drystone
  // does not fall down, it slumps - so this one gets wider as it gets old
  // instead of shorter.
  fieldwall(ctx) {
    const P = [];
    const d = ctx.decay;
    const L = 9;
    const slump = 1 + d * 0.9;
    for (let i = 0; i < 16; i++) {
      const x = -L / 2 + (i / 15) * L;
      const q = ctx.rnd(hashTag('fw', i));
      const h = 0.95 * (1 - smoothstep(0.2, 1.0, d) * (0.35 + q * 0.55));
      // the line wanders, because somebody laid it by eye along a boundary
      const y = Math.sin(i * 0.7) * 0.22;
      // Each stone beds on the two below it, which is what drystone means -
      // so the courses climb by less than a stone's radius and the jitter
      // stays inside one. Wider than that and the top of a course is
      // standing on air.
      const n = 3 + Math.round(q * 3);
      for (let j = 0; j < n; j++) {
        const r = 0.12 + ctx.rnd(hashTag('fw' + i, j)) * 0.12;
        const t = j / n;
        const off = (ctx.rnd(hashTag('fy' + i, j)) - 0.5) * 0.40 * slump;
        // and the courses fall away toward the edges of the spread, so a
        // stone that has rolled off the wall is on the ground, not beside
        // the top of it
        const drop = 1 - Math.min(1, Math.abs(off) / (0.30 * slump)) * 0.75;
        P.push(Prim.facet([x + (ctx.rnd(hashTag('fx' + i, j)) - 0.5) * 0.30 * slump,
          y + off, r * ASSET.SIT + t * h * 0.82 * drop],
          r, hashTag('fs' + i, j), 'drystone'));
      }
    }
    if (d > 0.4) greenery(P, ctx, 'fw', L / 2, 0.8);
    return P;
  },

  // ---- the seat ----

  // The great hall: the one building a people puts cut stone into, and
  // therefore the one that is still recognisably a room after two thousand
  // years. Aisle posts down the middle carry the roof, so when the roof
  // goes the posts are left standing in a double row inside four walls -
  // which is the shape of every excavated hall there has ever been.
  moothall(ctx) {
    const P = [];
    const hx = 6.0, hy = 3.4, wall = 3.2, rise = 2.6, th = 0.75;
    const d = ctx.decay;
    const roof = 1 - smoothstep(0.10, 0.36, d);
    P.push(Prim.box([0, 0, 0.05], [hx, hy, 0.07], 'cutstone'));
    // the walls, with the door left out of the gable end
    wallRun(P, ctx, 'mhA', -hx, -hy, hx, -hy, wall, th, 'cutstone', 9);
    wallRun(P, ctx, 'mhB', -hx, hy, hx, hy, wall, th, 'cutstone', 9);
    wallRun(P, ctx, 'mhC', -hx, -hy, -hx, -1.0, wall, th, 'cutstone', 3);
    wallRun(P, ctx, 'mhD', -hx, 1.0, -hx, hy, wall, th, 'cutstone', 3);
    wallRun(P, ctx, 'mhE', hx, -hy, hx, hy, wall, th, 'cutstone', 6);
    // the doorway: two jambs and a lintel, dressed, and the reason the
    // west end of a ruined hall always has one gap that is not a collapse
    const dh = wall * 0.62 * (1 - smoothstep(0.55, 0.95, d));
    if (dh > 0.3) {
      P.push(Prim.box([-hx, -1.15, dh / 2], [th / 2, 0.25, dh / 2], 'cutstone'));
      P.push(Prim.box([-hx, 1.15, dh / 2], [th / 2, 0.25, dh / 2], 'cutstone'));
      if (d < 0.62) P.push(Prim.box([-hx, 0, dh + 0.2], [th / 2, 1.4, 0.22], 'cutstone'));
    }
    // the aisle posts, on stone pads that outlive them
    for (const sy of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = -hx * 0.62 + i * (hx * 1.24 / 3);
        P.push(Prim.box([x, sy * 1.5, 0.09], [0.36, 0.36, 0.11], 'cutstone'));
        const q = ctx.rnd(hashTag('mhp', i * 2 + (sy > 0 ? 1 : 0)));
        const keep = clamp(1 - smoothstep(0.20, 0.78, d) * (0.5 + q), 0, 1);
        if (keep > 0.06) {
          P.push(Prim.cyl([x, sy * 1.5], 0.24, 0.16, 0.16 + (wall + 0.4) * keep,
            ctx.wood, [0, (q - 0.5) * d * 0.2]));
        }
      }
    }
    if (roof > 0.02) {
      P.push(Prim.box([0, 0, wall + rise * roof * 0.55], [hx + 0.4, 0.16, 0.16],
        ctx.wood));
      if (roof > 0.4) {
        for (const sy of [-1, 1]) {
          P.push(Prim.box([0, sy * hy, wall - 0.09], [hx + 0.1, 0.16, 0.14], ctx.wood));
        }
        P.push(gable(0, 0, wall, hx + 0.5, hy + 0.5, rise * roof,
          ctx.fx.burn > 0.5 && d > 0.18 ? 'char' : 'thatch', roof < 0.72));
      }
    }
    // the long hearth: a hall is a fire with a building around it
    P.push(Prim.box([0, 0, 0.09], [1.9, 0.5, 0.11], 'drystone'));
    P.push(Prim.box([0, 0, 0.13], [1.7, 0.36, 0.06], d > 0.3 ? 'soil' : 'ash'));
    // the high seat, at the far end, on a stone dais
    if (d < 0.8) P.push(Prim.box([hx - 1.1, 0, 0.22], [0.7, 1.1, 0.24], 'cutstone'));
    greenery(P, ctx, 'mh', hx, hy, wall * (1 - smoothstep(0.35, 1.0, d) * 0.72));
    return P;
  },

  // A round tower, because a round wall has no corner to lever a stone out
  // of. It falls the other way instead: one side comes down whole and the
  // other stands to full height, which is why every ruined keep in the
  // world is a half-cylinder pointing at the sky.
  tower(ctx) {
    const P = [];
    const R = 2.3, H = 8.5, th = 0.62;
    const d = ctx.decay;
    // the side the collapse took, chosen once per tower
    const fallA = ctx.rnd(hashTag('tw', 0)) * 6.2832;
    const N = 26;
    // how high the wall is on a given bearing, which the stair and the roof
    // both have to ask before they put anything in the air
    const wallAt = a => {
      const dif = Math.abs(((a - fallA + Math.PI * 3) % 6.2832) - Math.PI);
      const q = ctx.rnd(hashTag('twh', Math.round(a / 6.2832 * N) % N));
      return H * clamp(1 - smoothstep(0.12, 1.05, d) * (1.5 - (dif / Math.PI) * 1.05)
        * (0.7 + q * 0.6), 0, 1);
    };
    let lowest = H;
    for (let i = 0; i < N; i++) lowest = Math.min(lowest, wallAt((i / N) * 6.2832));
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 6.2832;
      // how far this bearing is from the failure, wrapped to +/- pi
      let dif = Math.abs(((a - fallA + Math.PI * 3) % 6.2832) - Math.PI);
      const shelter = dif / Math.PI;                  // 0 at the breach, 1 opposite
      const q = ctx.rnd(hashTag('twh', i));
      const keep = clamp(1 - smoothstep(0.12, 1.05, d) * (1.5 - shelter * 1.05)
        * (0.7 + q * 0.6), 0, 1);
      const h = H * keep;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      if (h > 0.15) {
        P.push(Prim.box([x, y, h / 2], [th / 2, R * 3.4 / N, h / 2], 'cutstone',
          [a, 0]));
      }
      if (h < H * 0.7) rubbleAt(P, ctx, 'twr' + i, x * 1.5, y * 1.5, th, 'stone');
    }
    P.push(Prim.cyl([0, 0], R + th * 0.7, 0, 0.35, 'cutstone'));   // the plinth
    P.push(Prim.cyl([0, 0], R - th / 2, 0.3, 0.42, 'soil'));       // the floor
    // The stair that wound up inside it, exposed once the wall fell away.
    // A tread is built into the wall, so it stops where the wall does -
    // otherwise the top of the flight hangs in the middle of the ruin.
    if (d > 0.25) {
      for (let i = 0; i < 16; i++) {
        const t = i / 15;
        const a = fallA + Math.PI + t * 5.0;
        const z = 0.42 + t * H * 0.62 * (1 - d * 0.4);
        if (z > wallAt(a) - 0.2) break;
        P.push(Prim.box([Math.cos(a) * (R - th * 0.9), Math.sin(a) * (R - th * 0.9), z],
          [0.55, 0.30, 0.09], 'cutstone', [a, 0]));
      }
    }
    // The roof sits on the whole ring, so it goes as soon as any of the ring
    // does - a cone floating over a breach is the first thing a reader sees.
    if (lowest > H - 0.15) {
      P.push(Prim.cone([0, 0], H, H + 1.7, R + 0.35, 0.05, ctx.wood));
    }
    greenery(P, ctx, 'tw', R * 1.8, R * 1.8, lowest * 0.75);
    return P;
  },

  // The fortify event, made physical. A gate is the piece of a defence that
  // somebody wanted to be looked at, so it is dressed stone where the wall
  // beside it is rubble core - and it is what is left standing when the
  // wall either side of it has become a bank in a field.
  gate(ctx) {
    const P = [];
    const d = ctx.decay;
    const H = 4.6, W = 1.7, th = 1.0;
    for (const sy of [-1, 1]) {
      const q = ctx.rnd(hashTag('gt', sy > 0 ? 1 : 0));
      const keep = clamp(1 - smoothstep(0.25, 1.0, d) * (0.45 + q * 0.75), 0, 1);
      const h = H * keep;
      // the towers either side, which is what a gate really is
      for (let i = 0; i < 5; i++) {
        const z0 = i * (h / 5), z1 = (i + 1) * (h / 5);
        if (z1 - z0 < 0.05) continue;
        const jit = (ctx.rnd(hashTag('gtj' + sy, i)) - 0.5) * 0.10 * d;
        P.push(Prim.box([jit, sy * (W + th / 2), (z0 + z1) / 2],
          [th, th / 2 + 0.15, (z1 - z0) / 2], 'cutstone'));
      }
      if (h < H * 0.8) rubbleAt(P, ctx, 'gtr' + sy, 0.9, sy * (W + 0.9), th, 'stone');
    }
    // the arch over the road, which stands until one pier goes and then
    // does not stand at all
    const arch = 1 - smoothstep(0.30, 0.62, d);
    if (arch > 0.2) {
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (i / 8);
        P.push(Prim.box([0, Math.cos(a) * W, 3.0 + Math.sin(a) * W * 0.85],
          [th * 0.9, 0.34, 0.30], 'cutstone', [0, 0]));
      }
    } else if (d < 0.9) {
      for (let i = 0; i < 6; i++) {
        rubbleAt(P, ctx, 'gta' + i, (ctx.rnd(hashTag('gta', i)) - 0.5) * 2.2,
          (ctx.rnd(hashTag('gtb', i)) - 0.5) * 3.0, 0.9, 'stone');
      }
    }
    // the road surface running through, worn into the ground
    P.push(Prim.box([0, 0, 0.03], [1.6, W, 0.05], 'soil'));
    greenery(P, ctx, 'gt', 2.2, W + 1.4, H * (1 - smoothstep(0.25, 1.0, d) * 0.6));
    return P;
  },

  // The wall between the gates. Timber peoples build a palisade and stone
  // peoples build a curtain, and which one this is depends on the people
  // rather than on the building - so the same asset covers both, and the
  // difference in how they age is the whole lesson.
  rampart(ctx) {
    const P = [];
    const d = ctx.decay;
    const L = 10;
    // the bank and ditch, which is earth and therefore permanent: long
    // after the wall on top has gone this is still a line across a field
    P.push(Prim.box([0, 0, 0.5 - d * 0.16], [L / 2, 1.5, 0.5], 'soil'));
    P.push(Prim.box([0, -2.4, -0.30], [L / 2, 1.0, 0.45], 'soil'));
    if (ctx.mat === 'stone') {
      wallRun(P, ctx, 'rp', -L / 2, 0, L / 2, 0, 2.8, 0.85, 'stone', 10, 0.85);
    } else {
      postRow(P, ctx, 'rp', -L / 2, 0, L / 2, 0, 16, 2.9, 0.17, ctx.wood, 0.9);
      // the walkway behind it, on brackets, which is what a palisade is for
      if (d < 0.42) P.push(Prim.box([0, 0.55, 2.0], [L / 2, 0.45, 0.08], ctx.wood));
    }
    greenery(P, ctx, 'rp', L / 2, 2.4);
    return P;
  },

  // ---- the delve ----

  // The mouth of a drift mine, driven into a hillside rather than sunk.
  // The timber frame holds the first few metres, where the rock is rotten;
  // when it rots the hill closes the hole, and what is left is a dimple in
  // a slope with a spoil heap under it. That dimple is how every real adit
  // is found, so it is the thing the decayed version has to read as.
  adit(ctx) {
    const P = [];
    const d = ctx.decay;
    // The hillside, as a slope with a bite taken out of it. A wedge and a
    // flat face, rather than a box with a cone parked on it - the earlier
    // version read as two shapes sitting next to each other because that is
    // what it was. The face is what the drift was driven into, and the
    // reason it is vertical is that somebody made it vertical.
    // Only as much hill as it takes to read as one. A slice deep enough to
    // be a real hillside would frame the whole card and leave the mouth -
    // the thing the asset is about - four cells across.
    const rise = 0.50;                       // the slope of the hill behind
    const sl = Math.hypot(1, rise);
    P.push(Prim.conv([0, 3.2, 0], [
      { n: [0, 0, -1], d: 0 },                       // the ground it sits on
      { n: [1, 0, 0], d: 4.0 }, { n: [-1, 0, 0], d: 4.0 },
      { n: [0, 1, 0], d: 2.3 },                      // the back of the slice
      { n: [0, -1, 0], d: -2.3 },                    // the cut face, at y=0.9
      { n: [0, -rise / sl, 1 / sl], d: (2.3 * rise + 2.6) / sl },
    ], 'stone'));
    // the working face itself, dressed back around the mouth
    P.push(Prim.box([0, 0.95, 1.30], [2.1, 0.22, 1.30], 'stone'));
    const open = 1 - smoothstep(0.35, 0.85, d);
    // the portal frame: two legs and a cap, and the roof timbers behind
    const keep = 1 - smoothstep(0.20, 0.70, d);
    if (keep > 0.08) {
      for (const sx of [-1, 1]) {
        P.push(Prim.box([sx * 0.86, 0.75, 1.0 * keep],
          [0.15, 0.20, 1.0 * keep], ctx.wood));
      }
      if (keep > 0.4) P.push(Prim.box([0, 0.75, 2.0 * keep + 0.09],
        [1.02, 0.20, 0.15], ctx.wood));
      // the sets going back into the dark, each one a little further in
      for (let i = 1; i < 4; i++) {
        if (ctx.rnd(hashTag('ad', i)) > keep) continue;
        P.push(Prim.box([0, 0.9 + i * 0.75, 1.94], [0.98, 0.10, 0.10], ctx.wood));
        for (const sx of [-1, 1]) {
          P.push(Prim.box([sx * 0.88, 0.9 + i * 0.75, 0.97],
            [0.10, 0.10, 0.97], ctx.wood));
        }
      }
    }
    // the hole itself, black; when the frame goes the hill slumps into it
    if (open > 0.05) {
      P.push(Prim.box([0, 2.2, 0.9 * open], [0.78 * open + 0.08, 1.6, 0.92 * open],
        'ash'));
    } else if (d < 0.99) {
      // The dimple. This is how a closed adit is actually found - not by a
      // hole, but by a hollow in a slope with a fan of stone under it.
      P.push(Prim.cone([0, 1.5], -0.1, 0.85, 1.7, 0.7, 'soil'));
    }
    // the spoil the mine put outside its own door, fanning downhill
    for (let i = 0; i < 22; i++) {
      const q = ctx.rnd(hashTag('ads', i)), q2 = ctx.rnd(hashTag('ads2', i));
      const r = 0.10 + q * 0.16;
      P.push(Prim.facet([(q - 0.5) * 5.0, -0.4 - q2 * 3.0, r * ASSET.SIT], r,
        hashTag('adf', i), 'stone'));
    }
    // the barrow-way: two rails on sleepers, running out of the hole
    if (d < 0.5) {
      for (const sx of [-1, 1]) {
        P.push(Prim.box([sx * 0.34, -0.2, 0.16], [0.05, 2.6, 0.05], ctx.wood));
      }
    }
    greenery(P, ctx, 'ad', 3.0, 2.0);
    return P;
  },

  // Winding gear over a shaft: the tallest thing a mining people builds,
  // and the one that says from a mile off that the ground here was worth
  // sinking a hole into. Four legs and a headsheave; when it falls it
  // falls in one direction and the shaft is left as a walled ring.
  headframe(ctx) {
    const P = [];
    const d = ctx.decay;
    const H = 6.2, base = 1.5;
    const stand = 1 - smoothstep(0.14, 0.55, d);
    // the shaft collar, which is masonry and outlives everything above it
    P.push(Prim.cyl([0, 0], 1.25, 0, 0.55 - d * 0.12, 'cutstone'));
    P.push(Prim.cyl([0, 0], 0.95, 0.1, 0.60, 'ash'));
    if (stand > 0.1) {
      const h = H * stand;
      // Four legs from a wide foot to a narrow head, so the frame is a
      // pyramid over the shaft. Every leg rakes inward - the earlier version
      // flipped the rake on the two diagonals where sx*sy was negative, and
      // two of the four leaned out over nothing.
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        P.push(beam([sx * base, sy * base, 0], [sx * 0.30, sy * 0.30, h],
          0.13, ctx.wood));
        // and a sill tying its foot to the next, which is what stops a
        // headframe walking itself apart
        if (stand > 0.3) P.push(beam([sx * base, sy * base, 0.12],
          [sx * base, -sy * base, 0.12], 0.09, ctx.wood));
      }
      if (stand > 0.45) {
        // the sheave the rope ran over, turning in a vertical plane
        P.push(Prim.cyl([-0.09, 0], 0.72, h - 0.05, h + 0.13, 'iron', [0, 1.5708]));
        P.push(Prim.box([0, 0, h - 0.30], [0.42, 0.42, 0.11], ctx.wood));
        // the rope, going down the hole
        P.push(Prim.cyl([0, 0], 0.03, 0.5, h - 0.05, 'char'));
      }
    } else if (d < 0.95) {
      // it came down as one piece and is lying beside its own shaft
      const a = ctx.rnd(hashTag('hf', 0)) * 6.2832;
      P.push(Prim.box([Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0.2],
        [H / 2, 0.4, 0.16], d > 0.7 ? 'soil' : ctx.wood, [a, 0]));
      P.push(Prim.cyl([Math.cos(a) * 5.0, Math.sin(a) * 5.0], 0.7, 0.0, 0.16,
        'rust', [a, 1.5708]));
    }
    // the winding house beside it, low and stone, where the engine sat
    wallRun(P, ctx, 'hfw1', -4.4, -1.3, -2.0, -1.3, 1.9, 0.4, 'drystone', 3);
    wallRun(P, ctx, 'hfw2', -4.4, 1.3, -2.0, 1.3, 1.9, 0.4, 'drystone', 3);
    wallRun(P, ctx, 'hfw3', -4.4, -1.3, -4.4, 1.3, 1.9, 0.4, 'drystone', 3);
    for (let i = 0; i < 16; i++) {
      const q = ctx.rnd(hashTag('hfs', i));
      const hr = 0.12 + q * 0.16;
      P.push(Prim.facet([2.2 + q * 3.0,
        (ctx.rnd(hashTag('hfs2', i)) - 0.5) * 3.4, hr * ASSET.SIT],
        hr, hashTag('hff', i), 'stone'));
    }
    greenery(P, ctx, 'hf', 3.2, 2.4);
    return P;
  },

  // The waste. Everything a mine takes out that is not metal ends in a
  // cone beside it, and that cone is the most permanent thing a mining
  // people ever makes - it is still there when the shaft has closed, the
  // gear has rotted and the name has been forgotten.
  spoil(ctx) {
    const P = [];
    const d = ctx.decay;
    // weathering does not remove a heap, it slumps it: shorter and wider,
    // and eventually a green hummock nobody reads as artificial
    const H = 2.6 * (1 - d * 0.35), R = 3.4 * (1 + d * 0.22);
    P.push(Prim.cone([0, 0], 0, H, R, 0.5 + d * 1.2, 'stone'));
    for (let i = 0; i < 34; i++) {
      const a = ctx.rnd(hashTag('sp', i)) * 6.2832;
      const t = ctx.rnd(hashTag('sp2', i));
      const rr = R * (0.25 + t * 0.95);
      const z = Math.max(0, H * (1 - rr / R)) * (0.85 + 0.2 * t);
      const s = 0.10 + ctx.rnd(hashTag('sp3', i)) * 0.17;
      P.push(Prim.facet([Math.cos(a) * rr, Math.sin(a) * rr, z + s * ASSET.SIT], s,
        hashTag('spf', i), 'stone'));
    }
    // the tip line the barrows ran out along, lying down the face of the
    // heap rather than hanging over it
    if (d < 0.45) {
      P.push(beam([0, -0.35, H - 0.1], [0, -R - 0.5, 0.08], 0.075, ctx.wood));
    }
    if (d > 0.5) greenery(P, ctx, 'sp', R * 0.8, R * 0.8);
    return P;
  },

  // Where ore becomes metal: a clay shaft furnace with a stone footing and
  // a tap hole at the bottom. It is the building the whole metal ladder
  // runs through, so the slag beside it is the proof a people got as far
  // as they say they did.
  smelter(ctx) {
    const P = [];
    const d = ctx.decay;
    const keep = 1 - smoothstep(0.18, 0.78, d);
    const H = 1.9 * keep;
    P.push(Prim.cyl([0, 0], 1.05, 0, 0.30, 'drystone'));
    if (H > 0.12) {
      // the stack: fired clay, thick-walled, narrowing to the throat
      P.push(Prim.cone([0, 0], 0.25, 0.25 + H, 0.78, 0.42 * (0.5 + keep * 0.5),
        'brick'));
      // the tap arch at the foot, where the metal came out
      if (keep > 0.35) P.push(Prim.box([0, -0.66, 0.55], [0.26, 0.3, 0.28], 'ash'));
    } else {
      P.push(Prim.cone([0, 0], 0.25, 0.55, 0.80, 0.62, 'brick'));   // the stub
    }
    // the slag: glassy, black, and effectively immortal, which is why a
    // furnace can be dated when the building it stood in cannot
    for (let i = 0; i < 18; i++) {
      const a = -1.5708 + (ctx.rnd(hashTag('sm', i)) - 0.5) * 2.4;
      const r = 0.9 + ctx.rnd(hashTag('sm2', i)) * 1.9;
      const s = 0.07 + ctx.rnd(hashTag('sm3', i)) * 0.13;
      P.push(Prim.facet([Math.cos(a) * r, Math.sin(a) * r, s * ASSET.SIT], s,
        hashTag('smf', i), 'jet'));
    }
    // the bellows stand and the charcoal pile that fed it
    if (d < 0.55) {
      P.push(Prim.box([1.2, 0.25, 0.35], [0.42, 0.3, 0.35], ctx.wood, [0.4, 0]));
      P.push(Prim.cone([-1.5, 0.6], 0, 0.5, 0.65, 0.05, 'char'));
    }
    greenery(P, ctx, 'sm', 1.8, 1.8);
    return P;
  },

  // ---- the road ----

  // A marker where a road forks. It carries the distance to the next
  // place, which in this world is the one piece of writing that is useful
  // rather than commemorative - and it is a single stone, so it is still
  // standing when the road under it is a crop mark.
  waystone(ctx) {
    const P = [];
    const d = ctx.decay;
    const H = 1.5;
    const lean = d * 0.55 * (ctx.rnd(hashTag('ws', 0)) - 0.3);
    const fallen = d > 0.72 && ctx.rnd(hashTag('ws', 1)) < 0.6;
    if (fallen) {
      P.push(Prim.box([0.4, 0, 0.17], [H / 2, 0.28, 0.17], 'stone', [0.6, 1.4]));
      P.push(Prim.cyl([0, 0], 0.35, -0.05, 0.06, 'soil'));   // the socket
    } else {
      P.push(Prim.box([0, 0, H / 2], [0.20, 0.30, H / 2], 'stone', [0.2, lean]));
      // the cut face: a shallow panel where the lines were, worn to
      // nothing on the weather side long before the stone goes
      if (d < 0.80) {
        P.push(Prim.box([-0.19, 0, H * 0.62], [0.03, 0.22, H * 0.24],
          d > 0.45 ? 'stone' : 'cutstone', [0.2, lean]));
      }
      P.push(Prim.cyl([0, 0], 0.42, 0, 0.10, 'drystone'));
    }
    // the road: two ruts and a metalled camber, which the grass takes back
    const road = 1 - smoothstep(0.25, 0.95, d);
    if (road > 0.05) {
      P.push(Prim.box([0, 2.4, 0.04], [2.6, 1.5, 0.06 * road + 0.02], 'soil'));
      for (const sx of [-1, 1]) {
        P.push(Prim.box([sx * 0.55, 2.4, 0.03], [2.6, 0.16, 0.04], 'stone'));
      }
    }
    greenery(P, ctx, 'ws', 1.4, 2.0);
    return P;
  },

  // The bridge event, which the chronicle logs by name because a crossing
  // is worth more than the road either side of it. Timber deck on stone
  // piers: the deck goes in a century and the piers stand in the water for
  // as long as there is water, which is why a ford with two stumps in it
  // is a bridge somebody built.
  bridge(ctx) {
    const P = [];
    const d = ctx.decay;
    const span = 8.0, W = 1.5;
    P.push(Prim.box([0, 0, -0.55], [span / 2 + 3, 4.5, 0.5], 'water'));
    // the abutments, cut into either bank
    for (const sx of [-1, 1]) {
      P.push(Prim.box([sx * (span / 2 + 1.1), 0, 0.35], [1.2, W + 0.5, 0.85],
        'cutstone'));
      P.push(Prim.box([sx * (span / 2 + 2.6), 0, 0.30], [1.4, W + 0.9, 0.9], 'soil'));
    }
    // the piers: two in the stream, taking the worst of it
    for (const sx of [-1, 1]) {
      const q = ctx.rnd(hashTag('bp', sx > 0 ? 1 : 0));
      const keep = clamp(1 - smoothstep(0.35, 1.05, d) * (0.4 + q * 0.7), 0, 1);
      const h = 1.35 * keep;
      if (h > 0.08) {
        P.push(Prim.box([sx * span * 0.24, 0, h / 2 - 0.5],
          [0.55, W * 0.8, h / 2 + 0.5], 'cutstone'));
        // a cutwater on the upstream side, which is the detail that says
        // somebody who had built one before built this one
        P.push(Prim.cone([sx * span * 0.24, -W * 0.8], -0.5, h - 0.5, 0.5, 0.25,
          'cutstone'));
      }
      if (keep < 0.8) rubbleAt(P, ctx, 'bpr' + sx, sx * span * 0.24, W, 0.55, 'stone');
    }
    const deck = 1 - smoothstep(0.10, 0.48, d);
    if (deck > 0.35) {
      P.push(Prim.box([0, 0, 0.95], [span / 2 + 1.0, W, 0.11], ctx.wood));
      for (const sy of [-1, 1]) {
        postRow(P, ctx, 'brl' + sy, -span / 2, sy * W, span / 2, sy * W, 7,
          0.85, 0.07, ctx.wood, 1.0);
        if (deck > 0.6) P.push(Prim.box([0, sy * W, 1.85],
          [span / 2, 0.06, 0.06], ctx.wood));
      }
    } else if (deck > 0.02) {
      // the stringers, stripped of their planking
      for (const sy of [-1, 1]) {
        P.push(Prim.box([0, sy * W * 0.6, 0.92], [span / 2 + 0.8, 0.12, 0.12],
          ctx.wood, [0, (ctx.rnd(hashTag('bs', sy)) - 0.5) * 0.1]));
      }
    } else if (d < 0.9) {
      // the deck is in the river, which is where a fallen bridge always is
      P.push(Prim.box([0.6, 0.4, -0.35], [2.2, W * 0.7, 0.09], 'soil', [0.35, 0.15]));
    }
    return P;
  },

  // ---- what is left of people ----

  // A barrow: the grave deposit, made into a hill. A kerb of stones holds
  // the mound in and a passage runs to a chamber at the centre, which is
  // where the chronicle's grave goods actually are. Time does not remove a
  // barrow, it rounds it - and robbers put a crater in the top, which is
  // the chronicle's `robbed` flag made visible from a hundred metres away.
  barrow(ctx, o) {
    const P = [];
    const d = ctx.decay;
    const robbed = o && o.robbed;
    const R = 4.2 * (1 + d * 0.18), H = 2.3 * (1 - d * 0.30);
    P.push(Prim.cone([0, 0], 0, H, R, robbed ? 1.5 : 0.35, 'turf'));
    if (robbed) {
      // the robber trench, straight down the middle from the top
      P.push(Prim.cone([0, 0], H - 1.1, H + 0.05, 0.35, 1.5, 'soil'));
      for (let i = 0; i < 7; i++) {
        const a = ctx.rnd(hashTag('bwr', i)) * 6.2832;
        P.push(Prim.facet([Math.cos(a) * (R * 0.55), Math.sin(a) * (R * 0.55),
          H * 0.45], 0.16, hashTag('bwf', i), 'stone'));
      }
    }
    // the kerb: a ring of set stones, which is what stops a mound spreading
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 6.2832;
      if (Math.abs(((a + Math.PI) % 6.2832) - Math.PI) < 0.42) continue;  // the entrance
      const q = ctx.rnd(hashTag('bwk', i));
      const h = 0.55 * (1 - smoothstep(0.5, 1.0, d) * q * 0.7);
      P.push(Prim.box([Math.cos(a) * R, Math.sin(a) * R, h / 2],
        [0.16, 0.30, h / 2], 'stone', [a, (q - 0.5) * d * 0.5]));
    }
    // the passage: two orthostats and a capstone, walking in from the south
    const open = 1 - smoothstep(0.55, 0.95, d);
    for (const sy of [-1, 1]) {
      P.push(Prim.box([-R * 0.75, sy * 0.55, 0.62], [R * 0.35, 0.20, 0.62],
        'stone'));
    }
    if (open > 0.3 || robbed) {
      P.push(Prim.box([-R * 0.75, 0, 1.35], [R * 0.32, 0.75, 0.22], 'stone'));
      P.push(Prim.box([-R * 0.55, 0, 0.55], [R * 0.2, 0.5, 0.55], 'ash'));
    } else {
      P.push(Prim.cone([-R * 0.8, 0], 0, 0.8, 1.1, 0.4, 'turf'));   // sealed
    }
    greenery(P, ctx, 'bw', R * 0.7, R * 0.7);
    return P;
  },

  // A cairn: stones piled by hand, one at a time, by people passing. It
  // marks a battle, a summit or a death, and it is the cheapest permanent
  // thing anybody in this world can make - which is why there are more of
  // them than of anything else that was meant to last.
  cairn(ctx) {
    const P = [];
    const d = ctx.decay;
    // an old cairn is a spread cairn: the cone relaxes toward its angle of
    // repose and then past it, as frost takes the top off
    const H = 1.85 * (1 - d * 0.42), R = 1.15 * (1 + d * 0.55);
    // The body of the pile. The facets below are the stones you can pick out
    // of it; without something for them to lie on, the ones on the flank are
    // each balanced on their own and half of them are in the air.
    P.push(Prim.cone([0, 0], -0.06, H * 0.80, R * 0.94, R * 0.16, 'drystone'));
    const n = 38;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = ctx.rnd(hashTag('cn', i)) * 6.2832;
      const rr = R * (0.12 + ctx.rnd(hashTag('cn2', i)) * 0.95);
      const s = 0.11 + ctx.rnd(hashTag('cn3', i)) * 0.15;
      // A stone's height follows the cone it is part of rather than its own
      // index, so an outer stone lies on the ground and an inner one lies on
      // the heap. Choosing the two independently is what left stones in the
      // air over the skirt of the pile.
      const surf = H * Math.max(0, 1 - rr / R);
      // Height is a function of radius and nothing else, plus a jitter no
      // bigger than the stone itself. Letting the two vary independently
      // put stones at the top of the pile out over its skirt.
      P.push(Prim.facet([Math.cos(a) * rr, Math.sin(a) * rr,
        s * ASSET.SIT + surf * 0.86 + (ctx.rnd(hashTag('cn4', i)) - 0.5) * s * 0.7],
        s, hashTag('cnf', i), 'drystone'));
    }
    // the last stone somebody put on the top, still standing on end - on
    // the top of the pile, which is lower than the top of the cone it was
    // measured from
    if (d < 0.6) P.push(Prim.box([0, 0, H * 0.80 + 0.18], [0.09, 0.14, 0.22],
      'stone', [0.6, 0.15]));
    if (d > 0.45) greenery(P, ctx, 'cn', R, R);
    return P;
  },

  // A standing stone: one piece of rock, raised on end by people with
  // rope and levers, meaning something nobody alive can read. It outlasts
  // every other thing in this catalogue, and the only thing time does to
  // it is tip it - so decay here is measured in degrees off vertical.
  menhir(ctx) {
    const P = [];
    const d = ctx.decay;
    const H = 3.4;
    const q = ctx.rnd(hashTag('mn', 0));
    const down = d > 0.80 && q < 0.5;
    if (down) {
      P.push(Prim.box([0.3, 0, 0.30], [H / 2, 0.42, 0.28], 'stone', [q * 3.0, 1.45]));
      P.push(Prim.cyl([-H * 0.35, 0], 0.5, -0.10, 0.05, 'soil'));
    } else {
      const lean = d * 0.30 * (q - 0.35);
      P.push(Prim.box([0, 0, H / 2], [0.32, 0.48, H / 2], 'stone', [q * 2.0, lean]));
      // the packing stones that hold it up, showing more as the soil goes
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 6.2832;
        P.push(Prim.facet([Math.cos(a) * 0.55, Math.sin(a) * 0.55,
          0.16 * ASSET.SIT + d * 0.04], 0.16, hashTag('mnp', i), 'drystone'));
      }
    }
    // the lichen that is the only thing that ever grows on it
    if (d > 0.3) {
      for (let i = 0; i < 5; i++) {
        const t = ctx.rnd(hashTag('mnl', i));
        P.push(Prim.sph([(t - 0.5) * 0.5, 0.46, H * (0.2 + t * 0.6)], 0.13, 'moss'));
      }
    }
    return P;
  },

  // ---- what everybody builds ----

  // A well: the reason a settlement is where it is rather than a hundred
  // metres away. A ring of stone, a windlass over it, and after everybody
  // has gone a hole in the ground that is still exactly as deep as it was.
  well(ctx) {
    const P = [];
    const d = ctx.decay;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 6.2832;
      const q = ctx.rnd(hashTag('wl', i));
      const h = 0.85 * (1 - smoothstep(0.3, 1.0, d) * (0.3 + q * 0.8));
      if (h < 0.06) continue;
      P.push(Prim.box([Math.cos(a) * 0.95, Math.sin(a) * 0.95, h / 2],
        [0.20, 0.20, h / 2], 'drystone', [a, 0]));
    }
    P.push(Prim.cyl([0, 0], 0.78, -0.4, 0.05, 'water'));   // the water, still there
    const gear = 1 - smoothstep(0.14, 0.50, d);
    if (gear > 0.1) {
      const zt0 = 1.7 * gear;
      for (const sx of [-1, 1]) {
        P.push(Prim.box([sx * 1.0, 0, zt0 / 2], [0.10, 0.10, zt0 / 2], ctx.wood));
      }
      if (gear > 0.5) {
        const zt = zt0;
        // the drum: a cylinder laid on its side, which is what the pitch in
        // a part's rotation is for
        P.push(Prim.cyl([-0.95, 0], 0.15, zt, zt + 1.9, ctx.wood, [0, 1.5708]));
        P.push(Prim.box([0, 0, zt + 0.14], [1.0, 0.09, 0.09], ctx.wood));
        // the crank: an arm off the drum end and a grip on it, both hung on
        // the post rather than floating beside it
        P.push(beam([1.02, 0, zt], [1.02, 0.30, zt], 0.05, ctx.wood));
        P.push(beam([1.02, 0.30, zt], [1.02, 0.30, zt - 0.22], 0.045, ctx.wood));
        P.push(Prim.cyl([0, 0], 0.022, zt - 0.75, zt, 'char'));    // the rope
        P.push(Prim.box([0, 0, zt - 0.95], [0.26, 0.20, 0.26], ctx.wood));  // the bucket
      }
    }
    greenery(P, ctx, 'wl', 1.6, 1.6, 0.85 * (1 - smoothstep(0.3, 1.0, d)));
    return P;
  },

  // A shrine: four posts, a roof, and a stone with something on it. It is
  // where a people puts what it is afraid of, so its condition says more
  // about them than the great hall does - a kept shrine and a fallen hall
  // is one story, and the reverse is a different one entirely.
  shrine(ctx) {
    const P = [];
    const d = ctx.decay;
    const R = 1.1;
    P.push(Prim.box([0, 0, 0.13], [R + 0.35, R + 0.35, 0.16], 'cutstone'));
    postRow(P, ctx, 'shA', -R, -R, -R, R, 2, 2.0, 0.11, ctx.wood);
    postRow(P, ctx, 'shB', R, -R, R, R, 2, 2.0, 0.11, ctx.wood);
    const roof = 1 - smoothstep(0.16, 0.46, d);
    if (roof > 0.3) {
      P.push(gable(0, 0, 2.0, R + 0.5, R + 0.5, 0.85 * roof, 'thatch', roof < 0.7));
    }
    // the altar stone, and what was set on it - which is still there,
    // because taking a thing off a shrine is not something people did
    P.push(Prim.box([0, 0, 0.52], [0.42, 0.62, 0.26], 'stone'));
    if (d < 0.85) {
      P.push(Prim.box([0, 0, 0.86], [0.14, 0.14, 0.10],
        d > 0.4 ? 'stone' : (ctx.metal === 'bone' ? 'bone' : ctx.metal)));
    }
    greenery(P, ctx, 'sh', R + 0.6, R + 0.6);
    return P;
  },
};

// -------- what people made --------
// The chronicle already makes these: a class, a kind, a material, a smith,
// a year, and a condition that follows from how long it has been in the
// ground. All of that exists and none of it has ever had a shape. These are
// the shapes - authored lying down, as a thing is found, not as it was worn.
//
// Condition is the chronicle's own: 1 is as-made and 0 is a stain in the
// soil, and the geometry passes through the same five words on the way.

const Artifact = {
  // Every kind in Chronicle.ART_CLASS maps onto one of these archetypes.
  // Forty nouns and fourteen shapes is the right ratio: the name carries
  // the specificity and the geometry carries the silhouette.
  OF: {
    sword: 'blade', longsword: 'blade', blade: 'blade', 'long knife': 'blade',
    spear: 'shaft', halberd: 'shaft', mace: 'shaft',
    axe: 'axe', 'war-axe': 'axe', 'war-pick': 'axe', adze: 'axe', pick: 'axe',
    helm: 'helm', 'war-mask': 'helm', breastplate: 'helm',
    shield: 'shield', 'mail-coat': 'shield', 'scale-coat': 'shield',
    greaves: 'shield', gauntlets: 'shield',
    torc: 'torc', armband: 'torc', circlet: 'torc', diadem: 'torc',
    ring: 'ring',
    brooch: 'brooch', amulet: 'brooch', pendant: 'brooch',
    'belt-buckle': 'brooch', 'cloak-pin': 'pin',
    chisel: 'rod', awl: 'rod', file: 'rod', 'plumb-bob': 'rod', drill: 'rod',
    saw: 'saw', tongs: 'tongs', lamp: 'lamp',
    bowl: 'bowl', platter: 'bowl', basin: 'bowl',
    cup: 'cup', flask: 'cup', ewer: 'cup', 'drinking-horn': 'horn',
    urn: 'urn', cauldron: 'cauldron',
  },

  // What is left of a thing. Above `worn` it is whole; below `a fragment`
  // only the part that survives being buried is there at all, and at the
  // bottom the object is a shape in the soil with nothing in it.
  archetype(kind) { return this.OF[kind] || 'blade'; },

  // organic parts go first and metal parts last, which is why every hilt
  // in every museum is a reconstruction and every blade is not
  // Below this the object is gone and what is left is the discolouration it
  // left in the ground. The number is the chronicle's own: the bottom entry
  // of Chronicle.CONDITION, where 'a fragment' gives out and the word
  // becomes 'a stain in the soil'.
  STAIN: 0.07,
  isStain(cond) { return clamp(cond === undefined ? 1 : cond, 0, 1) < this.STAIN; },

  build(kind, mat, cond, key) {
    const P = [];
    const a = this.archetype(kind);
    const c = clamp(cond === undefined ? 1 : cond, 0, 1);
    const m = AMAT[mat] ? mat : 'bronze';
    const rnd = i => arnd(key || (kind + m), i);
    if (this.isStain(c)) { this.stain(P, a, rnd); return P; }
    const org = c > 0.45 ? (m === 'bone' ? 'bone' : 'timber') : null;  // hafts, grips
    const met = c > 0.55 ? m : (c > 0.22 ? this.corroded(m) : this.corroded(m));
    this[a](P, met, org, c, rnd);
    return P;
  },

  // what a metal turns into when it has been in wet ground for centuries
  CORRODE: { iron: 'rust', steel: 'iron', bronze: 'copper', copper: 'copper',
             bone: 'bone', gold: 'gold', silver: 'silver' },
  corroded(m) { return this.CORRODE[m] || m; },

  // The last stage: a dark patch the shape of the thing, and nothing above
  // the ground at all. The chronicle calls this 'a stain in the soil'.
  // The shape the thing left behind, in the ground and slightly proud of
  // it, keeping the object's own outline - a blade leaves a line and a bowl
  // leaves a disc, which is how one is told from the other in a trench.
  stain(P, a, rnd) {
    const long = a === 'blade' || a === 'shaft' || a === 'saw';
    const w = long ? 0.05 : 0.16, l = long ? 0.62 : 0.20;
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      P.push(Prim.sph([(t - 0.5) * l * 2, (rnd(i) - 0.5) * w * 2, 0.012],
        w * (0.7 + rnd(i + 20) * 0.6), 'stain'));
    }
  },

  blade(P, m, org, c, rnd) {
    const L = 0.62 * (c > 0.22 ? 1 : 0.45);      // a fragment is the tip
    P.push(Prim.box([L / 2, 0, 0.018], [L, 0.042, 0.014], m));
    P.push(Prim.cone([L * 2 + 0.01, 0], 0.004, 0.032, 0.042, 0.004, m, [0, 1.5708]));
    if (c > 0.22) {
      P.push(Prim.box([-0.03, 0, 0.022], [0.02, 0.11, 0.022], m));   // the guard
      if (org) P.push(Prim.cyl([-0.13, 0], 0.028, 0.006, 0.04, org, [0, 1.5708]));
      P.push(Prim.sph([-0.20, 0, 0.024], 0.036, m));                  // the pommel
    }
  },
  shaft(P, m, org, c, rnd) {
    if (org) P.push(Prim.cyl([-0.75, 0], 0.022, 0.022, 1.5, org, [0, 1.5708]));
    else for (let i = 0; i < 8; i++) {      // the haft is gone: a line of stain
      P.push(Prim.sph([-0.75 + i * 0.13, 0, 0.006], 0.022, 'ash'));
    }
    P.push(Prim.cone([0.62, 0], 0.024, 0.13, 0.036, 0.004, m, [0, 1.5708]));
    P.push(Prim.box([0.70, 0, 0.024], [0.11, 0.030, 0.012], m));
  },
  axe(P, m, org, c, rnd) {
    if (org) P.push(Prim.cyl([-0.34, 0], 0.024, 0.024, 0.72, org, [0, 1.5708]));
    P.push(Prim.box([0.34, 0, 0.05], [0.055, 0.030, 0.05], m));
    // the blade flares out from the socket, which is the whole shape of it
    P.push(Prim.conv([0.40, 0, 0.05], [
      { n: [-1, 0, 0], d: 0.0 }, { n: [1, 0, 0], d: 0.10 },
      { n: [0, 1, 0], d: 0.020 }, { n: [0, -1, 0], d: 0.020 },
      { n: [0, 0, 1], d: 0.10 }, { n: [0, 0, -1], d: 0.10 },
      { n: [0.90, 0, 0.44], d: 0.085 }, { n: [0.90, 0, -0.44], d: 0.085 },
    ], m));
  },
  helm(P, m, org, c, rnd) {
    const whole = c > 0.35;
    P.push(Prim.sph([0, 0, 0.11], 0.15, m));
    if (whole) {
      P.push(Prim.cyl([0, 0], 0.155, 0.02, 0.06, m));            // the brow band
      P.push(Prim.box([0.14, 0, 0.09], [0.03, 0.018, 0.06], m)); // the nasal
      P.push(Prim.cone([0, 0], 0.25, 0.32, 0.03, 0.005, m));     // the crest spike
    }
  },
  shield(P, m, org, c, rnd) {
    const R = 0.42;
    if (org) P.push(Prim.cyl([0, 0], R, 0.004, 0.030, org));
    else for (let i = 0; i < 12; i++) {   // the board is gone; the rim is not
      const a = (i / 12) * 6.2832;
      P.push(Prim.box([Math.cos(a) * R, Math.sin(a) * R, 0.012],
        [0.035, 0.11, 0.012], m, [a, 0]));
    }
    P.push(Prim.sph([0, 0, 0.03], 0.085, m));                     // the boss
  },
  torc(P, m, org, c, rnd) {
    const R = 0.13, N = 16;
    // an open ring: the gap is how a torc goes on, and it is also the part
    // that bends and breaks, so a broken one is missing an arm not a middle
    const span = c > 0.30 ? 13 : 8;
    for (let i = 0; i < span; i++) {
      const a = 0.6 + (i / N) * 6.2832;
      P.push(Prim.sph([Math.cos(a) * R, Math.sin(a) * R, 0.018], 0.020, m));
    }
    if (c > 0.30) for (const s of [0.6, 0.6 + (12 / N) * 6.2832]) {
      P.push(Prim.sph([Math.cos(s) * R, Math.sin(s) * R, 0.022], 0.034, m));
    }
  },
  ring(P, m, org, c, rnd) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * 6.2832;
      P.push(Prim.sph([Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0.010], 0.014, m));
    }
  },
  brooch(P, m, org, c, rnd) {
    P.push(Prim.cyl([0, 0], 0.10, 0.004, 0.020, m));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.2832;
      P.push(Prim.sph([Math.cos(a) * 0.072, Math.sin(a) * 0.072, 0.026], 0.024, m));
    }
    if (c > 0.45) P.push(Prim.box([0, 0, 0.030], [0.075, 0.008, 0.008], m, [0.7, 0]));
  },
  pin(P, m, org, c, rnd) {
    P.push(Prim.cone([-0.11, 0], 0.005, 0.014, 0.010, 0.002, m, [0, 1.5708]));
    P.push(Prim.box([0.0, 0, 0.008], [0.11, 0.006, 0.006], m));
    P.push(Prim.sph([0.13, 0, 0.020], 0.035, m));
  },
  rod(P, m, org, c, rnd) {
    P.push(Prim.cyl([-0.10, 0], 0.017, 0.017, 0.30, m, [0, 1.5708]));
    P.push(Prim.cone([0.21, 0], 0.017, 0.06, 0.017, 0.002, m, [0, 1.5708]));
    if (org) P.push(Prim.cyl([-0.24, 0], 0.030, 0.017, 0.14, org, [0, 1.5708]));
  },
  saw(P, m, org, c, rnd) {
    P.push(Prim.box([0, 0, 0.012], [0.30, 0.055, 0.008], m));
    for (let i = 0; i < 14; i++) {
      P.push(Prim.cone([-0.27 + i * 0.042, -0.055], 0.006, 0.024, 0.016, 0.001, m,
        [0, 1.5708]));
    }
    if (org) P.push(Prim.box([-0.38, 0, 0.02], [0.09, 0.035, 0.02], org));
  },
  tongs(P, m, org, c, rnd) {
    for (const s of [-1, 1]) {
      P.push(Prim.box([0.0, s * 0.03, 0.012], [0.26, 0.014, 0.010], m,
        [s * 0.10, 0]));
      P.push(Prim.box([0.28, s * 0.055, 0.012], [0.06, 0.014, 0.010], m,
        [-s * 0.5, 0]));
    }
    P.push(Prim.cyl([-0.02, 0], 0.014, 0.006, 0.028, m));   // the rivet
  },
  lamp(P, m, org, c, rnd) {
    P.push(Prim.cone([0, 0], 0, 0.075, 0.13, 0.10, m));
    P.push(Prim.cone([0, 0], 0.055, 0.085, 0.105, 0.075, m));   // the rolled rim
    P.push(Prim.cone([0.16, 0], 0.02, 0.055, 0.055, 0.030, m)); // the spout
    if (c > 0.6) P.push(Prim.sph([0.19, 0, 0.05], 0.016, 'char'));   // the wick
  },
  bowl(P, m, org, c, rnd) {
    const R = 0.22 * (c > 0.22 ? 1 : 0.6);
    P.push(Prim.cone([0, 0], 0, 0.075, R * 0.55, R, m));
    P.push(Prim.cone([0, 0], 0.055, 0.085, R * 0.94, R * 0.90, m));
  },
  cup(P, m, org, c, rnd) {
    P.push(Prim.cone([0, 0], 0, 0.030, 0.075, 0.055, m));   // the foot
    P.push(Prim.cone([0, 0], 0.025, 0.17, 0.055, 0.095, m));
    if (c > 0.45) {
      for (let i = 0; i < 5; i++) {   // the handle, which is what breaks
        const a = -0.9 + (i / 4) * 1.8;
        P.push(Prim.sph([0.095 + Math.cos(a) * 0.055, 0, 0.11 + Math.sin(a) * 0.055],
          0.016, m));
      }
    }
  },
  horn(P, m, org, c, rnd) {
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const a = t * 1.5;
      P.push(Prim.sph([Math.sin(a) * 0.30 - 0.12, 0, 0.06 + (1 - Math.cos(a)) * 0.16],
        0.075 * (1 - t * 0.82), i === 0 ? 'bone' : (t > 0.75 ? m : 'bone')));
    }
  },
  urn(P, m, org, c, rnd) {
    const whole = c > 0.30;
    P.push(Prim.cone([0, 0], 0, 0.12, 0.10, 0.19, m));
    P.push(Prim.cone([0, 0], 0.12, 0.28, 0.19, 0.13, m));
    if (whole) {
      P.push(Prim.cone([0, 0], 0.28, 0.34, 0.13, 0.16, m));   // the flared neck
    } else {
      // a broken pot is sherds, and sherds are how most of them are found
      for (let i = 0; i < 5; i++) {
        const a = rnd(i) * 6.2832, r = 0.3 + rnd(i + 9) * 0.4;
        P.push(Prim.box([Math.cos(a) * r, Math.sin(a) * r, 0.014],
          [0.055, 0.045, 0.010], m, [a, 0.4]));
      }
    }
  },
  cauldron(P, m, org, c, rnd) {
    P.push(Prim.sph([0, 0, 0.19], 0.22, m));
    P.push(Prim.cyl([0, 0], 0.20, 0.30, 0.34, m));
    for (const s of [-1, 1]) {          // the ring handles it hung from
      for (let i = 0; i < 5; i++) {
        const a = (i / 4) * Math.PI;
        P.push(Prim.sph([s * (0.20 + Math.sin(a) * 0.05), 0,
          0.32 + Math.cos(a) * 0.055], 0.016, m));
      }
    }
    if (c > 0.55) P.push(Prim.cone([0, 0], 0.0, 0.03, 0.09, 0.07, 'char'));
  },
};

// -------- what is already out there --------
// These are not new. Every one of them is drawn by the shader today, and
// the numbers come from TREE, PROPS and CAVES rather than from here - so
// if a canopy is the wrong size in the viewer it is the wrong size in the
// game, which is the only reason a viewer is worth having.

const InWorld = {
  // A tree, at its own placement cell's dimensions. The canopy is a sphere
  // in the shader too; what the shader adds is the noise that erodes it
  // into foliage, which is shading rather than shape.
  tree(species, key) {
    const P = [];
    const rnd = i => arnd(key || ('tree' + species), i);
    const r = TREE.R_MIN + rnd(0) * TREE.R_VAR;
    const trunkH = TREE.TRUNK_H + rnd(1) * TREE.TRUNK_H_VAR;
    const trunkR = TREE.TRUNK_R + r * TREE.TRUNK_R_K;
    const sp = SPECIES[species] || SPECIES[0];
    P.push(Prim.cyl([0, 0], trunkR, 0, trunkH, 'timber'));
    const cz = trunkH + r * TREE.CAN_Z;
    if (sp.name === 'pine') {
      // a pine is a stack of skirts, not a ball: the same canopy radius,
      // spent on height instead of width
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        P.push(Prim.cone([0, 0], cz - r * 0.5 + t * r * 1.5,
          cz + r * (0.35 + t * 1.5), r * (1.0 - t * 0.55), r * (0.55 - t * 0.42),
          'leaf'));
      }
    } else if (sp.name === 'ironbark') {
      // dense and dark, and it forks rather than branching
      P.push(Prim.sph([r * 0.32, 0, cz], r * 0.78, 'leaf'));
      P.push(Prim.sph([-r * 0.36, r * 0.18, cz + r * 0.28], r * 0.70, 'leaf'));
      P.push(Prim.cyl([r * 0.2, 0], trunkR * 0.6, trunkH * 0.7, cz, 'timber',
        [0, 0.3]));
    } else {
      P.push(Prim.sph([0, 0, cz], r, 'leaf'));
      // the fruit this species is worth walking to
      for (let i = 0; i < 6; i++) {
        const a = rnd(i + 5) * 6.2832, e = rnd(i + 12) * 0.9;
        P.push(Prim.sph([Math.cos(a) * r * 0.85 * Math.cos(e),
          Math.sin(a) * r * 0.85 * Math.cos(e), cz - r * 0.2 + Math.sin(e) * r * 0.6],
          0.10, 'amber'));
      }
    }
    return P;
  },

  // The loose stone and the boulder, at PROPS' own radii and with PROPS'
  // own facet count - this is hitFaceted's shape, not an impression of it.
  stone(key) {
    const r = PROPS.STONE_R * 1.5;
    return [Prim.facet([0, 0, r * 0.75], r, hashTag(key || 'stone', 1), 'drystone')];
  },
  boulder(key) {
    const r = PROPS.ROCK_R * 1.5;
    return [Prim.facet([0, 0, r * (1 - 0.35)], r, hashTag(key || 'rock', 1), 'stone')];
  },

  // A hall pillar: square in plan, at PIL_R, spanning a band's headroom.
  // What the shader does is protect this shape from every carve that
  // crosses it, which is what leaves them freestanding in a cavern.
  pillar() {
    const P = [];
    const h = 3.2, r = CAVES.PIL_R;
    P.push(Prim.box([0, 0, h / 2], [r, r, h / 2], 'stone'));
    P.push(Prim.box([0, 0, 0.16], [r * 1.35, r * 1.35, 0.16], 'stone'));
    P.push(Prim.box([0, 0, h - 0.16], [r * 1.35, r * 1.35, 0.16], 'stone'));
    P.push(Prim.box([0, 0, -0.06], [r * 3, r * 3, 0.08], 'stone'));   // the floor
    // the lichen that makes a deep hall navigable, and the inscription
    // panel the record is cut into
    for (let i = 0; i < 4; i++) {
      P.push(Prim.sph([r * 1.02, (arnd('pil', i) - 0.5) * r,
        0.6 + arnd('pil', i + 8) * 1.9], 0.09, 'lichen'));
    }
    P.push(Prim.box([-r * 1.02, 0, 1.55], [0.03, r * 0.75, 0.55], 'cutstone'));
    return P;
  },

  // A turn of the helical stair that links the surface to the first band.
  // SHAFT_PITCH is the drop per turn and SHAFT_OPEN the part of it that is
  // air, so the tread count here is the geometry, not a look.
  stair() {
    const P = [];
    const R = CAVES.SHAFT_R, Ri = CAVES.SHAFT_RIN;
    P.push(Prim.cyl([0, 0], Ri, -CAVES.SHAFT_PITCH * 1.2, 0.4, 'stone'));
    const N = 22;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const a = t * 6.2832 * 1.2;
      const z = -t * CAVES.SHAFT_PITCH * 1.2;
      P.push(Prim.box([Math.cos(a) * (R + Ri) / 2, Math.sin(a) * (R + Ri) / 2, z],
        [(R - Ri) / 2, (R * 6.2832 / N) * 0.55, 0.11], 'stone', [a + 1.5708, 0]));
    }
    // the rim the player spawns beside: the pit as it reads from above
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * 6.2832;
      P.push(Prim.facet([Math.cos(a) * (R + 0.5), Math.sin(a) * (R + 0.5),
        0.22 * ASSET.SIT], 0.22, hashTag('stairrim', i), 'stone'));
    }
    return P;
  },

  // A face of rock with a vein crossing it. The vein is the intersection
  // curve of two noise fields in the shader, which is what makes it a tube
  // rather than a sheet - so it is drawn here as a tube, wandering.
  vein(kind) {
    const P = [];
    const mat = kind === 'gem' ? 'gem' : kind === 'iron' ? 'iron'
      : kind === 'tin' ? 'silver' : 'ore';
    P.push(Prim.box([0, 0.55, 1.1], [1.9, 0.55, 1.1], 'stone'));
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const x = (t - 0.5) * 3.4;
      const z = 1.1 + Math.sin(t * 7.0) * 0.55 + Math.cos(t * 3.1) * 0.3;
      const r = 0.09 + Math.sin(t * 11) * 0.03;
      P.push(Prim.sph([x, -0.02, z], r, mat));
      // the branch that makes it read as a vein and not a wire
      // a branch, which is what makes it read as a vein and not a wire -
      // kept inside the face, because ore that leaves the rock is floating
      if (i % 7 === 3) {
        for (let j = 1; j < 5; j++) {
          const bx = clamp(x + j * 0.13, -1.75, 1.75);
          const bz = clamp(z + j * 0.16 * (i % 2 ? 1 : -1), 0.15, 2.05);
          P.push(Prim.sph([bx, -0.02, bz], r * (1 - j * 0.15), mat));
        }
      }
    }
    if (kind === 'gem') {
      // the core the lantern wants, sitting in the middle of the vein
      P.push(Prim.sph([0.2, -0.10, 1.35], 0.20, 'gem'));
      P.push(Prim.sph([-0.8, -0.06, 0.85], 0.13, 'gem'));
    }
    return P;
  },
};

// -------- what the player carries --------
// The inventory has fifteen names in it and no shapes. These are the
// shapes, built out of the artifact archetypes wherever an item is one -
// a stone axe and a bronze war-axe are the same object with a different
// head, and saying so once is better than drawing it twice.

const Carried = {
  wood(P) {
    for (let i = 0; i < 3; i++) {
      const a = arnd('wood', i);
      P.push(Prim.cyl([-0.22 + i * 0.02, (a - 0.5) * 0.18], 0.055,
        0, 0.44, 'timber', [a * 3, 1.5708]));
    }
  },
  stone(P) {
    for (let i = 0; i < 3; i++) {
      const a = arnd('istone', i), b = arnd('istone', i + 5);
      P.push(Prim.facet([(a - 0.5) * 0.32, (b - 0.5) * 0.30, 0.06 + a * 0.05],
        0.075 + a * 0.045, hashTag('istone', i), 'drystone'));
    }
  },
  lichen(P) {
    P.push(Prim.facet([0, 0, 0.05], 0.11, 7, 'stone'));
    for (let i = 0; i < 9; i++) {
      const a = arnd('lich', i) * 6.2832, r = arnd('lich', i + 9) * 0.10;
      P.push(Prim.sph([Math.cos(a) * r, Math.sin(a) * r, 0.11 + arnd('lich', i + 20) * 0.05],
        0.045, 'lichen'));
    }
  },
  fruit(P) {
    for (let i = 0; i < 2; i++) {
      P.push(Prim.sph([i * 0.17 - 0.08, arnd('fruit', i) * 0.08, 0.10], 0.10, 'amber'));
      P.push(Prim.cyl([i * 0.17 - 0.08, 0], 0.012, 0.19, 0.24, 'timber',
        [0, 0.3]));
    }
  },
  sap(P) {
    P.push(Prim.cone([0, 0], 0, 0.11, 0.13, 0.09, 'amber'));
    P.push(Prim.sph([0, 0, 0.12], 0.09, 'amber'));
  },
  ore(P, mat) {
    for (let i = 0; i < 3; i++) {
      const a = arnd('ore' + mat, i), b = arnd('ore' + mat, i + 4);
      P.push(Prim.facet([(a - 0.5) * 0.30, (b - 0.5) * 0.28, 0.07],
        0.085 + a * 0.04, hashTag('ore' + mat, i), 'stone'));
      P.push(Prim.sph([(a - 0.5) * 0.30 + 0.03, (b - 0.5) * 0.28, 0.13],
        0.045, mat));
    }
  },
  ingot(P, mat) {
    // an ingot is a casting, and a casting has draft on it, which is the
    // only reason anybody ever got one out of a mould
    P.push(Prim.conv([0, 0, 0.055], [
      { n: [0, 0, 1], d: 0.055 }, { n: [0, 0, -1], d: 0.055 },
      { n: [0.97, 0, 0.24], d: 0.21 }, { n: [-0.97, 0, 0.24], d: 0.21 },
      { n: [0, 0.95, 0.31], d: 0.10 }, { n: [0, -0.95, 0.31], d: 0.10 },
    ], mat));
  },
  gem(P) {
    P.push(Prim.cone([0, 0], 0, 0.10, 0.045, 0.11, 'gem'));
    P.push(Prim.cone([0, 0], 0.10, 0.22, 0.11, 0.02, 'gem'));
  },
  torch(P) {
    P.push(Prim.cyl([0, 0], 0.028, 0, 0.62, 'timber', [0, 0.10]));
    P.push(Prim.sph([0.06, 0, 0.66], 0.085, 'lichen'));
    P.push(Prim.sph([0.06, 0, 0.74], 0.055, 'lichen'));
  },
  lantern(P) {
    P.push(Prim.cyl([0, 0], 0.13, 0, 0.035, 'bronze'));
    P.push(Prim.cyl([0, 0], 0.13, 0.30, 0.34, 'bronze'));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 6.2832 + 0.78;
      P.push(Prim.cyl([Math.cos(a) * 0.115, Math.sin(a) * 0.115], 0.016,
        0.03, 0.31, 'bronze'));
    }
    P.push(Prim.sph([0, 0, 0.17], 0.085, 'gem'));
    for (let i = 0; i < 5; i++) {     // the bail
      const a = (i / 4) * Math.PI;
      P.push(Prim.sph([Math.cos(a) * 0.11, 0, 0.34 + Math.sin(a) * 0.11], 0.015,
        'bronze'));
    }
  },
  shovel(P) {
    P.push(Prim.cyl([0, 0], 0.026, 0.20, 0.95, 'timber', [0, 1.5708]));
    P.push(Prim.conv([0.10, 0, 0.03], [
      { n: [0, 0, 1], d: 0.03 }, { n: [0, 0, -1], d: 0.03 },
      { n: [1, 0, 0], d: 0.17 }, { n: [-1, 0, 0], d: 0.13 },
      { n: [0, 1, 0], d: 0.13 }, { n: [0, -1, 0], d: 0.13 },
      { n: [0.80, 0.60, 0], d: 0.20 }, { n: [0.80, -0.60, 0], d: 0.20 },
    ], 'timber'));
  },
};

// -------- bounds --------
// The viewer frames whatever it is handed without being told how big it is,
// which is what stops a catalogue from carrying a table of camera distances
// that goes stale the moment a roof gets taller.

// Rotation as the intersectors apply it: yaw about z, then pitch about the
// rotated y. Boxes and convex bodies turn about their centre, cylinders and
// cones about the base of their axis - a post leans from its foot, and a
// windlass drum lies along the direction its base points.
//
// A part carries its rotation as the pair, because a pair is what a caller
// wants to write; everything downstream works on the 3x3 that pair expands
// to, because two of those compose and two of the pairs do not. That matters
// the moment an asset is placed somewhere - in a hand, on a hillside - and
// the placement has to combine with the rotation already on the part.
function basisOf(q) {
  if (!q) return null;
  const cy = Math.cos(q[0]), sy = Math.sin(q[0]);
  const cp = Math.cos(q[1]), sp = Math.sin(q[1]);
  // rows of R, where world = R * local
  return [cp * cy, -sy, sp * cy,
          cp * sy, cy, sp * sy,
          -sp, 0, cp];
}

// local -> world, for a part's basis (a 3x3) or its yaw/pitch pair
function rotApply(m, v) {
  if (!m) return v.slice();
  if (m.length === 2) m = basisOf(m);
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
          m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
          m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

// world -> local: the transpose, because a basis is orthonormal
function rotUnapply(m, v) {
  if (!m) return v.slice();
  if (m.length === 2) m = basisOf(m);
  return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
          m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
          m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
}

function matMul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}

// The basis of a placement: yaw, then pitch, then roll about the forward
// axis. Roll is what a held thing needs and a standing thing never does.
function basisYPR(yaw, pitch, roll) {
  let m = basisOf([yaw || 0, pitch || 0]);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    m = matMul(m, [1, 0, 0, 0, c, -s, 0, s, c]);
  }
  return m;
}

// The corners of a convex body, as the points where three of its planes
// meet that no other plane excludes. Exact, and cheap at eight planes.
function convVerts(planes) {
  const V = [], n = planes.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++)
    for (let c = b + 1; c < n; c++) {
      const A = planes[a].n, B = planes[b].n, C = planes[c].n;
      const det = A[0] * (B[1] * C[2] - B[2] * C[1])
                - A[1] * (B[0] * C[2] - B[2] * C[0])
                + A[2] * (B[0] * C[1] - B[1] * C[0]);
      if (Math.abs(det) < 1e-9) continue;
      const d = [planes[a].d, planes[b].d, planes[c].d];
      const p = [
        (d[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (d[1] * C[2] - B[2] * d[2])
          + A[2] * (d[1] * C[1] - B[1] * d[2])) / det,
        (A[0] * (d[1] * C[2] - B[2] * d[2]) - d[0] * (B[0] * C[2] - B[2] * C[0])
          + A[2] * (B[0] * d[2] - d[1] * C[0])) / det,
        (A[0] * (B[1] * d[2] - d[1] * C[1]) - A[1] * (B[0] * d[2] - d[1] * C[0])
          + d[0] * (B[0] * C[1] - B[1] * C[0])) / det,
      ];
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        if (planes[i].n[0] * p[0] + planes[i].n[1] * p[1] + planes[i].n[2] * p[2]
            > planes[i].d + 1e-6) ok = false;
      }
      if (ok) V.push(p);
    }
  return V;
}

// A part's axis-aligned box in world space. Rotated boxes and cones are
// bounded by their own bounding sphere, which costs a little slack and no
// trigonometry worth arguing about.
function partBounds(p) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  const add = (c, r) => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], c[i] - r); hi[i] = Math.max(hi[i], c[i] + r);
    }
  };
  const addPt = v => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]);
    }
  };
  const q = p.m || p.q;
  if (p.k === 'sph' || p.k === 'facet') { add(p.c, p.r); }
  else if (p.k === 'box') {
    if (!q) {
      for (let i = 0; i < 3; i++) { lo[i] = p.c[i] - p.he[i]; hi[i] = p.c[i] + p.he[i]; }
    } else {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const v = rotApply(q, [sx * p.he[0], sy * p.he[1], sz * p.he[2]]);
        addPt([p.c[0] + v[0], p.c[1] + v[1], p.c[2] + v[2]]);
      }
    }
  } else if (p.k === 'cyl' || p.k === 'cone') {
    // A disc's box, not a sphere's. Along an axis the cap sweeps
    // r * sqrt(1 - a^2), where a is the axis direction's component on it -
    // so a wide flat plinth is 0.35 tall rather than 5.5, which is what
    // bounding each end by a sphere would have claimed. It matters twice:
    // the camera frames by these numbers, and the sheet prints them.
    const r0 = p.k === 'cyl' ? p.r : p.r0;
    const r1 = p.k === 'cyl' ? p.r : p.r1;
    const p0 = [p.c[0], p.c[1], p.z0];
    const ax = rotApply(q, [0, 0, 1]);
    const len = p.z1 - p.z0;
    const p1 = [p0[0] + ax[0] * len, p0[1] + ax[1] * len, p0[2] + ax[2] * len];
    for (let i = 0; i < 3; i++) {
      const k = Math.sqrt(Math.max(0, 1 - ax[i] * ax[i]));
      lo[i] = Math.min(lo[i], p0[i] - r0 * k, p1[i] - r1 * k);
      hi[i] = Math.max(hi[i], p0[i] + r0 * k, p1[i] + r1 * k);
    }
  } else if (p.k === 'conv') {
    for (const v of convVerts(p.planes)) {
      const w = rotApply(q, v);
      addPt([p.c[0] + w[0], p.c[1] + w[1], p.c[2] + w[2]]);
    }
  }
  return { lo, hi };
}

function partsBounds(parts) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of parts) {
    const b = partBounds(p);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], b.lo[i]); hi[i] = Math.max(hi[i], b.hi[i]);
    }
  }
  if (lo[0] > hi[0]) return { lo: [-1, -1, 0], hi: [1, 1, 1], c: [0, 0, 0.5],
                              r: 1, R: 1, H: 0.5 };
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const r = Math.max(0.2, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
  // R and H are the bounding cylinder: how far the thing reaches from its
  // own axis, and how tall it is. A camera that frames those two separately
  // fills the picture with a long low building where one framing the sphere
  // leaves it swimming - and neither number changes as the turntable turns.
  const R = Math.max(0.2, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1]));
  const H = Math.max(0.2, 0.5 * (hi[2] - lo[2]));
  return { lo, hi, c, r, R, H };
}

// -------- placing a thing somewhere --------

// Bake a position, an orientation and a scale into a parts list. This is
// what makes a catalogue entry reusable: the axe drawn on its own and the
// axe in a hand are one geometry and two placements, and if they were two
// geometries the hand would eventually be holding last week's axe.
function transformParts(parts, xf) {
  const R = xf.m || basisYPR(xf.yaw, xf.pitch, xf.roll);
  const t = xf.pos || [0, 0, 0];
  const s = xf.scale === undefined ? 1 : xf.scale;
  const put = v => {
    const w = rotApply(R, [v[0] * s, v[1] * s, v[2] * s]);
    return [w[0] + t[0], w[1] + t[1], w[2] + t[2]];
  };
  return parts.map(p => {
    const q = Object.assign({}, p);
    const om = p.m || basisOf(p.q);
    q.m = om ? matMul(R, om) : R;
    q.q = null;
    if (p.k === 'cyl' || p.k === 'cone') {
      // the anchor is the base of the axis, and the axis rides the basis -
      // so only the base point and the length move
      const b = put([p.c[0], p.c[1], p.z0]);
      const len = (p.z1 - p.z0) * s;
      q.c = [b[0], b[1]];
      q.z0 = b[2]; q.z1 = b[2] + len;
      if (p.k === 'cyl') q.r = p.r * s;
      else { q.r0 = p.r0 * s; q.r1 = p.r1 * s; }
    } else {
      q.c = put(p.c);
      if (p.k === 'box') q.he = [p.he[0] * s, p.he[1] * s, p.he[2] * s];
      if (p.k === 'sph' || p.k === 'facet') q.r = p.r * s;
      if (p.k === 'conv') q.planes = p.planes.map(pl => ({ n: pl.n, d: pl.d * s }));
    }
    return q;
  });
}

// What the ground does to a building nobody is sweeping.
//
// Soil does not stay still. It washes off the slope above and blows in off
// the field, and a floor laid level with the yard ends up a foot under it.
// That is why a ruin is dug rather than walked into, and it is most of what
// makes an old site read as old rather than as a broken new one - a wall
// standing to knee height because the top fell off looks nothing like the
// same wall standing to knee height because the bottom is buried.
//
// Applied to the whole parts list rather than written into each generator,
// because it happens to the site, not to the building.
// How deep the site is at a given decay. Late, not early: a building settles
// once nobody is maintaining the ground around it, and a sink that started
// at `weathered` took the bottom off walls that were otherwise still whole.
// Exposed on its own because the section view draws this number as a layer
// of soil, and a section that measured something else would be a lie.
function sinkDepth(d) {
  return ASSET.SINK_MAX * smoothstep(0.38, 1.0, clamp(d, 0, 1));
}

function sinkParts(parts, d, o) {
  const dz = sinkDepth(d);
  if (dz < 1e-4) return parts;
  const out = parts.map(p => {
    const q = Object.assign({}, p);
    if (p.k === 'cyl' || p.k === 'cone') { q.z0 = p.z0 - dz; q.z1 = p.z1 - dz; }
    else q.c = [p.c[0], p.c[1], p.c[2] - dz];
    return q;
  });
  // The tell: the soil that did the burying, which has to be somewhere and
  // is here. A site under a metre and a half of it does not read as level
  // ground, it reads as a swell in a field - and that swell is the only
  // thing left to see from the outside, which is exactly how such a place
  // is found. It arrives only once the walls are already under, so it never
  // covers anything that would otherwise have been visible.
  //
  // Left out of the section view on purpose: the cut has taken the
  // overburden away, and the soil face is drawing it in profile instead.
  // Two representations of the same soil, one per view.
  const t = smoothstep(0.78, 1.0, d);
  if (t > 0.01 && !(o && o.section)) {
    const B = partsBounds(out);
    // hugging the plan rather than the rubble field: at full decay the
    // thrown stone reaches a long way out, and a mound sized off that is a
    // hill with a hall somewhere under the middle of it
    out.unshift(Prim.cone([B.c[0], B.c[1]], -0.2, 0.34 * t,
                          B.R * 0.85, B.R * 0.38, 'turf'));
  }
  return out;
}

// A person, for scale. Not a character and not a creature - the one thing
// a catalogue of buildings genuinely cannot do without, because "eight
// units long" means nothing and "three times as long as somebody is tall"
// means everything.
const FIGURE_H = 1.72;
function figureParts(x, y, facing) {
  const P = [];
  const f = facing || 0;
  const put = (dx, dy) => [x + dx * Math.cos(f) - dy * Math.sin(f),
                           y + dx * Math.sin(f) + dy * Math.cos(f)];
  const M = 'mark';                      // read as a silhouette, not a person
  for (const sy of [-1, 1]) {
    P.push(Prim.cyl(put(0, sy * 0.10), 0.075, 0.0, 0.88, M, [f, sy * 0.04]));
    P.push(Prim.cyl(put(0, sy * 0.24), 0.055, 0.86, 1.36, M, [f, sy * 0.10]));
  }
  P.push(Prim.cone(put(0, 0), 0.84, 1.42, 0.20, 0.17, M, [f, 0]));
  P.push(Prim.sph([...put(0, 0), 1.56], 0.115, M));
  P.push(Prim.cyl(put(0, 0), 0.055, 1.40, 1.48, M));
  return P;
}

// -------- the catalogue --------
// One entry per thing that can stand on this ground. `why` is not a caption;
// it is the reason the asset is in the game at all, and an entry that cannot
// answer it is an entry that should not be drawn.

const Assets = {
  GROUPS: [
    { id: 'farm', name: 'The farm', note: 'What a people builds to eat. Timber, and the first thing gone.' },
    { id: 'hold', name: 'The seat', note: 'What it builds to be looked at, and to hold ground.' },
    { id: 'delve', name: 'The delve', note: 'What it builds to get the metal out. The chronicle runs on this.' },
    { id: 'road', name: 'The road', note: 'What it builds between the places. The chronicle logs every one.' },
    { id: 'dead', name: 'What is left of people', note: 'Graves, cairns and stones - where the chronicle puts its deposits.' },
    { id: 'common', name: 'What everybody builds', note: 'The water and the fear: neither is optional anywhere.' },
    { id: 'find', name: 'What they made', note: 'The chronicle already makes these. None of them has had a shape until now.' },
    { id: 'world', name: 'In the game now', note: 'Drawn by the shader today, at the constants the shader uses.' },
    { id: 'carry', name: 'In the pack now', note: 'Fifteen names in the inventory that have never had a picture.' },
  ],

  // Buildings take decay and a cause; everything else takes neither. The
  // `decay` flag is what the viewer reads to decide whether to offer the
  // slider, so it is a property of the asset rather than of the page.
  LIST: [
    { id: 'longhouse', g: 'farm', name: 'Longhouse', decay: 1,
      why: 'The house. Sill of stone, walls of plank, roof of thatch - and they leave in that order.' },
    { id: 'granary', g: 'farm', name: 'Granary', decay: 1,
      why: 'Grain lifted clear of rats and damp. Its staddle stones keep the square long after the box has gone.' },
    { id: 'byre', g: 'farm', name: 'Stock pen', decay: 1,
      why: 'Nothing here was built to last, which is what makes it the measure of how fast timber goes.' },
    { id: 'fieldwall', g: 'farm', name: 'Field wall', decay: 1,
      why: 'The commonest building on farmed ground and the last to stop being visible. Drystone slumps; it does not fall.' },
    { id: 'moothall', g: 'hold', name: 'Moot hall', decay: 1,
      why: 'The seat. Cut stone and aisle posts, so what is left is a double row of posts inside four walls.' },
    { id: 'tower', g: 'hold', name: 'Tower', decay: 1,
      why: 'A round wall has no corner to lever. It fails on one bearing and stands on the other, which is every ruined keep there is.' },
    { id: 'gate', g: 'hold', name: 'Gate', decay: 1,
      why: 'The chronicle fortifies a place; this is what that looks like. Dressed where the wall beside it is rubble core.' },
    { id: 'rampart', g: 'hold', name: 'Rampart', decay: 1,
      why: 'Palisade or curtain by the people who built it. The bank under both is earth, and earth is permanent.' },
    { id: 'adit', g: 'delve', name: 'Adit', decay: 1,
      why: 'A drift driven into a hillside. When the frame rots the hill closes it, and a dimple with a spoil fan is how it is found.' },
    { id: 'headframe', g: 'delve', name: 'Headframe', decay: 1,
      why: 'The tallest thing a mining people builds. It says from a mile off that this ground was worth a shaft.' },
    { id: 'spoil', g: 'delve', name: 'Spoil heap', decay: 1,
      why: 'Everything the mine took out that was not metal. The most permanent thing a delving people ever makes.' },
    { id: 'smelter', g: 'delve', name: 'Smelting furnace', decay: 1,
      why: 'Where ore becomes metal, so the whole tin-copper-bronze ladder runs through it. The slag outlives the building.' },
    { id: 'waystone', g: 'road', name: 'Waystone', decay: 1,
      why: 'A distance to the next place: the one piece of writing here that is useful rather than commemorative.' },
    { id: 'bridge', g: 'road', name: 'Bridge', decay: 1,
      why: 'The chronicle logs bridges by name. Deck goes in a century; the piers stand as long as the river does.' },
    { id: 'barrow', g: 'dead', name: 'Barrow', decay: 1,
      why: 'The grave deposit, made into a hill. Time rounds it; robbers put a crater in the top.' },
    { id: 'barrow-robbed', g: 'dead', name: 'Barrow, opened', decay: 1, robbed: 1,
      why: 'The same mound after somebody dug it. "We opened what an older people buried" is a line the chronicle already writes.' },
    { id: 'cairn', g: 'dead', name: 'Cairn', decay: 1,
      why: 'Stones piled by hand, one per passer-by. The cheapest permanent thing anybody here can make.' },
    { id: 'menhir', g: 'dead', name: 'Standing stone', decay: 1,
      why: 'Outlasts everything else in the catalogue. The only thing time does to it is tip it.' },
    { id: 'well', g: 'common', name: 'Well', decay: 1,
      why: 'The reason a settlement is here and not a hundred metres away. The hole stays exactly as deep as it was.' },
    { id: 'shrine', g: 'common', name: 'Shrine', decay: 1,
      why: 'Where a people puts what it is afraid of. A kept shrine beside a fallen hall is a story on its own.' },
  ],

  // The things already in the world, at the constants that put them there.
  WORLD: [
    { id: 'tree-pine', name: 'Pine', build: () => InWorld.tree(0),
      why: 'Species 0. Gives sap, three chops to fell. The canopy is a sphere in the shader too; the noise is shading, not shape.' },
    { id: 'tree-bloom', name: 'Bloomwood', build: () => InWorld.tree(1),
      why: 'Species 1. A broadleaf carrying the pale fruit, which is the only food on the surface.' },
    { id: 'tree-iron', name: 'Ironbark', build: () => InWorld.tree(2),
      why: 'Species 2. Four chops, no harvest. It exists to make the axe feel like a tool that can be outmatched.' },
    { id: 'prop-stone', name: 'Loose stone', build: () => InWorld.stone(),
      why: 'The bootstrap: the one thing bare hands can gather, so the whole crafting ladder starts here.' },
    { id: 'prop-rock', name: 'Boulder', build: () => InWorld.boulder(),
      why: 'A bounding sphere with eleven hashed plane cuts taken out of it. No mesh, no vertices - just hitFaceted.' },
    { id: 'hall-pillar', name: 'Hall pillar', build: () => InWorld.pillar(),
      why: 'Where the record is. Protected from every carve that crosses it, which is what leaves them freestanding.' },
    { id: 'stair', name: 'Stair shaft', build: () => InWorld.stair(),
      why: 'A turn of the helix that links the surface to the first band. Grade about sixteen degrees, walkable by construction.' },
    { id: 'vein-copper', name: 'Copper vein', build: () => InWorld.vein('copper'),
      why: 'Two noise isosurfaces intersect along a curve, not a sheet - which is why ore reads as branching tube.' },
    { id: 'vein-tin', name: 'Tin vein', build: () => InWorld.vein('tin'),
      why: 'Never where the copper is. The two halves of bronze coming out of two provinces is the whole trade argument.' },
    { id: 'vein-iron', name: 'Iron vein', build: () => InWorld.vein('iron'),
      why: 'Deep only, and it wants a bronze pick - the rung that makes the metal ladder a ladder.' },
    { id: 'vein-gem', name: 'Gem pocket', build: () => InWorld.vein('gem'),
      why: 'The core of a deep vein, at 0.008% of rock. Emissive, so it glints out of a cave wall and is worth walking toward.' },
  ],

  // The inventory, which has never had a picture of anything in it.
  CARRY: [
    { id: 'i-wood', item: 'wood', build: P => Carried.wood(P) },
    { id: 'i-stone', item: 'stone', build: P => Carried.stone(P) },
    { id: 'i-lichen', item: 'lichen', build: P => Carried.lichen(P) },
    { id: 'i-fruit', item: 'fruit', build: P => Carried.fruit(P) },
    { id: 'i-sap', item: 'sap', build: P => Carried.sap(P) },
    { id: 'i-copper', item: 'copper', build: P => Carried.ore(P, 'copper') },
    { id: 'i-tin', item: 'tin', build: P => Carried.ore(P, 'silver') },
    { id: 'i-iron', item: 'iron', build: P => Carried.ore(P, 'rust') },
    { id: 'i-bronze', item: 'bronze', hold: 'look', build: P => Carried.ingot(P, 'bronze') },
    { id: 'i-gem', item: 'gem', hold: 'look', build: P => Carried.gem(P) },
    { id: 'i-axe', item: 'axe', hold: 'axe', build: P => Artifact.axe(P, 'stone', 'timber', 1, i => arnd('iaxe', i)) },
    { id: 'i-pick', item: 'pick', hold: 'axe', build: P => Artifact.axe(P, 'stone', 'timber', 1, i => arnd('ipick', i)) },
    { id: 'i-bronzepick', item: 'bronzepick', hold: 'axe', build: P => Artifact.axe(P, 'bronze', 'timber', 1, i => arnd('ibp', i)) },
    { id: 'i-ironpick', item: 'ironpick', hold: 'axe', build: P => Artifact.axe(P, 'iron', 'timber', 1, i => arnd('iip', i)) },
    { id: 'i-shovel', item: 'shovel', hold: 'shovel', build: P => Carried.shovel(P) },
    { id: 'i-torch', item: 'torch', hold: 'torch', build: P => Carried.torch(P) },
    { id: 'i-lantern', item: 'lantern', hold: 'lantern', build: P => Carried.lantern(P) },
  ],

  // One artifact per archetype rather than per noun: fourteen shapes carry
  // forty names, and drawing the same silhouette three times would only
  // make the review longer without making it better.
  FINDS: [
    { id: 'a-sword', kind: 'sword', cls: 'weapon', mat: 'bronze', hold: 'blade' },
    { id: 'a-spear', kind: 'spear', cls: 'weapon', mat: 'iron', hold: 'shaft' },
    { id: 'a-axe', kind: 'war-axe', cls: 'weapon', mat: 'steel', hold: 'axe' },
    { id: 'a-helm', kind: 'helm', cls: 'armour', mat: 'bronze' },
    { id: 'a-shield', kind: 'shield', cls: 'armour', mat: 'iron', hold: 'shield' },
    { id: 'a-torc', kind: 'torc', cls: 'wear', mat: 'gold', hold: 'look' },
    { id: 'a-ring', kind: 'ring', cls: 'wear', mat: 'silver' },
    { id: 'a-brooch', kind: 'brooch', cls: 'wear', mat: 'amber' },
    { id: 'a-pin', kind: 'cloak-pin', cls: 'wear', mat: 'jet' },
    { id: 'a-chisel', kind: 'chisel', cls: 'tool', mat: 'bronze', hold: 'look' },
    { id: 'a-saw', kind: 'saw', cls: 'tool', mat: 'iron' },
    { id: 'a-tongs', kind: 'tongs', cls: 'tool', mat: 'iron' },
    { id: 'a-lamp', kind: 'lamp', cls: 'tool', mat: 'copper', hold: 'lantern' },
    { id: 'a-bowl', kind: 'bowl', cls: 'vessel', mat: 'greenstone' },
    { id: 'a-cup', kind: 'cup', cls: 'vessel', mat: 'gold', hold: 'cup' },
    { id: 'a-horn', kind: 'drinking-horn', cls: 'vessel', mat: 'silver', hold: 'cup' },
    { id: 'a-urn', kind: 'urn', cls: 'vessel', mat: 'bone' },
    { id: 'a-cauldron', kind: 'cauldron', cls: 'vessel', mat: 'bronze' },
  ],

  // Every entry the viewer can draw, in one flat list with a group on each.
  // Built once, because the generated halves have to be identified the same
  // way the authored half is or the review notes will not survive a reload.
  all() {
    if (this._all) return this._all;
    const out = this.LIST.map(e => Object.assign({ kindOf: 'building' }, e));
    for (const w of this.WORLD) {
      out.push(Object.assign({ kindOf: 'world', g: 'world' }, w));
    }
    for (const c of this.CARRY) {
      const it = (typeof ITEMS !== 'undefined' && ITEMS[c.item]) || null;
      out.push(Object.assign({ kindOf: 'carry', g: 'carry' }, c, {
        name: it ? it.name : c.item,
        why: it ? it.desc : '',
      }));
    }
    for (const a of this.FINDS) {
      out.push(Object.assign({ kindOf: 'find', g: 'find', cond: 1 }, a, {
        name: a.mat[0].toUpperCase() + a.mat.slice(1) + ' ' + a.kind,
        why: 'Class ' + a.cls + '. Made by a smith in a year, carried, and put in the ' +
             'ground - and what is left of it follows from how long it has been there.',
      }));
    }
    this._all = out;
    return out;
  },

  byId(id) { return this.all().find(e => e.id === id) || null; },

  // Where a held thing sits relative to the eye. Offsets are forward, left
  // and up from the camera, so the whole set moves with CFG.EYE rather than
  // being written down again for every item.
  HOLD: {
    axe:     { pos: [0.52, -0.19, -0.30], yaw: 0.40, pitch: -0.85, roll: 0.30 },
    blade:   { pos: [0.54, -0.18, -0.26], yaw: 0.30, pitch: -1.05, roll: 0.18 },
    shaft:   { pos: [0.60, -0.17, -0.14], yaw: 0.16, pitch: -0.50, roll: 0.0 },
    shovel:  { pos: [0.54, -0.16, -0.34], yaw: 0.38, pitch: -0.62, roll: 0.22 },
    // Held upright and leaning forward, because a torch is built standing
    // up where a blade is built lying down - the pitch that raises one
    // tips the other past vertical and points it behind the eye.
    torch:   { pos: [0.44, -0.20, -0.42], yaw: 0.0, pitch: 0.24, roll: 0.0 },
    lantern: { pos: [0.50, -0.21, -0.52], yaw: 0.12, pitch: 0.10, roll: 0.0 },
    shield:  { pos: [0.56, 0.17, -0.24], yaw: 0.0, pitch: 1.40, roll: 0.30 },
    cup:     { pos: [0.38, -0.13, -0.26], yaw: 0.0, pitch: 0.12, roll: 0.0 },
    // held up and turned over, which is how you look at something you have
    // just dug out of the ground rather than something you are using
    look:    { pos: [0.32, -0.10, -0.13], yaw: 0.55, pitch: -0.30, roll: 0.40 },
  },

  // Metres, as a reader can check them. The catalogue is full of numbers
  // that only mean something next to a person, so both are always given.
  dims(b) {
    const f = v => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
    return f(b.hi[0] - b.lo[0]) + ' x ' + f(b.hi[1] - b.lo[1]) +
           ' x ' + f(b.hi[2] - b.lo[2]) + ' m';
  },

  // Draw one. Everything the viewer varies - decay, cause, the people's
  // material, an artifact's condition - arrives here as options, so no
  // asset needs a copy per state and the parts list is always current.
  make(id, o) {
    const e = this.byId(id);
    if (!e) return { parts: [], bounds: partsBounds([]), entry: null };
    o = o || {};
    let parts = [];
    if (e.kindOf === 'building') {
      const fn = Build[e.id.replace(/-.*$/, '')];
      const ctx = assetCtx({
        key: e.id, decay: o.decay, cause: o.cause, mat: o.mat, metal: o.metal,
      });
      parts = fn ? fn(ctx, { robbed: !!e.robbed }) : [];
      // the ground closing over it, before anything is measured or framed
      if (o.sink !== false) parts = sinkParts(parts, ctx.decay, o);
    } else if (e.kindOf === 'find') {
      parts = Artifact.build(e.kind, o.mat && AMAT[o.mat] ? o.mat : e.mat,
        o.cond === undefined ? 1 : o.cond, e.id);
    } else if (e.kindOf === 'carry') {
      e.build(parts);
    } else {
      parts = e.build();
    }
    let bounds = partsBounds(parts);
    let held = false;

    // Held: the same geometry, put where a hand would be. Nothing about the
    // item changes - only where it is - which is the point of doing it as a
    // placement rather than as a second drawing.
    // A stain is not an object. It is a shape in the ground where an object
    // used to be, so there is nothing to put in a hand and the first-person
    // view has to decline rather than hold a discolouration up to the eye.
    const gone = e.kindOf === 'find' &&
      Artifact.isStain(o.cond === undefined ? 1 : o.cond);
    if (o.view === 'fp' && e.hold && !gone) {
      const H = this.HOLD[e.hold] || this.HOLD.look;
      // At its own size, and deliberately not scaled to fill the frame. A
      // torc is twenty-six centimetres across and a spear is a metre and a
      // half, and the only thing worth learning from a first-person view is
      // which of those you are holding. Sizing them to read equally well
      // would throw away the one fact the view is for.
      parts = transformParts(parts, {
        pos: [H.pos[0], H.pos[1], CFG.EYE + H.pos[2]],
        yaw: H.yaw, pitch: H.pitch, roll: H.roll,
      });
      bounds = partsBounds(parts);
      held = true;
    } else if (o.figure && bounds.hi[2] - bounds.lo[2] > 0.7) {
      // Clear of the footprint on the +y side, which is where the default
      // camera stands - so at rest the figure is in front of the thing and
      // not lost against it. The bearing is fixed rather than following the
      // camera, because a figure that moved to stay in front would change
      // the bounds as the turntable turned and the asset would breathe.
      parts = parts.concat(figureParts(bounds.c[0] + bounds.R * 0.25,
                                       bounds.hi[1] + 1.0, -1.7));
      bounds = partsBounds(parts);
    }
    return { parts, bounds, entry: e, held, gone };
  },
};

// Loadable from node for the test suite as well as from the two pages.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ASSET, AMAT, Prim, Build, Artifact, InWorld, Carried,
                     Assets, assetCtx, partsBounds, partBounds, convVerts,
                     rotApply, rotUnapply, basisOf, basisYPR, matMul,
                     transformParts, figureParts, sinkParts, sinkDepth,
                     beam, strut,
                     FIGURE_H,
                     stageOf, wear, arnd };
}
