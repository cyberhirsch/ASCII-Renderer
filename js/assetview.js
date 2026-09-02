// An ASCII view of a parts list, traced on the CPU.
//
// The game raymarches one ray per character cell in a compute shader. This
// does the same thing in JavaScript against analytic primitives, at a few
// thousand cells rather than thirty thousand, because a catalogue page has
// no frame budget - it has a page-load budget, which is a different and much
// kinder number.
//
// It exists so an asset can be looked at before there is any shader support
// for it. Everything here - the primitives, the sun, the ramp - is the
// renderer's own vocabulary, so what the viewer shows is what the world
// will show, not an illustration of it.

const AssetView = {
  // The ramp is the game's, measured the way the game measures it: render
  // every candidate, sample its ink, keep the ones whose coverages are
  // evenly spaced. In a browser that is a call to GlyphAtlas and the viewer
  // and the renderer then agree glyph for glyph. In node there is no canvas
  // to measure with, so the tests fall back to an even walk of the same
  // pool - close enough to assert structure against, and never used to
  // decide what anybody looks at.
  ramp() {
    if (this._ramp) return this._ramp;
    const set = CFG.GLYPH_SET;
    if (typeof document !== 'undefined') {
      this._ramp = GlyphAtlas.buildRamp(set).map(g => g.ch).join('');
    } else {
      const pool = GlyphAtlas.SETS[set] || GlyphAtlas.SETS.ascii;
      const n = GlyphAtlas.LEVELS, out = [];
      for (let i = 0; i < n; i++) {
        out.push(pool[Math.round(i * (pool.length - 1) / (n - 1))]);
      }
      this._ramp = out.join('');
    }
    return this._ramp;
  },

  // The key light rides the camera, forty-odd degrees off its shoulder and
  // forty up. A sun fixed in the world is what the game has and what the
  // world should have; a catalogue cannot afford it, because half of every
  // turntable would then be a silhouette of the shadowed side. This is a
  // lamp on a copy stand, and it is the one place the viewer deliberately
  // does not do what the renderer does.
  SUN_OFF: 0.85,     // radians of camera azimuth
  SUN_EL: 0.70,      // radians above the horizon
  SUN: [0.45, -0.62, 0.64],   // the fixed world sun, for the first-person view
  SUN_COL: [1.00, 0.92, 0.78],
  SKY_COL: [0.42, 0.52, 0.68],
  GROUND_COL: [0.30, 0.30, 0.26],
  AMB: 0.42,
  SUN_I: 1.15,

  // The viewer's own tone curve, and deliberately not CFG's. The game's
  // white point sits where a sunlit hillside lands under its sky; here a
  // single object is lit by one lamp against nothing, and reusing that
  // number puts every asset in the middle third of the ramp, where a wall
  // and the ground it stands on come out the same glyph. Asking the two
  // to share a curve would be sharing a constant that does not mean the
  // same thing twice.
  TONE: { black: 0.0, white: 0.72, gamma: 0.80 },

  // -------- primitives --------
  // The same five the shader has, plus the convex body that generalises its
  // faceting loop. Each returns [t, nx, ny, nz] or null.

  // A part's rotation reaches the intersectors as a 3x3 basis - prep()
  // expands the yaw/pitch pair callers write into one - so a placed asset
  // and an unplaced one take exactly the same path through here.
  toLocal(m, v) { return m ? rotUnapply(m, v) : v; },
  toWorld(m, v) { return m ? rotApply(m, v) : v; },

  hitSphere(ro, rd, c, r) {
    const ox = ro[0] - c[0], oy = ro[1] - c[1], oz = ro[2] - c[2];
    const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 1e-4) t = -b + sq;
    if (t < 1e-4) return null;
    const px = ox + rd[0] * t, py = oy + rd[1] * t, pz = oz + rd[2] * t;
    return [t, px / r, py / r, pz / r];
  },

  hitBox(ro, rd, c, he, q) {
    const lo = this.toLocal(q, [ro[0] - c[0], ro[1] - c[1], ro[2] - c[2]]);
    const ld = this.toLocal(q, rd);
    let tn = -1e9, tf = 1e9, axis = 0, sgn = 1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) {
        if (Math.abs(lo[i]) > he[i]) return null;
        continue;
      }
      const inv = 1 / ld[i];
      let t0 = (-he[i] - lo[i]) * inv, t1 = (he[i] - lo[i]) * inv;
      let s = -1;
      if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
      if (t0 > tn) { tn = t0; axis = i; sgn = s; }
      if (t1 < tf) tf = t1;
      if (tn > tf) return null;
    }
    const t = tn > 1e-4 ? tn : tf;
    if (t < 1e-4) return null;
    const nl = [0, 0, 0];
    nl[axis] = sgn * (tn > 1e-4 ? 1 : -1);
    const nw = this.toWorld(q, nl);
    return [t, nw[0], nw[1], nw[2]];
  },

  // base at (c, z0), axis +z of length z1-z0 in the part's own frame
  hitCyl(ro, rd, c, r, z0, z1, q) {
    const h = z1 - z0;
    if (h <= 0) return null;
    const lo = this.toLocal(q, [ro[0] - c[0], ro[1] - c[1], ro[2] - z0]);
    const ld = this.toLocal(q, rd);
    const a = ld[0] * ld[0] + ld[1] * ld[1];
    let best = 1e9, nl = null;
    if (a > 1e-12) {
      const b = lo[0] * ld[0] + lo[1] * ld[1];
      const cc = lo[0] * lo[0] + lo[1] * lo[1] - r * r;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-b - sq) / a, (-b + sq) / a]) {
          if (t < 1e-4 || t >= best) continue;
          const z = lo[2] + ld[2] * t;
          if (z < 0 || z > h) continue;
          best = t; nl = [(lo[0] + ld[0] * t) / r, (lo[1] + ld[1] * t) / r, 0];
          break;
        }
      }
    }
    if (Math.abs(ld[2]) > 1e-9) {
      for (const [zc, ns] of [[0, -1], [h, 1]]) {
        const t = (zc - lo[2]) / ld[2];
        if (t < 1e-4 || t >= best) continue;
        const x = lo[0] + ld[0] * t, y = lo[1] + ld[1] * t;
        if (x * x + y * y > r * r) continue;
        best = t; nl = [0, 0, ns];
      }
    }
    if (!nl) return null;
    const nw = this.toWorld(q, nl);
    return [best, nw[0], nw[1], nw[2]];
  },

  // truncated cone: r0 at the base, r1 at the top. A cylinder is this with
  // r0 == r1, but the quadratic degenerates there, so both exist.
  hitCone(ro, rd, c, z0, z1, r0, r1, q) {
    const h = z1 - z0;
    if (h <= 0) return null;
    const lo = this.toLocal(q, [ro[0] - c[0], ro[1] - c[1], ro[2] - z0]);
    const ld = this.toLocal(q, rd);
    const k = (r1 - r0) / h;
    const m = r0 + k * lo[2], n = k * ld[2];
    const A = ld[0] * ld[0] + ld[1] * ld[1] - n * n;
    const B = 2 * (lo[0] * ld[0] + lo[1] * ld[1] - m * n);
    const C = lo[0] * lo[0] + lo[1] * lo[1] - m * m;
    let best = 1e9, nl = null;
    const take = t => {
      if (t < 1e-4 || t >= best) return;
      const z = lo[2] + ld[2] * t;
      if (z < 0 || z > h) return;
      const x = lo[0] + ld[0] * t, y = lo[1] + ld[1] * t;
      const R = r0 + k * z;
      const len = Math.hypot(x, y, k * R) || 1;
      best = t; nl = [x / len, y / len, -k * R / len];
    };
    if (Math.abs(A) > 1e-10) {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        take((-B - sq) / (2 * A));
        take((-B + sq) / (2 * A));
      }
    } else if (Math.abs(B) > 1e-12) {
      take(-C / B);
    }
    if (Math.abs(ld[2]) > 1e-9) {
      for (const [zc, rc, ns] of [[0, r0, -1], [h, r1, 1]]) {
        if (rc <= 0) continue;
        const t = (zc - lo[2]) / ld[2];
        if (t < 1e-4 || t >= best) continue;
        const x = lo[0] + ld[0] * t, y = lo[1] + ld[1] * t;
        if (x * x + y * y > rc * rc) continue;
        best = t; nl = [0, 0, ns];
      }
    }
    if (!nl) return null;
    const nw = this.toWorld(q, nl);
    return [best, nw[0], nw[1], nw[2]];
  },

  // A convex body as the intersection of half-spaces: the ray's interval is
  // clipped by each plane in turn, and the last plane to push the near end
  // owns the face. This is hitFaceted's loop with the normals given instead
  // of hashed, which is why adding it to the shader is a branch, not an
  // intersector.
  hitConv(ro, rd, c, planes, q) {
    const lo = this.toLocal(q, [ro[0] - c[0], ro[1] - c[1], ro[2] - c[2]]);
    const ld = this.toLocal(q, rd);
    let tmin = 1e-4, tmax = 1e9, nl = null;
    for (const pl of planes) {
      const dn = pl.n[0] * ld[0] + pl.n[1] * ld[1] + pl.n[2] * ld[2];
      const po = pl.n[0] * lo[0] + pl.n[1] * lo[1] + pl.n[2] * lo[2] - pl.d;
      if (Math.abs(dn) < 1e-9) {
        if (po > 0) return null;
        continue;
      }
      const t = -po / dn;
      if (dn < 0) { if (t > tmin) { tmin = t; nl = pl.n; } }
      else { if (t < tmax) tmax = t; }
      if (tmin > tmax) return null;
    }
    if (!nl) return null;
    const nw = this.toWorld(q, nl);
    return [tmin, nw[0], nw[1], nw[2]];
  },

  // The boulder shape: a bounding sphere with PROPS.FACES hashed plane cuts
  // taken out of it. Mirror of the shader's hitFaceted, seeded per stone.
  hitFacet(ro, rd, c, r, seed) {
    const bs = (() => {
      const ox = ro[0] - c[0], oy = ro[1] - c[1], oz = ro[2] - c[2];
      const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
      const cc = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - cc;
      if (disc < 0) return null;
      const sq = Math.sqrt(disc);
      return [-b - sq, -b + sq];
    })();
    if (!bs || bs[1] <= 1e-4) return null;
    let tmin = Math.max(bs[0], 1e-4), tmax = bs[1];
    let nx = (ro[0] + rd[0] * tmin - c[0]) / r;
    let ny = (ro[1] + rd[1] * tmin - c[1]) / r;
    let nz = (ro[2] + rd[2] * tmin - c[2]) / r;
    const F = typeof PROPS !== 'undefined' ? PROPS.FACES : 11;
    const CMIN = typeof PROPS !== 'undefined' ? PROPS.CUT_MIN : 0.48;
    const CMAX = typeof PROPS !== 'undefined' ? PROPS.CUT_MAX : 0.78;
    for (let k = 0; k < F; k++) {
      const h1 = arnd('facet' + seed, k * 2), h2 = arnd('facet' + seed, k * 2 + 1);
      const z = h1 * 2 - 1, a = h2 * 6.2831853;
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      const pn = [Math.cos(a) * s, Math.sin(a) * s, z];
      const cut = r * (CMIN + arnd('cut' + seed, k) * (CMAX - CMIN));
      const dn = pn[0] * rd[0] + pn[1] * rd[1] + pn[2] * rd[2];
      const po = pn[0] * (ro[0] - c[0]) + pn[1] * (ro[1] - c[1]) +
                 pn[2] * (ro[2] - c[2]) - cut;
      if (Math.abs(dn) < 1e-9) { if (po > 0) return null; continue; }
      const t = -po / dn;
      if (dn < 0) { if (t > tmin) { tmin = t; nx = pn[0]; ny = pn[1]; nz = pn[2]; } }
      else { tmax = Math.min(tmax, t); }
      if (tmin > tmax) return null;
    }
    return [tmin, nx, ny, nz];
  },

  // -------- the scene --------

  // Bounding sphere per part, so a ray rejects nearly everything for the
  // price of one dot product. With a hundred parts and a few thousand cells
  // this is the difference between a page that loads and one that does not.
  prep(parts) {
    const S = [];
    for (const p of parts) {
      const b = partBounds(p);
      S.push({
        p: p.m || !p.q ? p : Object.assign({}, p, { m: basisOf(p.q), q: null }),
        c: [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2],
        r: 0.5 * Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) + 1e-3,
      });
    }
    return S;
  },

  hitPart(p, ro, rd) {
    switch (p.k) {
      case 'sph': return this.hitSphere(ro, rd, p.c, p.r);
      case 'box': return this.hitBox(ro, rd, p.c, p.he, p.m);
      case 'cyl': return this.hitCyl(ro, rd, p.c, p.r, p.z0, p.z1, p.m);
      case 'cone': return this.hitCone(ro, rd, p.c, p.z0, p.z1, p.r0, p.r1, p.m);
      case 'conv': return this.hitConv(ro, rd, p.c, p.planes, p.m);
      case 'facet': return this.hitFacet(ro, rd, p.c, p.r, p.seed);
      default: return null;
    }
  },

  // Nearest hit, or null. `ground` puts an infinite plane at z=0 so a
  // building has something to stand on and something to cast onto - a
  // floating asset reads as a mistake even when the geometry is right.
  trace(S, ro, rd, tMax, ground, cut) {
    let best = tMax === undefined ? 1e9 : tMax, hit = null;
    for (const s of S) {
      // bounding-sphere reject
      const ox = ro[0] - s.c[0], oy = ro[1] - s.c[1], oz = ro[2] - s.c[2];
      const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
      const cc = ox * ox + oy * oy + oz * oz - s.r * s.r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const near = -b - Math.sqrt(disc);
      if (near > best) continue;
      const h = this.hitPart(s.p, ro, rd);
      if (h && h[0] < best) { best = h[0]; hit = { t: h[0], n: [h[1], h[2], h[3]], mat: s.p.mat }; }
    }
    if (ground && rd[2] < -1e-6) {
      const t = -ro[2] / rd[2];
      if (t > 1e-4 && t < best) {
        const x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t;
        // In section, the turf on the near side of the cut is not there -
        // that is the whole trick, and it is how every excavation drawing
        // in the world shows you what is under the grass.
        const infront = cut
          ? (x - cut.c[0]) * cut.n[0] + (y - cut.c[1]) * cut.n[1] < 0 : false;
        if (Math.hypot(x, y) < ground && !infront) {
          best = t;
          hit = { t, n: [0, 0, 1], mat: 'ground', gx: x, gy: y };
        }
      }
    }
    // and the face the cut leaves: a wall of soil facing the camera, with
    // the turf line along the top of it. The line is the datum the whole
    // decay axis is measured against, so it has to be drawn, not implied.
    if (cut) {
      const den = rd[0] * cut.n[0] + rd[1] * cut.n[1];
      if (den > 1e-6) {
        const t = ((cut.c[0] - ro[0]) * cut.n[0] + (cut.c[1] - ro[1]) * cut.n[1]) / den;
        if (t > 1e-4 && t < best) {
          const z = ro[2] + rd[2] * t;
          const x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t;
          // distance along the cut, to keep the face the width of the pit
          const along = -(x - cut.c[0]) * cut.n[1] + (y - cut.c[1]) * cut.n[0];
          this.tickX = cut.w - 0.30;
          if (z < 0 && z > -cut.d && Math.abs(along) < cut.w) {
            best = t;
            hit = { t, n: [-cut.n[0], -cut.n[1], 0], mat: 'face',
                    gx: along, gy: z, sink: cut.sink };
          }
        }
      }
    }
    return hit;
  },

  // Anything at all between here and there. Shadow rays do not care which
  // part stopped them, so this returns on the first hit rather than sorting.
  occluded(S, ro, rd, tMax) {
    for (const s of S) {
      const ox = ro[0] - s.c[0], oy = ro[1] - s.c[1], oz = ro[2] - s.c[2];
      const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
      const cc = ox * ox + oy * oy + oz * oz - s.r * s.r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      if (-b - Math.sqrt(disc) > tMax) continue;
      const h = this.hitPart(s.p, ro, rd);
      if (h && h[0] < tMax) return true;
    }
    return false;
  },

  // -------- shading --------

  // Ambient occlusion, traced the way the game traces it: short rays into
  // the hemisphere, returning how much of the sky the point can see. Six
  // is few, but a glyph grid has twenty-four brightness steps and cannot
  // show the difference between six rays and thirty-two.
  AO_RAYS: 6,
  AO_R: 1.4,

  ao(S, p, n, seed) {
    // an orthonormal frame about the normal, without a branch on n.z
    const up = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const tx = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2],
                up[0] * n[1] - up[1] * n[0]];
    const tl = Math.hypot(tx[0], tx[1], tx[2]) || 1;
    tx[0] /= tl; tx[1] /= tl; tx[2] /= tl;
    const ty = [n[1] * tx[2] - n[2] * tx[1], n[2] * tx[0] - n[0] * tx[2],
                n[0] * tx[1] - n[1] * tx[0]];
    let open = 0;
    for (let i = 0; i < this.AO_RAYS; i++) {
      // a cosine-ish spiral, offset per point so the pattern does not
      // print itself onto flat walls
      const a = (i + 0.5) / this.AO_RAYS * 6.2831853 + seed * 6.2831853;
      const r = Math.sqrt((i + 0.5) / this.AO_RAYS) * 0.85;
      const z = Math.sqrt(Math.max(0.02, 1 - r * r));
      const d = [
        tx[0] * Math.cos(a) * r + ty[0] * Math.sin(a) * r + n[0] * z,
        tx[1] * Math.cos(a) * r + ty[1] * Math.sin(a) * r + n[1] * z,
        tx[2] * Math.cos(a) * r + ty[2] * Math.sin(a) * r + n[2] * z,
      ];
      const o = [p[0] + n[0] * 0.012, p[1] + n[1] * 0.012, p[2] + n[2] * 0.012];
      if (!this.occluded(S, o, d, this.AO_R)) open++;
      else if (d[2] > 0 && !this.occluded(S, o, d, this.AO_R * 0.35)) open += 0.4;
    }
    return open / this.AO_RAYS;
  },

  // -------- the frame --------

  // Everything a caller can vary. Defaults are a three-quarter view from a
  // little above eye height, which is the angle a building is understood
  // from - straight on hides the plan and straight down hides the roof.
  DEF: { cols: 74, rows: 30, az: 0.85, el: 0.28, zoom: 1.0, plane: 0.62,
         ground: 1, shadow: 1, ao: 1, mono: 0, view: 'orbit', detail: 1,
         section: 0 },

  // Where the camera is and what it is looking along. Orbit frames the
  // bounding sphere rather than the box, so turning the turntable cannot
  // change how big the thing looks. First person does not frame anything:
  // it stands at CFG.EYE and looks out, which is the whole point of it.
  camera(B, o) {
    const aspect = (o.cols * CFG.CELL_W) / (o.rows * CFG.CELL_H);
    // A held thing is seen through the game's own lens, not the catalogue's:
    // the point of the view is what it looks like while you are carrying it,
    // and a narrower plane than the player has would be a different game.
    const plane = o.view === 'fp' ? CFG.PLANE_LEN : o.plane;
    const halfW = plane, halfH = plane / aspect;
    let eye, fw, dist;
    if (o.view === 'fp') {
      eye = [0, 0, CFG.EYE];
      const el = -0.30 + (o.el - AssetView.DEF.el) * 0.5;
      fw = [Math.cos(el), 0, Math.sin(el)];
      dist = 1.0;
    } else {
      // Fit the object's radial extent and its height separately rather than
      // its bounding sphere. A longhouse is eleven metres long and five
      // tall, and a sphere around it is mostly air - framing by that leaves
      // the building sitting in a third of the card. Both terms are
      // azimuth-independent, so turning the turntable cannot pump the size,
      // which is the one thing the sphere was good for.
      const proj = B.R * Math.abs(Math.sin(o.el)) + B.H * Math.cos(o.el);
      dist = Math.max(B.R / halfW, proj / halfH) * 1.28 / Math.max(0.2, o.zoom);
      const ce = Math.cos(o.el), se = Math.sin(o.el);
      // What the camera points at. Normally the middle of the thing; a
      // section wants the ground line instead, because the layer it is
      // drawing is half a metre thick on a building sixteen metres wide and
      // framing the whole building spends two cells on the entire profile.
      const aim = [B.c[0], B.c[1], o.aimZ === undefined ? B.c[2] : o.aimZ];
      eye = [aim[0] + dist * ce * Math.cos(o.az),
             aim[1] + dist * ce * Math.sin(o.az),
             aim[2] + dist * se];
      fw = [aim[0] - eye[0], aim[1] - eye[1], aim[2] - eye[2]];
      const fl = Math.hypot(fw[0], fw[1], fw[2]) || 1;
      fw = [fw[0] / fl, fw[1] / fl, fw[2] / fl];
    }
    // right is level with the horizon, so verticals stay vertical - which
    // in a glyph grid is the difference between a wall and a mistake
    const rt = [fw[1], -fw[0], 0];
    const rl = Math.hypot(rt[0], rt[1]) || 1;
    rt[0] /= rl; rt[1] /= rl;
    const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2],
                rt[0] * fw[1] - rt[1] * fw[0]];
    let L;
    if (o.view === 'fp') {
      const sl = Math.hypot(this.SUN[0], this.SUN[1], this.SUN[2]);
      L = [this.SUN[0] / sl, this.SUN[1] / sl, this.SUN[2] / sl];
    } else {
      const sa = o.az + this.SUN_OFF, ce = Math.cos(this.SUN_EL);
      L = [ce * Math.cos(sa), ce * Math.sin(sa), Math.sin(this.SUN_EL)];
    }
    return { eye, fw, rt, up, halfW, halfH, dist, L };
  },

  // One ray, shaded. Returns linear rgb; the caller decides whether that
  // becomes a glyph or a pixel, which is the only difference between the
  // two views the page offers.
  shadeRay(S, C, rd, o, dith) {
    const L = C.L;
    const h = this.trace(S, C.eye, rd, 1e9, o.gr, o.cutPlane);
    if (!h) return o.view === 'fp' ? this.skyAt(rd) : null;
    const P = [C.eye[0] + rd[0] * h.t, C.eye[1] + rd[1] * h.t, C.eye[2] + rd[2] * h.t];
    let n = h.n;
    if (n[0] * rd[0] + n[1] * rd[1] + n[2] * rd[2] > 0) n = [-n[0], -n[1], -n[2]];
    const M = h.mat === 'ground' ? { c: this.groundAt(h.gx, h.gy) }
      : h.mat === 'face' ? { c: this.soilAt(h.gx, h.gy, h.sink) }
      : (AMAT[h.mat] || AMAT.stone);
    const nl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    let sh = 1;
    if (o.shadow && nl > 0 && h.mat !== 'face') {
      sh = this.occluded(S, [P[0] + n[0] * 0.008, P[1] + n[1] * 0.008,
        P[2] + n[2] * 0.008], L, 40) ? 0.0 : 1.0;
    }
    const a = o.ao ? this.ao(S, P, n, dith) : 1;
    const sky = 0.5 + 0.5 * n[2];
    const amb = this.AMB * a;
    const em = M.emit || 0;
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const ambc = this.SKY_COL[k] * sky + this.GROUND_COL[k] * (1 - sky);
      c[k] = M.c[k] * (this.SUN_COL[k] * this.SUN_I * nl * sh + ambc * amb)
           + M.c[k] * em;
    }
    // haze toward the back of the object, which is what gives a deep ruin
    // its depth in a medium with no perspective cue but size
    const fog = clamp((h.t - C.dist + o.br) / (o.br * 3.2), 0, 1) * 0.30;
    for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - fog) + 0.10 * fog;
    return c;
  },

  // A horizon, for the first-person view only. An object on a turntable
  // wants nothing behind it; a thing in your hand wants somewhere to be.
  skyAt(rd) {
    // Below the horizon is ground the disc did not reach, so it has to meet
    // the disc's own colour or the join reads as a wall at thirty metres.
    const t = clamp(rd[2], -0.05, 1);
    if (t < 0) return [0.11, 0.125, 0.095];
    const h = Math.pow(1 - t, 2.2);
    return [0.20 + 0.26 * h, 0.28 + 0.22 * h, 0.44 + 0.14 * h];
  },

  // Shared setup: the two renderers must agree about where the camera is
  // and how big the ground is, or X would move the object as well as
  // changing how it is drawn.
  setup(parts, o) {
    o = Object.assign({}, this.DEF, o || {});
    o.cols |= 0; o.rows |= 0;
    const S = this.prep(parts);
    // `frame` lets a caller fix the camera to somebody else's bounds. The
    // life strip needs it: five panels each framed on their own contents
    // would put the ground line at a different height in every one, and the
    // whole point of the row is that the ground line does not move while
    // the building comes down to meet it.
    const B = o.frame || partsBounds(parts);
    o.br = B.r;
    // the ground disc is wide enough to catch the shadow and no wider, so
    // a small object is not marooned in the middle of a field
    o.gr = o.ground ? (o.view === 'fp' ? 30 : Math.max(1.6, B.r * 1.5)) : 0;
    const C = this.camera(B, o);
    // The cut is perpendicular to the line of sight and through the middle
    // of the thing, so turning the turntable turns the section with it
    // instead of swinging it round to the far side.
    if (o.section && o.view !== 'fp') {
      const n = Math.hypot(C.fw[0], C.fw[1]) || 1;
      const sink = o.sink || 0;
      o.cutPlane = { n: [C.fw[0] / n, C.fw[1] / n], c: [B.c[0], B.c[1]],
                     sink, w: B.R * 1.12,
                     d: Math.max(1.0, sink + 1.0) };
    } else {
      o.cutPlane = null;
    }
    return { o, S, B, C };
  },

  // The ASCII view: one ray per character cell, exactly as the shader does
  // it. This is the one that has to be right.
  render(parts, opt) {
    const { o, S, B, C } = this.setup(parts, opt);
    const cols = o.cols, rows = o.rows;
    const ch = new Array(cols * rows);
    const col = new Array(cols * rows);
    const lum = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const rd = this.ray(C, (x + 0.5) / cols, (y + 0.5) / rows);
        const c = this.shadeRay(S, C, rd, o, ((x * 7 + y * 13) % 16) / 16);
        if (!c) { ch[i] = ' '; col[i] = null; lum[i] = 0; continue; }
        lum[i] = clamp(c[0] * 0.30 + c[1] * 0.59 + c[2] * 0.11, 0, 1);
        col[i] = c;
        ch[i] = this.glyph(lum[i], x, y);
      }
    }
    return { cols, rows, ch, col, lum, eye: C.eye, dist: C.dist, bounds: B, opt: o };
  },

  // The same scene at pixel resolution, with no glyph step. It is the
  // game's own X view: what the renderer is actually computing, before the
  // ramp throws most of it away. Handy for judging a shape, and a fair
  // reminder of how much the ASCII pass is doing.
  renderRaw(parts, opt) {
    const { o, S, C } = this.setup(parts, opt);
    // Samples are square even though cells are not, so the raw view is not
    // secretly stretched relative to the glyph one.
    const w = Math.max(8, Math.round(o.cols * o.detail));
    const h = Math.max(8, Math.round(o.rows * o.detail * (CFG.CELL_H / CFG.CELL_W)));
    const rgb = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rd = this.ray(C, (x + 0.5) / w, (y + 0.5) / h);
        const c = this.shadeRay(S, C, rd, o, ((x * 7 + y * 13) % 16) / 16) || [0, 0, 0];
        const i = (y * w + x) * 3;
        rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
      }
    }
    return { w, h, rgb, raw: true, opt: o };
  },

  // Normalised screen position to a world direction.
  ray(C, u, v) {
    const sx = (u * 2 - 1) * C.halfW, sy = -(v * 2 - 1) * C.halfH;
    const rd = [C.fw[0] + C.rt[0] * sx + C.up[0] * sy,
                C.fw[1] + C.rt[1] * sx + C.up[1] * sy,
                C.fw[2] + C.rt[2] * sx + C.up[2] * sy];
    const l = Math.hypot(rd[0], rd[1], rd[2]) || 1;
    return [rd[0] / l, rd[1] / l, rd[2] / l];
  },

  // The ground carries a one-metre grid, because "how big is it" is the
  // question a catalogue is asked most and a plain plane cannot answer it.
  // The lines are faint enough to read as ground and countable enough to
  // measure with, and every fifth is heavier so nobody has to count past
  // five - the same reason a ruler has long marks on it.
  // The face of the cut, in profile: turf, then the layer that came in over
  // the site, then what was there before it. Two lines and three tones, and
  // the middle one is exactly the depth the building has gone down by.
  // Pushed well apart on purpose. The glyph ramp has two dozen steps and
  // three soil tones a shade apart come out as one grey band - the fill is
  // the layer the drawing is about, so it is the light one between two dark
  // ones and can be read at a glance instead of measured.
  TURF: [0.15, 0.24, 0.11],       // turf and the root mat under it
  FILL: [0.46, 0.37, 0.23],       // what blew in and washed in since
  SUBS: [0.16, 0.145, 0.135],     // and what the place was built on
  soilAt(along, z, sink) {
    const d = -z;
    // The middle layer IS the sinking: its floor sits at the depth the
    // building has gone down by, so the band you can see is the number.
    // Anything else here would be decoration pretending to be a section.
    const turf = 0.09;
    const c = d <= turf ? this.TURF
      : d <= turf + (sink || 0) ? this.FILL : this.SUBS;
    // and a tick every quarter metre down one edge, to count it off
    const tick = Math.abs(along) > this.tickX && Math.abs(along) < this.tickX + 0.26 &&
                 Math.abs(d / 0.25 - Math.round(d / 0.25)) < 0.05;
    return tick ? [c[0] + 0.13, c[1] + 0.13, c[2] + 0.11] : c;
  },
  tickX: 0,

  groundAt(x, y) {
    const near = (v) => Math.abs(v - Math.round(v));
    const g = Math.min(near(x), near(y));
    const major = Math.min(near(x / 5), near(y / 5)) < 0.012;
    const line = g < 0.022 ? (major ? 0.09 : 0.04) : 0;
    return [0.09 + line, 0.105 + line, 0.075 + line];
  },

  // Tone curve, then ordered dither between the two ramp steps either side
  // of the value - the same trick the fragment shader plays, and for the
  // same reason: seventeen steps band visibly without it.
  // Mirror of the fragment shader's glyph step: tone curve, then an index
  // linear in tone, dithered by just under one ramp step. It can be linear
  // because the ramp is already even in coverage - that is what buildRamp
  // is for, and it is why this does not need a coverage table of its own.
  BAYER: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
  glyph(l, x, y) {
    const R = this.ramp(), n = R.length;
    const t = Math.pow(clamp((l - this.TONE.black) /
      (this.TONE.white - this.TONE.black), 0, 1), this.TONE.gamma);
    const dith = (this.BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) / n;
    return R[Math.floor(clamp(t + dith, 0, 0.9999) * n)];
  },

  // -------- output --------

  // Plain text, which is the one export format an ASCII renderer can offer
  // that a screenshot does not improve on. The game's console already has
  // `copy` for exactly this.
  text(f) {
    const out = [];
    for (let y = 0; y < f.rows; y++) {
      out.push(f.ch.slice(y * f.cols, (y + 1) * f.cols).join('').replace(/\s+$/, ''));
    }
    return out.join('\n');
  },

  // Paint into a canvas at the game's own cell size, so a glyph here is
  // exactly the glyph there.
  paint(cv, f, o) {
    o = o || {};
    const cw = o.cellW || CFG.CELL_W, chh = o.cellH || CFG.CELL_H;
    const dpr = (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1;
    cv.width = f.cols * cw * dpr;
    cv.height = f.rows * chh * dpr;
    cv.style.width = (f.cols * cw) + 'px';
    cv.style.height = (f.rows * chh) + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = o.bg || '#07080a';
    g.fillRect(0, 0, f.cols * cw, f.rows * chh);
    g.font = `bold ${Math.round(chh * 0.82)}px "Consolas", "Courier New", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let y = 0; y < f.rows; y++) {
      for (let x = 0; x < f.cols; x++) {
        const i = y * f.cols + x;
        const c = f.col[i];
        if (!c || f.ch[i] === ' ') continue;
        // The glyph was picked by luminance, so it already carries the
        // brightness; the ink goes down at full intensity and only carries
        // hue. Tinting by luminance as well applies it twice and squashes
        // the range - the fragment shader says so in as many words, and the
        // viewer has to agree with it or the two look nothing alike.
        // Normalised by the brightest channel rather than by luminance: a
        // deep blue divided by its own low luminance overshoots and clamps
        // the hue away.
        const mx = Math.max(c[0], c[1], c[2], 1e-4);
        const r = o.mono ? 1 : clamp(c[0] / mx, 0, 1);
        const gg = o.mono ? 1 : clamp(c[1] / mx, 0, 1);
        const b = o.mono ? 1 : clamp(c[2] / mx, 0, 1);
        g.fillStyle = `rgb(${Math.round(255 * r)},${Math.round(255 * gg)},` +
          `${Math.round(255 * b)})`;
        g.fillText(f.ch[i], x * cw + cw / 2, y * chh + chh / 2 + 1);
      }
    }
  },
  // The raw view, painted as pixels at the same size on the page as the
  // glyph view - so X swaps how the thing is drawn without moving it.
  paintRaw(cv, f, o) {
    o = o || {};
    const cw = o.cellW || CFG.CELL_W, chh = o.cellH || CFG.CELL_H;
    const W = f.opt.cols * cw, H = f.opt.rows * chh;
    const dpr = (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    const img = g.createImageData(f.w, f.h);
    for (let i = 0; i < f.w * f.h; i++) {
      // the same tone curve the glyph pass applies, so the two views are
      // the same picture and not two gradings of it
      for (let k = 0; k < 3; k++) {
        const v = Math.pow(clamp((f.rgb[i * 3 + k] - this.TONE.black) /
          (this.TONE.white - this.TONE.black), 0, 1), this.TONE.gamma);
        img.data[i * 4 + k] = Math.round(255 * v);
      }
      img.data[i * 4 + 3] = 255;
    }
    // blit through an offscreen canvas so the upscale is the browser's
    // smoothing rather than a per-pixel loop at device resolution
    const tmp = document.createElement('canvas');
    tmp.width = f.w; tmp.height = f.h;
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = o.bg || '#07080a';
    g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(tmp, 0, 0, cv.width, cv.height);
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { AssetView };
